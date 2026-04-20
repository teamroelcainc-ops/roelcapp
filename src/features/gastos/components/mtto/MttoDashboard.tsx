// src/features/gastos/components/mtto/MttoDashboard.tsx
import { useState, useEffect, useMemo } from 'react';
import { FormularioMtto } from './FormularioMtto';
import { collection, query, getDocs, orderBy, limit, doc, writeBatch } from 'firebase/firestore'; 
import { db, eliminarRegistro } from '../../../../config/firebase'; 
import MttoAgrupadosInvoice from './MttoAgrupadosInvoice';

type VistaMaestra = 'tabla' | 'agrupado';

const MttoDashboard = () => {
  const [vistaActiva, setVistaActiva] = useState<VistaMaestra>('tabla');
  const [estadoFormulario, setEstadoFormulario] = useState<'cerrado' | 'abierto' | 'minimizado'>('cerrado');
  const [mttoEditando, setMttoEditando] = useState<any | null>(null);
  const [mttoGlobales, setMttoGlobales] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [catalogosCacheados, setCatalogosCacheados] = useState<any>({});
  const [busqueda, setBusqueda] = useState('');
  const [mttoViendo, setMttoViendo] = useState<any | null>(null);
  const [pestañaDetalleActiva, setPestañaDetalleActiva] = useState<string>('general');
  const [paginaActual, setPaginaActual] = useState(1);
  const registrosPorPagina = 50;
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);
  const [gastosSeleccionados, setGastosSeleccionados] = useState<string[]>([]);
  const [modalInvoiceMasivo, setModalInvoiceMasivo] = useState(false);
  const [nuevoInvoiceTexto, setNuevoInvoiceTexto] = useState('');
  const [cargandoMasivo, setCargandoMasivo] = useState(false);

  const cargarDatos = async () => {
    setCargando(true);
    try {
      let catGuardados = null;
      const cacheCatStr = sessionStorage.getItem('roelca_catalogos_v1');

      if (cacheCatStr) {
        catGuardados = JSON.parse(cacheCatStr);
        setCatalogosCacheados(catGuardados);
      } else {
        const [empSnap, unidSnap, servSnap, monSnap, fpSnap, opSnap] = await Promise.all([
          getDocs(collection(db, 'empresas')),
          getDocs(collection(db, 'unidades')),
          getDocs(collection(db, 'catalogo_tipo_servicio')),
          getDocs(collection(db, 'catalogo_moneda')),
          getDocs(collection(db, 'catalogo_formas_pago')),
          getDocs(query(collection(db, 'operaciones'), limit(200)))
        ]);

        catGuardados = {
          empresas: empSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })),
          unidades: unidSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })),
          servicios: servSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })),
          monedas: monSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })),
          formasPago: fpSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })),
          operaciones: opSnap.docs.map((d: any) => ({ id: d.id, ...d.data() }))
        };
        
        sessionStorage.setItem('roelca_catalogos_v1', JSON.stringify(catGuardados));
        setCatalogosCacheados(catGuardados);
      }

      const q = query(collection(db, 'gastos_mtto'), orderBy('createdAt', 'desc'), limit(100));
      const snap = await getDocs(q);
      const mttoData = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
      setMttoGlobales(mttoData);

    } catch (e) {
      console.error("Error al cargar datos MTTO:", e);
    }
    setCargando(false);
  };

  useEffect(() => {
    cargarDatos();
  }, []);

  useEffect(() => {
    setPaginaActual(1);
    setGastosSeleccionados([]); 
  }, [busqueda]);

  const handleNuevo = () => { setMttoEditando(null); setEstadoFormulario('abierto'); };
  const editarMtto = (mtto: any) => { setMttoEditando(mtto); setEstadoFormulario('abierto'); };
  
  const eliminarMtto = async (id: string) => {
    if (!id) return;
    if (window.confirm('¿Estás seguro de eliminar este registro permanentemente?')) {
      try {
        await eliminarRegistro('gastos_mtto', id);
        await cargarDatos(); 
        setGastosSeleccionados(prev => prev.filter(selId => String(selId) !== String(id)));
      } catch (error) {
        console.error("Error al eliminar:", error);
        alert("Hubo un error al intentar eliminar el registro.");
      }
    }
  };

  const mostrarNombreUnidad = (unidadValor: string) => {
    if (!unidadValor) return '-';
    if (unidadValor.length > 15 && catalogosCacheados.unidades) {
        const uni = catalogosCacheados.unidades.find((u:any) => u.id === unidadValor);
        return uni ? (uni.numeroEconomico || uni.nombre) : unidadValor;
    }
    return unidadValor;
  };

  const mostrarDatoMapeado = (id: string | null | undefined, catalogo: string, campoRetorno: string = 'nombre') => {
    if (!id) return '-';
    if (!catalogosCacheados[catalogo] || !Array.isArray(catalogosCacheados[catalogo])) return id;
    const elemento = catalogosCacheados[catalogo].find((item: any) => item.id === id);
    if (!elemento) return id;
    return elemento[campoRetorno] || elemento.nombre || elemento.descripcion || elemento.ref || id;
  };

  const formatoMoneda = (monto: any) => {
    if (monto === undefined || monto === null || monto === '') return '-';
    return `$ ${parseFloat(monto).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };
  
  // ✅ CORRECCIÓN: Se eliminó el parámetro "nuevoMtto" para limpiar la alerta ts(6133)
  const handleGuardado = () => {
    cargarDatos(); 
    setEstadoFormulario('cerrado');
    setMttoEditando(null);
  };

  const toggleSeleccion = (id: string) => {
    setGastosSeleccionados(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const aplicarInvoiceMasivo = async () => {
    if (!nuevoInvoiceTexto.trim()) return alert("Debes escribir un número o texto para el Invoice.");

    const idsValidos = gastosSeleccionados.filter(id => {
      const gasto = mttoGlobales.find(m => m.id === id);
      return gasto && !(gasto.estatus === 'Facturado' || (gasto.invoice && gasto.invoice.trim() !== ''));
    });

    if (idsValidos.length === 0) {
      alert("Ninguno de los gastos seleccionados es elegible para facturar.");
      setModalInvoiceMasivo(false);
      return;
    }

    setCargandoMasivo(true);
    try {
      const batch = writeBatch(db);
      const estatusFacturado = 'Facturado'; 

      idsValidos.forEach(id => {
        const docRef = doc(db, 'gastos_mtto', id);
        batch.update(docRef, { 
          invoice: nuevoInvoiceTexto.trim(),
          estatus: estatusFacturado 
        });
      });

      await batch.commit();
      await cargarDatos(); 

      alert(`Se aplicó el Invoice a ${idsValidos.length} registro(s) exitosamente.`);
      setModalInvoiceMasivo(false);
      setGastosSeleccionados([]); 
      setNuevoInvoiceTexto('');

    } catch (error) {
      console.error("Error en actualización masiva:", error);
      alert("Hubo un error al aplicar el Invoice masivo.");
    } finally {
      setCargandoMasivo(false);
    }
  };

  const registrosFiltrados = useMemo(() => {
    const b = busqueda.toLowerCase();
    return mttoGlobales.filter(m => (
      String(m.numeroGasto || '').toLowerCase().includes(b) ||
      String(m.invoice || '').toLowerCase().includes(b) ||
      String(m.estatus || '').toLowerCase().includes(b) ||
      String(m.operador || '').toLowerCase().includes(b) ||
      String(m.proveedorNombre || '').toLowerCase().includes(b)
    ));
  }, [busqueda, mttoGlobales]);

  const totalPaginas = Math.ceil(registrosFiltrados.length / registrosPorPagina);
  const indiceUltimoRegistro = paginaActual * registrosPorPagina;
  const indicePrimerRegistro = indiceUltimoRegistro - registrosPorPagina;
  const registrosEnPantalla = registrosFiltrados.slice(indicePrimerRegistro, indiceUltimoRegistro);
  
  const registrosElegibles = registrosEnPantalla.filter(m => !(m.estatus === 'Facturado' || (m.invoice && m.invoice.trim() !== '')));
  const isAllSelected = registrosElegibles.length > 0 && registrosElegibles.every(m => gastosSeleccionados.includes(m.id));

  const handleSelectAll = () => {
    const idsElegibles = registrosElegibles.map(m => m.id);
    if (idsElegibles.length === 0) return;
    if (isAllSelected) {
      setGastosSeleccionados(prev => prev.filter(id => !idsElegibles.includes(id)));
    } else {
      const idsNuevos = idsElegibles.filter(id => !gastosSeleccionados.includes(id));
      setGastosSeleccionados(prev => [...prev, ...idsNuevos]);
    }
  };

  const irPaginaSiguiente = () => setPaginaActual(prev => Math.min(prev + 1, totalPaginas));
  const irPaginaAnterior = () => setPaginaActual(prev => Math.max(prev - 1, 1));

  const exportarCSV = () => {
    if (registrosFiltrados.length === 0) return alert("No hay datos para exportar.");
    const encabezados = [
      '# de Gasto', '# de Invoice', 'Estatus', 'Fecha', 'Unidad', 'Operador', 
      'Descripcion', 'Proveedor', 'Tipo de Servicio', 'Autorizado por', 
      'Credito/Contado', 'Moneda', 'Importe', 'IVA', 'Ret IVA', 'Ret ISR', 
      'Total', 'Factura', 'Fecha Factura', 'Descripcion', 'Fecha de Pago', 
      'Forma de pago', 'Observaciones', 'Asignar Operacion'
    ];
    
    const lineas = registrosFiltrados.map(m => [
      `"${m.numeroGasto || ''}"`,
      `"${m.invoice || ''}"`, 
      `"${m.estatus || ''}"`,
      `"${m.fecha || ''}"`,
      `"${mostrarNombreUnidad(m.unidadId || m.unidad)}"`,
      `"${m.operador || ''}"`,
      `"${m.descripcion || m.descripcionGeneral || ''}"`,
      `"${m.proveedorNombre || mostrarDatoMapeado(m.proveedorId, 'empresas')}"`,
      `"${mostrarDatoMapeado(m.tipoServicioId, 'servicios')}"`,
      `"${m.autorizadoPor || ''}"`,
      `"${m.condicionPago || ''}"`,
      `"${mostrarDatoMapeado(m.monedaId, 'monedas')}"`,
      `"${Number(m.importe || 0).toFixed(2)}"`,
      `"${Number(m.ivaMonto || 0).toFixed(2)} (${m.ivaPorcentaje || 0}%)"`,
      `"${Number(m.retIva || 0).toFixed(2)}"`,
      `"${Number(m.retIsr || 0).toFixed(2)}"`,
      `"${Number(m.total || 0).toFixed(2)}"`,
      `"${m.facturaTexto || ''}"`,
      `"${m.fechaFactura || ''}"`,
      `"${m.descripcionFactura || ''}"`,
      `"${m.fechaPago || ''}"`,
      `"${mostrarDatoMapeado(m.formaPagoId, 'formasPago')}"`,
      `"${m.observaciones || ''}"`,
      `"${mostrarDatoMapeado(m.operacionAsignadaId, 'operaciones', 'ref')}"`
    ].join(','));

    const csvContent = [encabezados.join(','), ...lineas].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `MTTO_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const tabsDetalle = [
    { id: 'general', label: 'Información General' },
    { id: 'finanzas', label: 'Detalles Financieros' },
    { id: 'documentos', label: 'Documentos y Cierre' }
  ];

  return (
    <div className="module-container" style={{ padding: '24px', animation: 'fadeIn 0.3s ease', width: '100%', boxSizing: 'border-box' }}>
      
      <style>{`
        .detail-grid-3 {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 20px;
        }
        @media (max-width: 768px) {
          .detail-grid-3 {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      {estadoFormulario !== 'cerrado' && (
        <FormularioMtto 
          estado={estadoFormulario} 
          initialData={mttoEditando}
          onClose={() => { setEstadoFormulario('cerrado'); setMttoEditando(null); }}
          catalogos={catalogosCacheados} 
          onSave={handleGuardado}
        />
      )}

      {/* ✅ HEADER ESTILO OPERACIONES */}
      <div style={{ marginBottom: '24px' }}>
        <h1 className="module-title" style={{ fontSize: '1.8rem', color: '#f0f6fc', margin: '0 0 16px 0', fontWeight: 'bold' }}>
          Gastos Mantenimiento (MTTO)
        </h1>

        {/* TABS DEBAJO DEL TÍTULO */}
        <div style={{ display: 'flex', borderBottom: '1px solid #30363d', gap: '16px' }}>
          <button
            onClick={() => setVistaActiva('tabla')}
            style={{
              padding: '8px 16px', background: 'none', border: 'none',
              borderBottom: vistaActiva === 'tabla' ? '2px solid #D84315' : '2px solid transparent',
              color: vistaActiva === 'tabla' ? '#f0f6fc' : '#8b949e',
              cursor: 'pointer', fontWeight: vistaActiva === 'tabla' ? '600' : 'normal',
              fontSize: '0.95rem', transition: 'all 0.2s ease',
              display: 'flex', alignItems: 'center', gap: '8px'
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
            Todos los Gastos (MTTO)
          </button>
          <button
            onClick={() => setVistaActiva('agrupado')}
            style={{
              padding: '8px 16px', background: 'none', border: 'none',
              borderBottom: vistaActiva === 'agrupado' ? '2px solid #D84315' : '2px solid transparent',
              color: vistaActiva === 'agrupado' ? '#f0f6fc' : '#8b949e',
              cursor: 'pointer', fontWeight: vistaActiva === 'agrupado' ? '600' : 'normal',
              fontSize: '0.95rem', transition: 'all 0.2s ease',
              display: 'flex', alignItems: 'center', gap: '8px'
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
            Agrupados por Invoice
          </button>
        </div>
      </div>

      {/* ✅ ENRUTADOR DE VISTAS */}
      {vistaActiva === 'agrupado' ? (
        <MttoAgrupadosInvoice />
      ) : (
        <div style={{ width: '100%', margin: '0 auto' }}>

          {/* BARRA DE CONTROLES: ESTILO OPERACIONES */}
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '16px', marginBottom: '20px', width: '100%' }}>
            
            {/* Izquierda: Filtros y Buscador */}
            <div style={{ display: 'flex', gap: '12px', flex: '1 1 auto', maxWidth: '600px' }}>
              <div style={{ width: '150px' }}>
                <select className="form-control" style={{ width: '100%', backgroundColor: '#0d1117', border: '1px solid #30363d', color: '#c9d1d9', padding: '8px 12px', borderRadius: '6px' }}>
                  <option>Filtro: Todo</option>
                </select>
              </div>

              <div style={{ position: 'relative', width: '100%' }}>
                <svg style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#8b949e' }} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <input 
                  type="text" 
                  placeholder="Buscar por # Gasto, Invoice, Operador..." 
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px 8px 40px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', fontSize: '0.95rem', boxSizing: 'border-box' }}
                />
              </div>
            </div>

            {/* Derecha: Botones Cuadrados */}
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              {gastosSeleccionados.length > 0 && (
                <button 
                  onClick={() => setModalInvoiceMasivo(true)} 
                  style={{ backgroundColor: '#238636', color: '#ffffff', border: 'none', padding: '8px 16px', borderRadius: '6px', fontWeight: '500', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                  <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path fillRule="evenodd" d="M1.5 1.5A.5.5 0 0 0 1 2v4.8a2.5 2.5 0 0 0 2.5 2.5h9.793l-3.347 3.346a.5.5 0 0 0 .708.708l4.2-4.2a.5.5 0 0 0 0-.708l-4-4a.5.5 0 1 0-.708.708L13.293 8.3H3.5A1.5 1.5 0 0 1 2 6.8V2a.5.5 0 0 0-.5-.5z"/></svg>
                  Asignar Invoice ({gastosSeleccionados.length})
                </button>
              )}

              <button className="btn btn-outline" onClick={exportarCSV} style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#21262d', border: '1px solid #30363d', padding: '8px 16px', borderRadius: '6px', color: '#c9d1d9' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                Exportar CSV
              </button>
              <button className="btn btn-primary" onClick={handleNuevo} style={{ backgroundColor: '#D84315', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: '500' }}>
                + Agregar Gasto
              </button>
            </div>
          </div>

          {/* TABLA RESPONSIVE */}
          <div className="content-body" style={{ display: 'block', width: '100%' }}>
            <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 280px)', width: '100%' }}>
              {cargando ? (
                <div style={{ padding: '40px', textAlign: 'center', color: '#8b949e' }}>Descargando base de datos MTTO...</div>
              ) : (
                <table className="data-table" style={{ width: '100%', minWidth: '3200px', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead style={{ backgroundColor: '#161b22', position: 'sticky', top: 0, zIndex: 10 }}>
                    <tr>
                      <th style={{ padding: '16px 8px', width: '40px', textAlign: 'center', position: 'sticky', left: 0, backgroundColor: '#161b22', zIndex: 12, borderRight: '1px solid #30363d', borderBottom: '1px solid #30363d' }}>
                        <input 
                          type="checkbox" 
                          checked={isAllSelected}
                          onChange={handleSelectAll}
                          disabled={registrosElegibles.length === 0}
                          style={{ cursor: registrosElegibles.length === 0 ? 'not-allowed' : 'pointer', transform: 'scale(1.2)' }}
                        />
                      </th>

                      <th style={{ padding: '16px', width: '140px', textAlign: 'center', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', position: 'sticky', left: '56px', backgroundColor: '#161b22', zIndex: 12, borderRight: '1px solid #30363d', borderBottom: '1px solid #30363d' }}>
                        Acciones
                      </th>
                      <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}># de Gasto</th>
                      <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}># de Invoice</th>
                      <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Estatus</th>
                      <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Fecha</th>
                      <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Unidad</th>
                      <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Operador</th>
                      <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Descripción</th>
                      <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Proveedor</th>
                      <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Tipo de Servicio</th>
                      <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Autorizado por</th>
                      <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Crédito/Contado</th>
                      <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Moneda</th>
                      <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Importe</th>
                      <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>IVA</th>
                      <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Ret IVA</th>
                      <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Ret ISR</th>
                      <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Total</th>
                      <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Factura</th>
                      <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Fecha Factura</th>
                      <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Descripción (Factura)</th>
                      <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Fecha de Pago</th>
                      <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Forma de pago</th>
                      <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Observaciones</th>
                      <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Asignar Operación</th>
                    </tr>
                  </thead>
                  
                  <tbody>
                    {registrosEnPantalla.length === 0 ? (
                      <tr>
                        <td colSpan={26} style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>
                          {busqueda ? 'No se encontraron gastos para tu búsqueda.' : 'No hay gastos MTTO registrados.'}
                        </td>
                      </tr>
                    ) : (
                      registrosEnPantalla.map((m: any) => {
                        const isSelected = gastosSeleccionados.includes(m.id);
                        const yaFacturado = m.estatus === 'Facturado' || (m.invoice && m.invoice.trim() !== '');

                        return (
                        <tr 
                          key={m.id} 
                          style={{ borderBottom: '1px solid #21262d', backgroundColor: isSelected ? 'rgba(56, 139, 253, 0.1)' : (hoveredRowId === m.id ? '#21262d' : '#0d1117'), transition: 'background-color 0.2s', cursor: 'pointer' }}
                          onMouseEnter={() => setHoveredRowId(m.id)} 
                          onMouseLeave={() => setHoveredRowId(null)}
                          onClick={() => { setMttoViendo(m); setPestañaDetalleActiva('general'); }} 
                        >
                          <td style={{ padding: '16px 8px', textAlign: 'center', position: 'sticky', left: 0, backgroundColor: isSelected ? '#1f2937' : 'inherit', zIndex: 5, borderRight: '1px solid #30363d' }} onClick={(e: any) => e.stopPropagation()}>
                            {!yaFacturado && (
                              <input 
                                type="checkbox" 
                                checked={isSelected}
                                onChange={() => toggleSeleccion(m.id)}
                                style={{ cursor: 'pointer', transform: 'scale(1.2)' }}
                              />
                            )}
                          </td>

                          <td style={{ padding: '16px', textAlign: 'center', position: 'sticky', left: '56px', backgroundColor: isSelected ? '#1f2937' : 'inherit', zIndex: 5, borderRight: '1px solid #30363d' }} onClick={(e: any) => e.stopPropagation()}>
                            <div className="actions-cell" style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                              <button 
                                type="button"
                                className="btn-small btn-edit" 
                                onClick={(e) => { e.stopPropagation(); editarMtto(m); }}
                                style={{ background: 'transparent', border: '1px solid #3b82f6', borderRadius: '4px', color: '#3b82f6', cursor: 'pointer', padding: '4px 8px', fontSize: '0.8rem', transition: 'all 0.2s' }}
                                onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'}
                                onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                              >
                                Editar
                              </button>
                              <button 
                                type="button"
                                className="btn-small btn-danger-outline" 
                                onClick={(e) => { e.stopPropagation(); eliminarMtto(m.id); }}
                                style={{ background: 'transparent', border: '1px solid #ef4444', borderRadius: '4px', color: '#ef4444', cursor: 'pointer', padding: '4px 8px', fontSize: '0.8rem', transition: 'all 0.2s' }}
                                onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'}
                                onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                              >
                                Eliminar
                              </button>
                            </div>
                          </td>

                          <td className="font-mono" style={{ padding: '16px', color: '#58a6ff', fontWeight: 'bold', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>{m.numeroGasto || '-'}</td>
                          <td style={{ padding: '16px', color: '#c9d1d9', fontSize: '0.95rem', whiteSpace: 'nowrap', fontWeight: m.invoice ? 'bold' : 'normal' }}>{m.invoice || '-'}</td>
                          <td className="status-text" style={{ padding: '16px', color: m.estatus === 'Facturado' ? '#3fb950' : '#f85149', fontWeight: 'bold', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>{m.estatus || '-'}</td>
                          <td style={{ padding: '16px', color: '#c9d1d9', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>{m.fecha || '-'}</td>
                          <td style={{ padding: '16px', color: '#c9d1d9', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>{mostrarNombreUnidad(m.unidadId || m.unidad)}</td>
                          <td style={{ padding: '16px', color: '#c9d1d9', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>{m.operador || '-'}</td>
                          <td style={{ padding: '16px', color: '#c9d1d9', fontSize: '0.95rem', whiteSpace: 'nowrap', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }} title={m.descripcion || m.descripcionGeneral}>{m.descripcion || m.descripcionGeneral || '-'}</td>
                          <td style={{ padding: '16px', color: '#c9d1d9', fontSize: '0.95rem', whiteSpace: 'nowrap', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis' }} title={m.proveedorNombre || mostrarDatoMapeado(m.proveedorId, 'empresas')}>{m.proveedorNombre || mostrarDatoMapeado(m.proveedorId, 'empresas')}</td>
                          <td style={{ padding: '16px', color: '#c9d1d9', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>{mostrarDatoMapeado(m.tipoServicioId, 'servicios')}</td>
                          <td style={{ padding: '16px', color: '#c9d1d9', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>{m.autorizadoPor || '-'}</td>
                          <td style={{ padding: '16px', color: '#c9d1d9', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>{m.condicionPago || '-'}</td>
                          <td style={{ padding: '16px', color: '#c9d1d9', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>{mostrarDatoMapeado(m.monedaId, 'monedas')}</td>
                          <td style={{ padding: '16px', color: '#c9d1d9', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>{formatoMoneda(m.importe)}</td>
                          <td style={{ padding: '16px', color: '#c9d1d9', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>{formatoMoneda(m.ivaMonto)} <span style={{ color: '#8b949e', fontSize: '0.8rem' }}>({m.ivaPorcentaje || 0}%)</span></td>
                          <td style={{ padding: '16px', color: '#f85149', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>{formatoMoneda(m.retIva)}</td>
                          <td style={{ padding: '16px', color: '#f85149', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>{formatoMoneda(m.retIsr)}</td>
                          <td style={{ padding: '16px', color: '#3fb950', fontWeight: 'bold', fontSize: '1rem', whiteSpace: 'nowrap' }}>{formatoMoneda(m.total)}</td>
                          <td style={{ padding: '16px', color: '#c9d1d9', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>{m.facturaTexto || '-'}</td>
                          <td style={{ padding: '16px', color: '#c9d1d9', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>{m.fechaFactura || '-'}</td>
                          <td style={{ padding: '16px', color: '#c9d1d9', fontSize: '0.95rem', whiteSpace: 'nowrap', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }} title={m.descripcionFactura}>{m.descripcionFactura || '-'}</td>
                          <td style={{ padding: '16px', color: '#c9d1d9', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>{m.fechaPago || '-'}</td>
                          <td style={{ padding: '16px', color: '#c9d1d9', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>{mostrarDatoMapeado(m.formaPagoId, 'formasPago')}</td>
                          <td style={{ padding: '16px', color: '#c9d1d9', fontSize: '0.95rem', whiteSpace: 'nowrap', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }} title={m.observaciones}>{m.observaciones || '-'}</td>
                          <td style={{ padding: '16px', color: '#58a6ff', fontSize: '0.95rem', whiteSpace: 'nowrap', fontWeight: '500' }}>{mostrarDatoMapeado(m.operacionAsignadaId, 'operaciones', 'ref')}</td>
                        </tr>
                      );
                      })
                    )}
                  </tbody>
                </table>
              )}
            </div>

            {/* CONTROLES DE PAGINACIÓN */}
            {registrosFiltrados.length > 0 && !cargando && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', padding: '0 8px', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ color: '#8b949e', fontSize: '0.9rem' }}>
                  Mostrando {indicePrimerRegistro + 1} - {Math.min(indiceUltimoRegistro, registrosFiltrados.length)} de {registrosFiltrados.length} gastos
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={irPaginaAnterior} disabled={paginaActual === 1} style={{ padding: '6px 12px', backgroundColor: paginaActual === 1 ? '#0d1117' : '#21262d', color: paginaActual === 1 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === 1 ? 'not-allowed' : 'pointer' }}>Anterior</button>
                  <span style={{ padding: '6px 12px', color: '#f0f6fc', fontWeight: 'bold' }}>{paginaActual} / {totalPaginas || 1}</span>
                  <button onClick={irPaginaSiguiente} disabled={paginaActual === totalPaginas || totalPaginas === 0} style={{ padding: '6px 12px', backgroundColor: paginaActual === totalPaginas || totalPaginas === 0 ? '#0d1117' : '#21262d', color: paginaActual === totalPaginas || totalPaginas === 0 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === totalPaginas || totalPaginas === 0 ? 'not-allowed' : 'pointer' }}>Siguiente</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ✅ MODAL INVOICE MASIVO */}
      {modalInvoiceMasivo && (
        <div className="modal-overlay" style={{ zIndex: 3000 }}>
          <div className="form-card" style={{ maxWidth: '450px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px' }}>
            <div className="form-header" style={{ padding: '16px 24px', borderBottom: '1px solid #30363d', display: 'flex', justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.25rem' }}>Asignar Invoice Masivo</h2>
              <button onClick={() => setModalInvoiceMasivo(false)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>
            <div style={{ padding: '24px' }}>
              <p style={{ color: '#8b949e', fontSize: '0.9rem', marginBottom: '20px' }}>
                Estás a punto de asignar el mismo número de Invoice a <strong>{gastosSeleccionados.length}</strong> registro(s). El estatus de todos pasará automáticamente a <span style={{ color: '#3fb950', fontWeight: 'bold' }}>Facturado</span>.
              </p>
              <div className="form-group">
                <label style={{ display: 'block', marginBottom: '8px', color: '#c9d1d9', fontSize: '0.85rem', fontWeight: 'bold' }}>Número de Invoice a Asignar</label>
                <input 
                  type="text" 
                  placeholder="Ej: INV-99234"
                  value={nuevoInvoiceTexto} 
                  onChange={e => setNuevoInvoiceTexto(e.target.value)} 
                  autoFocus
                  style={{ width: '100%', padding: '12px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '6px', color: '#f0f6fc', fontSize: '1.1rem' }} 
                />
              </div>
            </div>
            <div className="form-actions" style={{ padding: '16px 24px', display: 'flex', justifyContent: 'flex-end', gap: '12px', borderTop: '1px solid #30363d', backgroundColor: '#161b22', borderBottomLeftRadius: '8px', borderBottomRightRadius: '8px' }}>
              <button onClick={() => setModalInvoiceMasivo(false)} disabled={cargandoMasivo} className="btn btn-outline" style={{ padding: '8px 16px', borderRadius: '6px' }}>Cancelar</button>
              <button onClick={aplicarInvoiceMasivo} disabled={cargandoMasivo || !nuevoInvoiceTexto.trim()} className="btn btn-primary" style={{ padding: '8px 16px', borderRadius: '6px', backgroundColor: '#238636', border: 'none' }}>
                {cargandoMasivo ? 'Aplicando...' : 'Aplicar a Seleccionados'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ✅ VISTA: MODAL DETALLES ELEGANTES EN PESTAÑAS (TABS) */}
      {mttoViendo && (
        <div className="modal-overlay" style={{ backdropFilter: 'blur(4px)', zIndex: 1500, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px' }}>
          <div className="form-card detail-card" style={{ maxWidth: '1000px', width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', backgroundColor: '#0d1117', borderRadius: '12px', border: '1px solid #30363d', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
            
            {/* HEADER DEL MODAL */}
            <div className="form-header" style={{ padding: '20px 24px', borderBottom: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <h2 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.25rem' }}>
                Detalles del Gasto <span style={{ color: '#58a6ff' }}>{mttoViendo.numeroGasto || '-'}</span>
              </h2>
              <button 
                onClick={() => { setMttoViendo(null); setPestañaDetalleActiva('general'); }} 
                style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '32px', height: '32px', borderRadius: '50%', transition: 'background-color 0.2s' }}
                onMouseEnter={(e:any) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)'}
                onMouseLeave={(e:any) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                ✕
              </button>
            </div>

            {/* ✅ SISTEMA DE PESTAÑAS (TABS) */}
            <div style={{ display: 'flex', borderBottom: '1px solid #30363d', padding: '0 24px', overflowX: 'auto', flexShrink: 0 }}>
              {tabsDetalle.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setPestañaDetalleActiva(tab.id)}
                  style={{
                    padding: '12px 16px',
                    background: 'none',
                    border: 'none',
                    borderBottom: pestañaDetalleActiva === tab.id ? '2px solid #D84315' : '2px solid transparent',
                    color: pestañaDetalleActiva === tab.id ? '#f0f6fc' : '#8b949e',
                    cursor: 'pointer',
                    fontWeight: pestañaDetalleActiva === tab.id ? '600' : 'normal',
                    fontSize: '0.9rem',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.2s'
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* CONTENIDO DEL DETALLE (SCROLLABLE) */}
            <div className="detail-content" style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
              
              {/* PESTAÑA 1: INFORMACIÓN GENERAL */}
              {pestañaDetalleActiva === 'general' && (
                <div style={{ animation: 'fadeIn 0.2s ease' }}>
                  <h3 style={{ color: '#D84315', marginBottom: '20px', borderBottom: '1px solid #30363d', paddingBottom: '10px', fontSize: '1.1rem' }}>
                    Información Básica
                  </h3>
                  <div className="detail-grid-3">
                    <div>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px', textTransform: 'uppercase' }}># de Gasto</span>
                      <span style={{ color: '#58a6ff', fontWeight: 'bold', fontSize: '0.95rem' }}>{mttoViendo.numeroGasto || '-'}</span>
                    </div>
                    <div>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px', textTransform: 'uppercase' }}># de Invoice</span>
                      <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '0.95rem' }}>{mttoViendo.invoice || '-'}</span>
                    </div>
                    <div>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px', textTransform: 'uppercase' }}>Estatus</span>
                      <span style={{ color: mttoViendo.estatus === 'Facturado' ? '#3fb950' : '#f85149', fontWeight: 'bold', fontSize: '0.95rem' }}>{mttoViendo.estatus || '-'}</span>
                    </div>
                    <div>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold', marginBottom: '4px', textTransform: 'uppercase' }}>Fecha</span>
                      <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '0.95rem' }}>{mttoViendo.fecha || '-'}</span>
                    </div>
                    <div>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px', textTransform: 'uppercase' }}>Tipo de Gasto</span>
                      <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '0.95rem' }}>{mttoViendo.tipoGasto || '-'}</span>
                    </div>
                    <div>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px', textTransform: 'uppercase' }}>Unidad</span>
                      <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '0.95rem' }}>{mostrarNombreUnidad(mttoViendo.unidadId || mttoViendo.unidad)}</span>
                    </div>
                    <div>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px', textTransform: 'uppercase' }}>Operador</span>
                      <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '0.95rem' }}>{mttoViendo.operador || '-'}</span>
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px', textTransform: 'uppercase' }}>Descripción General</span>
                      <div style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '0.95rem', backgroundColor: '#161b22', padding: '12px', borderRadius: '6px', border: '1px solid #30363d', marginTop: '4px' }}>
                        {mttoViendo.descripcion || mttoViendo.descripcionGeneral || '-'}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* PESTAÑA 2: DETALLES FINANCIEROS */}
              {pestañaDetalleActiva === 'finanzas' && (
                <div style={{ animation: 'fadeIn 0.2s ease' }}>
                  <h3 style={{ color: '#D84315', marginBottom: '20px', borderBottom: '1px solid #30363d', paddingBottom: '10px', fontSize: '1.1rem' }}>
                    Información Financiera
                  </h3>
                  <div className="detail-grid-3">
                    <div style={{ gridColumn: '1 / -1' }}>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px', textTransform: 'uppercase' }}>Proveedor</span>
                      <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '0.95rem' }}>{mttoViendo.proveedorNombre || mostrarDatoMapeado(mttoViendo.proveedorId, 'empresas')}</span>
                    </div>
                    <div>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px', textTransform: 'uppercase' }}>Tipo de Servicio</span>
                      <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '0.95rem' }}>{mostrarDatoMapeado(mttoViendo.tipoServicioId, 'servicios')}</span>
                    </div>
                    <div>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px', textTransform: 'uppercase' }}>Condición de Pago</span>
                      <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '0.95rem' }}>{mttoViendo.condicionPago || '-'}</span>
                    </div>
                    <div>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px', textTransform: 'uppercase' }}>Moneda</span>
                      <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '0.95rem' }}>{mostrarDatoMapeado(mttoViendo.monedaId, 'monedas')}</span>
                    </div>
                    
                    <div style={{ gridColumn: '1 / -1' }}><hr style={{ borderColor: '#30363d', margin: '8px 0' }} /></div>

                    <div>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px', textTransform: 'uppercase' }}>Importe (Monto Base)</span>
                      <span style={{ color: '#58a6ff', fontWeight: 'bold', fontSize: '1rem' }}>{formatoMoneda(mttoViendo.importe)}</span>
                    </div>
                    <div>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px', textTransform: 'uppercase' }}>IVA (+)</span>
                      <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '0.95rem' }}>{formatoMoneda(mttoViendo.ivaMonto)} <span style={{ color: '#8b949e', fontSize: '0.8rem' }}>({mttoViendo.ivaPorcentaje || 0}%)</span></span>
                    </div>
                    <div></div> {/* Spacer */}
                    
                    <div>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px', textTransform: 'uppercase' }}>Ret IVA (-)</span>
                      <span style={{ color: '#f85149', fontWeight: '500', fontSize: '0.95rem' }}>{formatoMoneda(mttoViendo.retIva)}</span>
                    </div>
                    <div>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px', textTransform: 'uppercase' }}>Ret ISR (-)</span>
                      <span style={{ color: '#f85149', fontWeight: '500', fontSize: '0.95rem' }}>{formatoMoneda(mttoViendo.retIsr)}</span>
                    </div>

                    <div style={{ gridColumn: 'span 3', marginTop: '16px' }}>
                      <div style={{ backgroundColor: '#0d1117', border: '1px solid #3fb950', padding: '20px', borderRadius: '8px', textAlign: 'center' }}>
                        <span style={{ display: 'block', fontSize: '0.85rem', color: '#8b949e', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>TOTAL FINAL</span>
                        <span style={{ fontSize: '2rem', color: '#3fb950', fontWeight: 'bold' }}>{formatoMoneda(mttoViendo.total)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* PESTAÑA 3: DOCUMENTOS Y CIERRE */}
              {pestañaDetalleActiva === 'documentos' && (
                <div style={{ animation: 'fadeIn 0.2s ease' }}>
                  <h3 style={{ color: '#D84315', marginBottom: '20px', borderBottom: '1px solid #30363d', paddingBottom: '10px', fontSize: '1.1rem' }}>
                    Documentos, Facturación y Cierre
                  </h3>
                  <div className="detail-grid-3">
                    <div>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px', textTransform: 'uppercase' }}>Factura (Texto)</span>
                      <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '0.95rem' }}>{mttoViendo.facturaTexto || '-'}</span>
                    </div>
                    <div>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px', textTransform: 'uppercase' }}>Descripción Factura</span>
                      <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '0.95rem' }}>{mttoViendo.descripcionFactura || '-'}</span>
                    </div>
                    <div>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px', textTransform: 'uppercase' }}>Fecha de Pago</span>
                      <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '0.95rem' }}>{mttoViendo.fechaPago || '-'}</span>
                    </div>
                    <div>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px', textTransform: 'uppercase' }}>Forma de Pago</span>
                      <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '0.95rem' }}>{mostrarDatoMapeado(mttoViendo.formaPagoId, 'formasPago')}</span>
                    </div>
                    <div>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px', textTransform: 'uppercase' }}>Autorizado Por</span>
                      <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '0.95rem' }}>{mttoViendo.autorizadoPor || '-'}</span>
                    </div>
                    <div>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px', textTransform: 'uppercase' }}>Asignar a Operación</span>
                      <span style={{ color: '#58a6ff', fontWeight: '500', fontSize: '0.95rem' }}>{mostrarDatoMapeado(mttoViendo.operacionAsignadaId, 'operaciones', 'ref')}</span>
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px', textTransform: 'uppercase' }}>Observaciones</span>
                      <div style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '0.95rem', backgroundColor: '#161b22', padding: '12px', borderRadius: '6px', border: '1px solid #30363d', minHeight: '60px', marginTop: '4px' }}>
                        {mttoViendo.observaciones || '-'}
                      </div>
                    </div>
                  </div>
                </div>
              )}

            </div>

            {/* PIE DEL MODAL DE DETALLE */}
            <div className="form-actions detail-actions" style={{ padding: '16px 24px', borderTop: '1px solid #30363d', display: 'flex', justifyContent: 'flex-end', backgroundColor: '#161b22', borderBottomLeftRadius: '12px', borderBottomRightRadius: '12px', flexShrink: 0 }}>
              <button onClick={() => { setMttoViendo(null); setPestañaDetalleActiva('general'); }} className="btn btn-outline" style={{ padding: '8px 24px', borderRadius: '6px' }}>
                Cerrar Detalles
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default MttoDashboard;
