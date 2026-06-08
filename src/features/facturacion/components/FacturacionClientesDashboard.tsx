// src/features/facturacion/components/FacturacionClientesDashboard.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  onSnapshot, 
  query, 
  writeBatch, 
  doc, 
  limit,
  orderBy,
  where,
  getDocs
} from 'firebase/firestore';
import { db } from '../../../config/firebase';
import * as XLSX from 'xlsx';

// ✅ NUEVO: constantes
const ID_TIPO_CLIENTE_PAGA = '7eec9cbb';
const STATUS_COMPLETADOS = ['f557b751', 'c2d57403'];
const LIMITE_OPERACIONES_CLIENTE = 100;

export const FacturacionClientesDashboard = () => {
  const [activeTab, setActiveTab] = useState<'operaciones' | 'historial'>('historial');
  
  const [operacionesGlobales, setOperacionesGlobales] = useState<any[]>([]);
  const [facturasGlobales, setFacturasGlobales] = useState<any[]>([]);
  const [cargandoOperaciones, setCargandoOperaciones] = useState(false);
  const [cargandoFacturas, setCargandoFacturas] = useState(false);
  
  // Catálogos
  const [empresasList, setEmpresasList] = useState<any[]>([]);

  // Filtros Pestaña 1
  const [filtroCliente, setFiltroCliente] = useState('');
  const [seleccionadas, setSeleccionadas] = useState<string[]>([]);

  // ✅ NUEVO: buscador de cliente
  const [textoBuscarCliente, setTextoBuscarCliente] = useState('');
  const [mostrarSugerenciasCliente, setMostrarSugerenciasCliente] = useState(false);

  // Paginación Historial
  const [paginaActual, setPaginaActual] = useState(1);
  const registrosPorPagina = 50;

  // Estado del Modal de Facturación
  const [modalAbierto, setModalAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [facturaViendo, setFacturaViendo] = useState<any | null>(null);

  // Campos del Formulario
  const [invoiceForm, setInvoiceForm] = useState('');
  const [fechaForm, setFechaForm] = useState(new Date().toISOString().split('T')[0]);
  const [facturaCcpForm, setFacturaCcpForm] = useState('');

  const formatoMoneda = (monto: any) => {
    const num = parseFloat(monto || 0);
    return isNaN(num) ? '$ 0.00' : `$ ${num.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatearFechaSpanish = (fechaString: string) => {
    if (!fechaString) return '-';
    try { 
      return new Date(fechaString + 'T00:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }); 
    } catch { return fechaString; }
  };

  // ✅ 1. CARGA DE EMPRESAS (se necesita en ambas pestañas para el buscador de cliente)
  useEffect(() => {
    const unSubEmpresas = onSnapshot(collection(db, 'empresas'), (snap) => {
      setEmpresasList(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });
    return () => { unSubEmpresas(); };
  }, []);

  // ✅ 2. CARGA DE FACTURAS DEL CLIENTE (sólo cuando hay cliente seleccionado).
  //    Antes se descargaban las 400 facturas más recientes globalmente; ahora sólo del cliente.
  //    Fallbacks:
  //      1) where(clienteId) + orderBy(createdAt desc) + limit(100)  [requiere índice]
  //      2) where(clienteId) + limit(100), ordena en memoria
  useEffect(() => {
    if (!filtroCliente) { setFacturasGlobales([]); return; }

    const descargarFacturasCliente = async () => {
      setCargandoFacturas(true);
      try {
        // [1] Query óptima
        const q1 = query(
          collection(db, 'facturas_clientes'),
          where('clienteId', '==', filtroCliente),
          orderBy('createdAt', 'desc'),
          limit(100)
        );
        const snap = await getDocs(q1);
        const docs = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
        setFacturasGlobales(docs);
      } catch (e1: any) {
        const msg1 = String(e1?.message || e1?.code || e1 || '');
        const esIndice = msg1.toLowerCase().includes('index') || msg1.toLowerCase().includes('failed-precondition');
        if (esIndice) {
          console.warn('[Facturación Historial] Falta índice. Crea el índice:', msg1);
          try {
            // [2] Fallback sin orderBy
            const q2 = query(
              collection(db, 'facturas_clientes'),
              where('clienteId', '==', filtroCliente),
              limit(100)
            );
            const snap2 = await getDocs(q2);
            const docs = snap2.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
            docs.sort((a: any, b: any) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
            setFacturasGlobales(docs);
          } catch (e2: any) {
            console.error('[Facturación Historial] Fallback falló:', e2);
            alert(`No se pudieron cargar las facturas.\n\nDetalle: ${e2?.message || e2}`);
          }
        } else {
          console.error('[Facturación Historial] Error:', e1);
          alert(`Hubo un problema al cargar las facturas.\n\nDetalle: ${msg1}`);
        }
      }
      setCargandoFacturas(false);
    };

    descargarFacturasCliente();
  }, [filtroCliente]);

  // ✅ 3. CARGA DE OPERACIONES DEL CLIENTE (cuando entra a pestaña Asignar y hay cliente)
  //    Estrategia con fallbacks:
  //      1) where(clientePaga) + where(status in [...]) + orderBy(fechaServicio desc) + limit(100)
  //      2) sin orderBy si falta índice; ordenar en memoria
  //      3) legacy: solo where(clientePaga) + limit(500), filtrar en memoria
  useEffect(() => {
    if (activeTab !== 'operaciones') return;
    if (!filtroCliente) { setOperacionesGlobales([]); return; }

    const descargarOperacionesCliente = async () => {
      setCargandoOperaciones(true);
      const filtrarLegacy = (ops: any[]) => ops.filter((op: any) =>
        STATUS_COMPLETADOS.includes(String(op.status || '').trim())
      );

      let opsFinal: any[] = [];
      let exito = false;

      try {
        // [1] Query óptima
        const q1 = query(
          collection(db, 'operaciones'),
          where('clientePaga', '==', filtroCliente),
          where('status', 'in', STATUS_COMPLETADOS),
          orderBy('fechaServicio', 'desc'),
          limit(LIMITE_OPERACIONES_CLIENTE)
        );
        const snap = await getDocs(q1);
        opsFinal = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
        exito = true;
      } catch (e1: any) {
        const msg1 = String(e1?.message || e1?.code || e1 || '');
        const esIndice = msg1.toLowerCase().includes('index') || msg1.toLowerCase().includes('failed-precondition');
        if (esIndice) {
          console.warn('[Facturación] Query óptima falló (falta índice). Crea el índice:', msg1);
          try {
            // [2] Fallback sin orderBy
            const q2 = query(
              collection(db, 'operaciones'),
              where('clientePaga', '==', filtroCliente),
              where('status', 'in', STATUS_COMPLETADOS),
              limit(LIMITE_OPERACIONES_CLIENTE * 2)
            );
            const snap2 = await getDocs(q2);
            opsFinal = snap2.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
            opsFinal.sort((a, b) => String(b.fechaServicio || '').localeCompare(String(a.fechaServicio || '')));
            opsFinal = opsFinal.slice(0, LIMITE_OPERACIONES_CLIENTE);
            exito = true;
            console.warn('[Facturación] Usando fallback sin orderBy.');
          } catch (e2: any) {
            const msg2 = String(e2?.message || e2 || '');
            console.warn('[Facturación] Fallback 1 falló, probando legacy:', msg2);
            try {
              // [3] Legacy: solo where cliente + limit alto, filtrar en memoria
              const q3 = query(
                collection(db, 'operaciones'),
                where('clientePaga', '==', filtroCliente),
                limit(500)
              );
              const snap3 = await getDocs(q3);
              const todas = snap3.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
              opsFinal = filtrarLegacy(todas);
              opsFinal.sort((a, b) => String(b.fechaServicio || '').localeCompare(String(a.fechaServicio || '')));
              opsFinal = opsFinal.slice(0, LIMITE_OPERACIONES_CLIENTE);
              exito = true;
              console.warn('[Facturación] Usando fallback legacy.');
            } catch (e3: any) {
              console.error('[Facturación] Todos los intentos fallaron:', e3);
              alert(`No se pudieron cargar las operaciones del cliente.\n\nDetalle: ${e3?.message || e3}`);
            }
          }
        } else {
          console.error('[Facturación] Error inesperado:', e1);
          alert(`Hubo un problema al cargar las operaciones.\n\nDetalle: ${msg1}`);
        }
      }

      if (exito) setOperacionesGlobales(opsFinal);
      setCargandoOperaciones(false);
    };

    descargarOperacionesCliente();
  }, [filtroCliente, activeTab]);

  // ✅ TRADUCTOR DE CLIENTES
  const getNombreCliente = (idOrName: string) => {
    if (!idOrName) return '-';
    const found = empresasList.find(e => e.id === idOrName || e.nombre === idOrName || e.nombreCorto === idOrName);
    return found ? (found.nombre || found.nombreCorto || idOrName) : idOrName;
  };

  // ✅ NUEVO: clientes filtrados para el buscador (tiposEmpresa contiene 7eec9cbb)
  const clientesFiltradosBuscador = useMemo(() => {
    if (!empresasList.length) return [];

    const esClientePaga = (emp: any) => {
      const tipos = emp?.tiposEmpresa;
      if (Array.isArray(tipos)) return tipos.some((t: any) => String(t).trim() === ID_TIPO_CLIENTE_PAGA);
      if (typeof tipos === 'string') return tipos.includes(ID_TIPO_CLIENTE_PAGA);
      if (tipos && typeof tipos === 'object') return Object.values(tipos).some((v: any) => String(v).trim() === ID_TIPO_CLIENTE_PAGA);
      return false;
    };

    const clientes = empresasList
      .filter(esClientePaga)
      .sort((a: any, b: any) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es', { sensitivity: 'base' }));

    if (!textoBuscarCliente.trim()) return clientes.slice(0, 30);

    const q = textoBuscarCliente.toLowerCase().trim();
    return clientes.filter((c: any) =>
      String(c.nombre || '').toLowerCase().includes(q) ||
      String(c.rfc || '').toLowerCase().includes(q)
    ).slice(0, 30);
  }, [empresasList, textoBuscarCliente]);

  const nombreClienteSeleccionado = useMemo(() => {
    if (!filtroCliente || !empresasList.length) return '';
    const cli = empresasList.find(e => e.id === filtroCliente);
    return cli?.nombre || filtroCliente;
  }, [filtroCliente, empresasList]);

  // ✅ EXTRAER LA MONEDA DEL CLIENTE SELECCIONADO
  const monedaFacturacion = useMemo(() => {
    if (!filtroCliente) return '-';
    const empresa = empresasList.find(e => e.id === filtroCliente);
    if (!empresa) return '-';
    
    const idMoneda = empresa.monedaRef || empresa.moneda;
    if (idMoneda === 'f95d8894') return 'MXN';
    if (idMoneda === '7dca62b3') return 'USD';
    return idMoneda || 'No definida en catálogo';
  }, [filtroCliente, empresasList]);

  // ✅ MODIFICADO: las operaciones ya vienen del cliente con status correcto.
  //    Sólo filtramos en memoria las que aún no estén facturadas.
  const operacionesPendientes = useMemo(() => {
    if (!filtroCliente) return [];
    return operacionesGlobales.filter(op => !op.facturaClienteId && !op.facturado);
  }, [operacionesGlobales, filtroCliente]);

  const toggleSeleccion = (id: string) => {
    setSeleccionadas(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
  };

  const resumenSeleccion = useMemo(() => {
    let subtotal = 0;
    const refs: string[] = [];
    seleccionadas.forEach(id => {
      const op = operacionesGlobales.find(o => o.id === id);
      if (op) {
        subtotal += Number(op.totalFacturar || op.total || op.subtotalCliente || 0);
        refs.push(op.numReferencia || op.referencia || op.ref || op.id?.substring(0,6));
      }
    });
    return { subtotal, refs };
  }, [seleccionadas, operacionesGlobales]);

  // ✅ GUARDADO DE LA FACTURA (Desnormalizado Estricto)
  const handleGuardarFactura = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoiceForm.trim()) return alert("El # de Invoice es obligatorio.");
    setGuardando(true);
    
    try {
      const batch = writeBatch(db);
      const nuevoId = doc(collection(db, 'facturas_clientes')).id;

      // Generamos el array estático de operaciones para el historial
      const operacionesResumenEstable = seleccionadas.map(id => {
        const op = operacionesGlobales.find(o => o.id === id);
        return {
          id: id,
          ref: op?.numReferencia || op?.referencia || op?.ref || id.substring(0,6),
          monto: Number(op?.totalFacturar || op?.total || op?.subtotalCliente || 0)
        };
      });

      const data = {
        invoice: invoiceForm.trim(),
        fecha: fechaForm,
        facturaCcp: facturaCcpForm.trim(),
        clienteId: filtroCliente,
        clienteNombre: getNombreCliente(filtroCliente),
        monedaFacturacion: monedaFacturacion, // Guardamos la moneda estática
        operacionesIds: seleccionadas,
        operacionesGuardadas: operacionesResumenEstable,
        subtotalFactura: resumenSeleccion.subtotal,
        createdAt: new Date().toISOString()
      };

      batch.set(doc(db, 'facturas_clientes', nuevoId), data);
      
      seleccionadas.forEach(id => {
        batch.update(doc(db, 'operaciones', id), { 
          facturaClienteId: nuevoId, 
          facturaClienteInvoice: invoiceForm.trim(),
          facturado: true
        });
      });

      await batch.commit();
      setModalAbierto(false);
      setSeleccionadas([]);
      setInvoiceForm('');
      setFacturaCcpForm('');
      // Actualizar estado local para reflejar el cambio inmediatamente
      setOperacionesGlobales(prev => prev.map(op =>
        seleccionadas.includes(op.id) ? { ...op, facturaClienteId: nuevoId, facturaClienteInvoice: invoiceForm.trim(), facturado: true } : op
      ));
      // ✅ NUEVO: agregar la nueva factura al historial local (sino no aparecería hasta recargar)
      setFacturasGlobales(prev => [{ id: nuevoId, ...data }, ...prev]);
      setActiveTab('historial');
    } catch (error) {
      console.error(error);
      alert("Error al guardar la factura.");
    } finally {
      setGuardando(false);
    }
  };

  const handleEliminarFactura = async (e: React.MouseEvent, facData: any) => {
    e.stopPropagation();
    if (window.confirm(`¿Estás seguro de eliminar la factura ${facData.invoice}? Las operaciones asociadas quedarán liberadas nuevamente.`)) {
      try {
        const batch = writeBatch(db);
        batch.delete(doc(db, 'facturas_clientes', facData.id));

        if (Array.isArray(facData.operacionesIds)) {
          facData.operacionesIds.forEach((opId: string) => {
            batch.update(doc(db, 'operaciones', opId), {
              facturaClienteId: null,
              facturaClienteInvoice: null,
              facturado: false
            });
          });
        }
        await batch.commit();
        // ✅ NUEVO: quitar la factura del listado local sin recargar
        setFacturasGlobales(prev => prev.filter(f => f.id !== facData.id));
      } catch (error) {
        console.error("Error al eliminar factura:", error);
        alert("Hubo un error al eliminar.");
      }
    }
  };

  // ✅ MODIFICADO: ya no hay búsqueda libre; las facturas vienen filtradas por cliente desde Firestore.
  const historialFiltrado = facturasGlobales;

  const totalPaginas = Math.ceil(historialFiltrado.length / registrosPorPagina);
  const indexLast = paginaActual * registrosPorPagina;
  const indexFirst = indexLast - registrosPorPagina;
  const registrosVisibles = historialFiltrado.slice(indexFirst, indexLast);

  const irPaginaSiguiente = () => setPaginaActual(p => Math.min(p + 1, totalPaginas));
  const irPaginaAnterior = () => setPaginaActual(p => Math.max(p - 1, 1));

  const exportarCSV = () => {
    if (historialFiltrado.length === 0) return alert("No hay datos para exportar.");
    const datosExcel = historialFiltrado.map(f => ({
      'Invoice': f.invoice,
      'Cliente': f.clienteNombre,
      'Fecha Factura': formatearFechaSpanish(f.fecha),
      'Factura CCP': f.facturaCcp || '-',
      'Moneda': f.monedaFacturacion || 'N/A',
      'Cant. Operaciones': f.operacionesIds?.length || 0,
      'Total Facturado': f.subtotalFactura
    }));

    const worksheet = XLSX.utils.json_to_sheet(datosExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Facturas_Clientes');
    XLSX.writeFile(workbook, `Facturas_Clientes_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const tabStyle = (active: boolean) => ({
    padding: '12px 24px', background: 'none', border: 'none', cursor: 'pointer',
    color: active ? '#f0f6fc' : '#8b949e', borderBottom: active ? '2px solid #D84315' : '2px solid transparent',
    fontWeight: active ? 'bold' : 'normal' as any
  });

  return (
    <div className="module-container" style={{ padding: '24px', animation: 'fadeIn 0.3s ease' }}>
      <h1 style={{ color: '#f0f6fc', fontSize: '1.5rem', marginBottom: '24px' }}>Facturación de Clientes</h1>

      <div style={{ display: 'flex', borderBottom: '1px solid #30363d', marginBottom: '24px' }}>
        <button onClick={() => setActiveTab('operaciones')} style={tabStyle(activeTab === 'operaciones')}>Asignar Operaciones</button>
        <button onClick={() => setActiveTab('historial')} style={tabStyle(activeTab === 'historial')}>Historial de Facturas</button>
      </div>

      {activeTab === 'operaciones' ? (
        <div className="animation-fade-in">
          
          {/* ✅ MODIFICADO: buscador autocompletado en vez de select */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', marginBottom: '20px', alignItems: 'flex-end', backgroundColor: '#0d1117', padding: '20px', borderRadius: '8px', border: '1px solid #30363d' }}>
            <div style={{ flex: 1, minWidth: '320px', position: 'relative' }}>
              <label style={{ color: '#10b981', fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>CLIENTE ★</label>

              {filtroCliente ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px', backgroundColor: '#161b22', border: '1px solid #10b981', borderRadius: '6px', minHeight: '20px' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                  <span style={{ color: '#10b981', fontWeight: 'bold', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nombreClienteSeleccionado}</span>
                  <button
                    onClick={() => { setFiltroCliente(''); setTextoBuscarCliente(''); setMostrarSugerenciasCliente(false); setSeleccionadas([]); }}
                    title="Cambiar cliente"
                    style={{ background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', padding: '0 4px', fontSize: '1rem', lineHeight: 1 }}
                  >✕</button>
                </div>
              ) : (
                <div style={{ position: 'relative' }}>
                  <svg style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#10b981' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                  <input
                    type="text"
                    placeholder="Buscar cliente por nombre o RFC..."
                    value={textoBuscarCliente}
                    onChange={(e) => { setTextoBuscarCliente(e.target.value); setMostrarSugerenciasCliente(true); }}
                    onFocus={() => setMostrarSugerenciasCliente(true)}
                    onBlur={() => setTimeout(() => setMostrarSugerenciasCliente(false), 180)}
                    style={{ width: '100%', padding: '10px 10px 10px 32px', backgroundColor: '#161b22', border: '1px solid #10b981', borderRadius: '6px', color: '#c9d1d9', fontSize: '0.9rem', boxSizing: 'border-box' }}
                  />
                </div>
              )}

              {!filtroCliente && mostrarSugerenciasCliente && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0,
                  backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px',
                  maxHeight: '320px', overflowY: 'auto', zIndex: 100, marginTop: '4px',
                  boxShadow: '0 6px 16px rgba(0,0,0,0.5)'
                }}>
                  {clientesFiltradosBuscador.length === 0 ? (
                    <div style={{ padding: '14px', color: '#8b949e', fontSize: '0.85rem', textAlign: 'center' }}>
                      {textoBuscarCliente.trim() ? 'Sin coincidencias' : 'No hay clientes (tipo Cliente-Paga) cargados'}
                    </div>
                  ) : (
                    <>
                      <div style={{ padding: '6px 12px', fontSize: '0.7rem', color: '#8b949e', borderBottom: '1px solid #21262d', backgroundColor: '#161b22' }}>
                        {clientesFiltradosBuscador.length} {clientesFiltradosBuscador.length === 1 ? 'cliente' : 'clientes'}{textoBuscarCliente.trim() ? '' : ' (primeros 30)'}
                      </div>
                      {clientesFiltradosBuscador.map((cli: any) => (
                        <div
                          key={cli.id}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setFiltroCliente(cli.id);
                            setTextoBuscarCliente('');
                            setMostrarSugerenciasCliente(false);
                            setSeleccionadas([]);
                          }}
                          style={{ padding: '10px 12px', cursor: 'pointer', color: '#c9d1d9', fontSize: '0.88rem', borderBottom: '1px solid #21262d', transition: 'background-color 0.15s' }}
                          onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = '#21262d'}
                          onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                          <div style={{ fontWeight: '500' }}>{cli.nombre || cli.id}</div>
                          {cli.rfc && <div style={{ color: '#8b949e', fontSize: '0.75rem', marginTop: '2px' }}>{cli.rfc}</div>}
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>

            <button 
              disabled={seleccionadas.length === 0} 
              onClick={() => setModalAbierto(true)}
              style={{ padding: '10px 20px', backgroundColor: seleccionadas.length > 0 ? '#D84315' : '#30363d', color: '#fff', border: 'none', borderRadius: '6px', cursor: seleccionadas.length > 0 ? 'pointer' : 'not-allowed', fontWeight: 'bold', whiteSpace: 'nowrap' }}
            >
              Generar Factura ({seleccionadas.length})
            </button>
          </div>

          {seleccionadas.length > 0 && (
            <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '20px', marginBottom: '20px', animation: 'fadeIn 0.3s ease' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '16px' }}>
                <div style={{ borderRight: '1px solid #30363d' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Operaciones Seleccionadas</span>
                  <span style={{ color: '#58a6ff', fontSize: '1.8rem', fontWeight: 'bold' }}>{seleccionadas.length}</span>
                </div>
                <div style={{ borderRight: '1px solid #30363d' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Subtotal Estimado</span>
                  <span style={{ color: '#3fb950', fontSize: '1.8rem', fontWeight: 'bold' }}>{formatoMoneda(resumenSeleccion.subtotal)}</span>
                </div>
                <div>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Moneda del Cliente</span>
                  <span style={{ color: '#D84315', fontSize: '1.8rem', fontWeight: 'bold' }}>{monedaFacturacion}</span>
                </div>
              </div>
            </div>
          )}

          <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 350px)', backgroundColor: '#161b22' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead style={{ backgroundColor: '#1f2937', color: '#8b949e', fontSize: '0.8rem', position: 'sticky', top: 0, zIndex: 10 }}>
                <tr>
                  <th style={{ padding: '16px', width: '50px', textAlign: 'center', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}></th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>REF. OPERACIÓN</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>FECHA SERVICIO</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>CLIENTE</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>CARTA PORTE</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>DESTINO</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>SUBTOTAL OP</th>
                </tr>
              </thead>
              <tbody>
                {!filtroCliente ? (
                  <tr><td colSpan={7} style={{ padding: '40px', textAlign: 'center', color: '#8b949e' }}>Selecciona un Cliente en el filtro superior para ver las operaciones listas para facturar.</td></tr>
                ) : cargandoOperaciones ? (
                  <tr><td colSpan={7} style={{ padding: '40px', textAlign: 'center', color: '#8b949e' }}>Cargando últimas 100 operaciones completadas del cliente...</td></tr>
                ) : operacionesPendientes.length === 0 ? (
                  <tr><td colSpan={7} style={{ padding: '40px', textAlign: 'center', color: '#8b949e' }}>No hay operaciones pendientes de facturar para este cliente (las últimas 100 completadas ya están todas facturadas).</td></tr>
                ) : (
                  operacionesPendientes.map(op => (
                    <tr key={op.id} onClick={() => toggleSeleccion(op.id)} style={{ cursor: 'pointer', borderBottom: '1px solid #21262d', backgroundColor: seleccionadas.includes(op.id) ? 'rgba(216,67,21,0.1)' : 'transparent' }}>
                      <td style={{ padding: '16px', textAlign: 'center', whiteSpace: 'nowrap' }}><input type="checkbox" checked={seleccionadas.includes(op.id)} readOnly style={{ cursor: 'pointer', width: '16px', height: '16px' }} /></td>
                      <td style={{ padding: '16px', color: '#58a6ff', fontWeight: 'bold', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{op.numReferencia || op.referencia || op.ref || op.id.substring(0,6)}</td>
                      <td style={{ padding: '16px', color: '#c9d1d9', whiteSpace: 'nowrap' }}>{formatearFechaSpanish(op.fechaServicio || op.createdAt)}</td>
                      <td style={{ padding: '16px', color: '#c9d1d9', whiteSpace: 'nowrap' }}>{getNombreCliente(op.clientePaga || op.clientePagaId || op.clienteId)}</td>
                      <td style={{ padding: '16px', color: '#c9d1d9', whiteSpace: 'nowrap' }}>{op.cartaPorte || op.numeroCartaPorte || '-'}</td>
                      <td style={{ padding: '16px', color: '#c9d1d9', whiteSpace: 'nowrap' }}>{op.destino || '-'}</td>
                      <td style={{ padding: '16px', color: '#3fb950', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{formatoMoneda(op.totalFacturar || op.total || op.subtotalCliente)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      ) : (
        <div className="animation-fade-in">
          {/* ✅ MODIFICADO: buscador de cliente en vez de búsqueda libre.
              Las facturas se descargan ON DEMAND al elegir cliente (últimas 100). */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', marginBottom: '20px', alignItems: 'flex-end', backgroundColor: '#0d1117', padding: '20px', borderRadius: '8px', border: '1px solid #30363d' }}>
            <div style={{ flex: 1, minWidth: '320px', position: 'relative' }}>
              <label style={{ color: '#10b981', fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>CLIENTE ★</label>

              {filtroCliente ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px', backgroundColor: '#161b22', border: '1px solid #10b981', borderRadius: '6px', minHeight: '20px' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                  <span style={{ color: '#10b981', fontWeight: 'bold', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nombreClienteSeleccionado}</span>
                  <button
                    onClick={() => { setFiltroCliente(''); setTextoBuscarCliente(''); setMostrarSugerenciasCliente(false); }}
                    title="Cambiar cliente"
                    style={{ background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', padding: '0 4px', fontSize: '1rem', lineHeight: 1 }}
                  >✕</button>
                </div>
              ) : (
                <div style={{ position: 'relative' }}>
                  <svg style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#10b981' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                  <input
                    type="text"
                    placeholder="Buscar cliente por nombre o RFC..."
                    value={textoBuscarCliente}
                    onChange={(e) => { setTextoBuscarCliente(e.target.value); setMostrarSugerenciasCliente(true); }}
                    onFocus={() => setMostrarSugerenciasCliente(true)}
                    onBlur={() => setTimeout(() => setMostrarSugerenciasCliente(false), 180)}
                    style={{ width: '100%', padding: '10px 10px 10px 32px', backgroundColor: '#161b22', border: '1px solid #10b981', borderRadius: '6px', color: '#c9d1d9', fontSize: '0.9rem', boxSizing: 'border-box' }}
                  />
                </div>
              )}

              {!filtroCliente && mostrarSugerenciasCliente && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0,
                  backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px',
                  maxHeight: '320px', overflowY: 'auto', zIndex: 100, marginTop: '4px',
                  boxShadow: '0 6px 16px rgba(0,0,0,0.5)'
                }}>
                  {clientesFiltradosBuscador.length === 0 ? (
                    <div style={{ padding: '14px', color: '#8b949e', fontSize: '0.85rem', textAlign: 'center' }}>
                      {textoBuscarCliente.trim() ? 'Sin coincidencias' : 'No hay clientes (tipo Cliente-Paga) cargados'}
                    </div>
                  ) : (
                    <>
                      <div style={{ padding: '6px 12px', fontSize: '0.7rem', color: '#8b949e', borderBottom: '1px solid #21262d', backgroundColor: '#161b22' }}>
                        {clientesFiltradosBuscador.length} {clientesFiltradosBuscador.length === 1 ? 'cliente' : 'clientes'}{textoBuscarCliente.trim() ? '' : ' (primeros 30)'}
                      </div>
                      {clientesFiltradosBuscador.map((cli: any) => (
                        <div
                          key={cli.id}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setFiltroCliente(cli.id);
                            setTextoBuscarCliente('');
                            setMostrarSugerenciasCliente(false);
                          }}
                          style={{ padding: '10px 12px', cursor: 'pointer', color: '#c9d1d9', fontSize: '0.88rem', borderBottom: '1px solid #21262d', transition: 'background-color 0.15s' }}
                          onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = '#21262d'}
                          onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                          <div style={{ fontWeight: '500' }}>{cli.nombre || cli.id}</div>
                          {cli.rfc && <div style={{ color: '#8b949e', fontSize: '0.75rem', marginTop: '2px' }}>{cli.rfc}</div>}
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>

            <button title="Exportar a Excel" onClick={exportarCSV} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent', border: '1px solid #8b949e', color: '#c9d1d9', padding: '10px 14px', borderRadius: '6px', cursor: 'pointer', height: 'fit-content' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </button>
          </div>

          <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 280px)', backgroundColor: '#161b22' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead style={{ backgroundColor: '#1f2937', color: '#8b949e', fontSize: '0.8rem', position: 'sticky', top: 0, zIndex: 10 }}>
                <tr>
                  <th style={{ padding: '16px', textAlign: 'center', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>ACCIONES</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>INVOICE</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>FECHA</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>CLIENTE</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>MONEDA</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>FACTURA CCP</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>CANT. OPS</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>TOTAL</th>
                </tr>
              </thead>
              <tbody>
                {!filtroCliente ? (
                  <tr><td colSpan={8} style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>Selecciona un cliente para ver su historial de facturas.</td></tr>
                ) : cargandoFacturas ? (
                  <tr><td colSpan={8} style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>Cargando últimas 100 facturas del cliente...</td></tr>
                ) : registrosVisibles.length === 0 ? (
                  <tr><td colSpan={8} style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>Este cliente no tiene facturas registradas.</td></tr>
                ) : (
                  registrosVisibles.map(f => (
                    <tr key={f.id} style={{ borderBottom: '1px solid #21262d' }}>
                      <td style={{ padding: '16px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                          <button 
                            title="Ver Ficha" 
                            onClick={() => setFacturaViendo(f)} 
                            style={{ background: 'transparent', border: '1px solid #3b82f6', borderRadius: '4px', color: '#3b82f6', cursor: 'pointer', padding: '6px', display: 'flex' }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                          </button>
                          
                          <button 
                            title="Eliminar Factura" 
                            onClick={(e) => handleEliminarFactura(e, f)} 
                            style={{ background: 'transparent', border: '1px solid #ef4444', borderRadius: '4px', color: '#ef4444', cursor: 'pointer', padding: '6px', display: 'flex' }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                          </button>
                        </div>
                      </td>
                      <td style={{ padding: '16px', color: '#D84315', fontWeight: 'bold', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{f.invoice}</td>
                      <td style={{ padding: '16px', color: '#c9d1d9', whiteSpace: 'nowrap' }}>{formatearFechaSpanish(f.fecha)}</td>
                      <td style={{ padding: '16px', color: '#f0f6fc', whiteSpace: 'nowrap' }}>{f.clienteNombre || '-'}</td>
                      <td style={{ padding: '16px', color: '#10b981', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{f.monedaFacturacion || 'N/A'}</td>
                      <td style={{ padding: '16px', color: '#c9d1d9', whiteSpace: 'nowrap' }}>{f.facturaCcp || '-'}</td>
                      <td style={{ padding: '16px', color: '#8b949e', whiteSpace: 'nowrap' }}>{f.operacionesIds?.length || 0}</td>
                      <td style={{ padding: '16px', color: '#58a6ff', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{formatoMoneda(f.subtotalFactura)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {totalPaginas > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', marginTop: '20px' }}>
              <button onClick={irPaginaAnterior} disabled={paginaActual === 1} style={{ padding: '8px 16px', cursor: paginaActual === 1 ? 'not-allowed' : 'pointer', background: 'none', border: 'none', color: '#c9d1d9' }}>Anterior</button>
              <span style={{ color: '#fff', alignSelf: 'center' }}>{paginaActual} / {totalPaginas}</span>
              <button onClick={irPaginaSiguiente} disabled={paginaActual === totalPaginas} style={{ padding: '8px 16px', cursor: (paginaActual === totalPaginas) ? 'not-allowed' : 'pointer', background: 'none', border: 'none', color: '#c9d1d9' }}>Siguiente</button>
            </div>
          )}
        </div>
      )}

      {/* MODAL FORMULARIO GENERAR FACTURA */}
      {modalAbierto && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px', backdropFilter: 'blur(8px)' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', width: '100%', maxWidth: '700px', maxHeight: '90vh', overflowY: 'auto', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px', borderBottom: '1px solid #30363d', paddingBottom: '16px' }}>
              <h2 style={{ color: '#f0f6fc', margin: 0 }}>Generar Factura</h2>
              <button onClick={() => setModalAbierto(false)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#010409', padding: '16px', borderRadius: '8px', border: '1px dashed #30363d', marginBottom: '24px' }}>
              <div>
                <span style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Cliente</span>
                <span style={{ color: '#f0f6fc', fontSize: '1.1rem', fontWeight: 'bold' }}>{getNombreCliente(filtroCliente)}</span>
              </div>
              <div style={{ textAlign: 'center', borderLeft: '1px solid #30363d', borderRight: '1px solid #30363d', padding: '0 20px' }}>
                <span style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Moneda Cliente</span>
                <span style={{ color: '#10b981', fontSize: '1.1rem', fontWeight: 'bold' }}>{monedaFacturacion}</span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Subtotal ({seleccionadas.length} Ops)</span>
                <span style={{ color: '#58a6ff', fontSize: '1.4rem', fontWeight: 'bold' }}>{formatoMoneda(resumenSeleccion.subtotal)}</span>
              </div>
            </div>
            
            <form onSubmit={handleGuardarFactura}>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>NÚMERO DE INVOICE</label>
                  <input type="text" required placeholder="Ej. INV-2026-001" value={invoiceForm} onChange={e => setInvoiceForm(e.target.value)} style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', color: '#D84315', border: '1px solid #30363d', borderRadius: '4px', fontWeight: 'bold', fontSize: '1.1rem' }} />
                </div>
                <div>
                  <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>FECHA DE FACTURACIÓN</label>
                  <input type="date" required value={fechaForm} onChange={e => setFechaForm(e.target.value)} style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', color: '#fff', border: '1px solid #30363d', borderRadius: '4px' }} />
                </div>
                <div>
                  <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>FACTURA CCP (Opcional)</label>
                  <input type="text" placeholder="Referencia CCP..." value={facturaCcpForm} onChange={e => setFacturaCcpForm(e.target.value)} style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', color: '#fff', border: '1px solid #30363d', borderRadius: '4px' }} />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', borderTop: '1px solid #30363d', paddingTop: '20px' }}>
                <button type="button" onClick={() => setModalAbierto(false)} disabled={guardando} style={{ padding: '8px 24px', background: 'none', color: '#8b949e', border: '1px solid #30363d', borderRadius: '6px', cursor: 'pointer' }}>Cancelar</button>
                <button type="submit" disabled={guardando} style={{ padding: '8px 24px', backgroundColor: '#238636', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>{guardando ? 'Guardando...' : 'Confirmar Factura'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ✅ MODAL FICHA DE FACTURA (SOLO LECTURA) */}
      {facturaViendo && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 1500, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px', backdropFilter: 'blur(4px)' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', width: '800px', maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
            
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #30363d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.4rem' }}>Ficha de Factura</h2>
              <button onClick={() => setFacturaViendo(null)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>
            
            <div style={{ padding: '24px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px', marginBottom: '24px' }}>
                
                <div style={{ gridColumn: 'span 3', display: 'flex', justifyContent: 'space-between', backgroundColor: '#161b22', padding: '16px', borderRadius: '8px', border: '1px solid #30363d', alignItems: 'center' }}>
                  <div>
                    <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Invoice</span>
                    <span style={{ color: '#D84315', fontSize: '1.4rem', fontWeight: 'bold', fontFamily: 'monospace' }}>{facturaViendo.invoice}</span>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Moneda</span>
                    <span style={{ color: '#10b981', fontSize: '1.1rem', fontWeight: 'bold' }}>{facturaViendo.monedaFacturacion || 'N/A'}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Fecha de Facturación</span>
                    <span style={{ color: '#c9d1d9', fontSize: '1.1rem', fontWeight: 'bold' }}>{formatearFechaSpanish(facturaViendo.fecha)}</span>
                  </div>
                </div>

                <div>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Cliente Facturado</span>
                  <span style={{ color: '#f0f6fc', fontSize: '1.1rem', fontWeight: 'bold' }}>{facturaViendo.clienteNombre || '-'}</span>
                </div>
                <div>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Factura CCP</span>
                  <span style={{ color: '#c9d1d9', fontSize: '1rem' }}>{facturaViendo.facturaCcp || '-'}</span>
                </div>
                <div>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Total Facturado</span>
                  <span style={{ color: '#3fb950', fontSize: '1.2rem', fontWeight: 'bold' }}>{formatoMoneda(facturaViendo.subtotalFactura)}</span>
                </div>

                <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '0' }} /></div>

                {/* ✅ LECTURA ESTÁTICA DE LAS REFERENCIAS FACTURADAS */}
                <div style={{ gridColumn: 'span 3', marginTop: '8px' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '12px' }}>
                    Referencias / Operaciones Facturadas ({facturaViendo.operacionesGuardadas?.length || 0})
                  </span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                    {facturaViendo.operacionesGuardadas?.map((op: any) => (
                      <div 
                        key={op.id} 
                        style={{ 
                          backgroundColor: '#21262d', border: '1px solid #58a6ff', 
                          padding: '8px 14px', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '4px'
                        }}
                      >
                        <span style={{ color: '#58a6ff', fontSize: '0.9rem', fontFamily: 'monospace', fontWeight: 'bold' }}>{op.ref}</span>
                        <span style={{ color: '#3fb950', fontSize: '0.85rem' }}>{formatoMoneda(op.monto)}</span>
                      </div>
                    )) || <span style={{ color: '#8b949e' }}>Sin detalle de operaciones.</span>}
                  </div>
                </div>

              </div>
            </div>
            
            <div style={{ padding: '16px 24px', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #30363d', backgroundColor: '#161b22' }}>
              <button onClick={() => setFacturaViendo(null)} className="btn btn-outline" style={{ padding: '8px 24px', borderRadius: '6px', color: '#c9d1d9', border: '1px solid #30363d', background: 'transparent', cursor: 'pointer' }}>Cerrar Ficha</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};