// src/features/gastos/components/mtto/MttoDashboard.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { FormularioMtto } from './FormularioMtto';
import { collection, query, getDocs, limit, doc, deleteDoc, writeBatch } from 'firebase/firestore'; 
import { db } from '../../../../config/firebase'; 
import MttoAgrupadosInvoice from './MttoAgrupadosInvoice';
import * as XLSX from 'xlsx';

type VistaMaestra = 'tabla' | 'agrupado';

// ✅ TODAS LAS COLUMNAS DE LA COLECCIÓN MTTO CON NOMBRES LEGIBLES
const COLUMNAS_BASE = [
  { id: 'numeroGasto', label: '# Gasto', visible: true },
  { id: 'invoice', label: 'Invoice', visible: true },
  { id: 'estatus', label: 'Estatus', visible: true },
  { id: 'fecha', label: 'Fecha', visible: true },
  { id: 'unidad', label: 'Unidad', visible: true },
  { id: 'operador', label: 'Operador', visible: true },
  { id: 'descripcion', label: 'Descripción', visible: true },
  { id: 'proveedor', label: 'Proveedor', visible: true },
  { id: 'tipoServicio', label: 'Tipo de Servicio', visible: true },
  { id: 'autorizadoPor', label: 'Autorizado por', visible: true },
  { id: 'condicionPago', label: 'Crédito/Contado', visible: true },
  { id: 'plazo', label: 'Plazo (Dias)', visible: false },
  { id: 'moneda', label: 'Moneda', visible: true },
  { id: 'importe', label: 'Importe', visible: true },
  { id: 'iva', label: 'IVA', visible: true },
  { id: 'retIva', label: 'Ret IVA', visible: true },
  { id: 'retIsr', label: 'Ret ISR', visible: true },
  { id: 'total', label: 'Total', visible: true },
  { id: 'facturaTexto', label: 'Factura', visible: true },
  { id: 'fechaFactura', label: 'Fecha Factura', visible: true },
  { id: 'descripcionFactura', label: 'Descripción (Factura)', visible: true },
  { id: 'fechaPago', label: 'Fecha de Pago', visible: true },
  { id: 'formaPago', label: 'Forma de pago', visible: true },
  { id: 'observaciones', label: 'Observaciones', visible: true },
  { id: 'operacionAsignada', label: 'Asignar Operación', visible: true }
];

// ✅ Consecutivo (última parte numérica del folio)
const consecutivoDe = (m: any): number => {
  const parte = String(m?.numeroGasto || '').split('-').pop() || '';
  const n = parseInt(parte.replace(/\D/g, ''), 10);
  return isNaN(n) ? 0 : n;
};

// ✅ Partes de una fecha ISO "YYYY-MM-DD" sin corrimiento de zona horaria
const partesFechaISO = (v: any): { yyyy: string; mm: string; dd: string } | null => {
  const s = String(v || '').slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { yyyy: m[1], mm: m[2], dd: m[3] };
};

// ✅ Folio normalizado al formato MTTO-DDMMYY-NNN (p. ej. MTTO-290626-001).
//    La fecha sale del campo `fecha` (respaldo `createdAt`); el consecutivo, del folio.
const formatearFolio = (m: any): string => {
  const consStr = String(consecutivoDe(m)).padStart(3, '0');
  const p = partesFechaISO(m?.fecha) || partesFechaISO(m?.createdAt);
  if (p) {
    const ddmmyy = `${p.dd}${p.mm}${p.yyyy.slice(2)}`;
    return `MTTO-${ddmmyy}-${consStr}`;
  }
  // Sin fecha ISO confiable: conserva el bloque de fecha del folio original,
  // pero homologa el prefijo a MTTO y el consecutivo a 3 dígitos.
  const original = String(m?.numeroGasto || '').trim();
  if (!original) return '-';
  const partes = original.split('-');
  if (partes.length >= 3) return `MTTO-${partes[1]}-${consStr}`;
  return original;
};

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

  // Estados visuales y de acciones masivas
  const [gastosSeleccionados, setGastosSeleccionados] = useState<string[]>([]);
  const [modalInvoiceMasivo, setModalInvoiceMasivo] = useState(false);
  const [nuevoInvoiceTexto, setNuevoInvoiceTexto] = useState('');
  const [cargandoMasivo, setCargandoMasivo] = useState(false);

  // Estados para configuración de columnas
  const [modalColumnas, setModalColumnas] = useState(false);
  const [columnasTabla, setColumnasTabla] = useState(COLUMNAS_BASE.map(c => ({ ...c })));
  const [draggedColIndex, setDraggedColIndex] = useState<number | null>(null);

  const cargarDatos = async () => {
    setCargando(true);
    try {
      let catGuardados = null;
      const cacheCatStr = sessionStorage.getItem('roelca_catalogos_v1');

      if (cacheCatStr) {
        catGuardados = JSON.parse(cacheCatStr);
        setCatalogosCacheados(catGuardados);
      } else {
        const [empSnap, unidSnap, servSnap, monSnap, fpSnap, opSnap, empColSnap] = await Promise.all([
          getDocs(collection(db, 'empresas')),
          getDocs(collection(db, 'unidades')),
          getDocs(collection(db, 'catalogo_tipo_servicio')),
          getDocs(collection(db, 'catalogo_moneda')),
          getDocs(collection(db, 'catalogo_formas_pago')),
          getDocs(query(collection(db, 'operaciones'), limit(200))),
          getDocs(collection(db, 'empleados')) 
        ]);

        catGuardados = {
          empresas: empSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })),
          unidades: unidSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })),
          servicios: servSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })),
          monedas: monSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })),
          formasPago: fpSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })),
          operaciones: opSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })),
          empleados: empColSnap.docs.map((d: any) => ({ id: d.id, ...d.data() }))
        };
        
        sessionStorage.setItem('roelca_catalogos_v1', JSON.stringify(catGuardados));
        setCatalogosCacheados(catGuardados);
      }

      const q = query(collection(db, 'gastos_mtto'), limit(300));
      const snap = await getDocs(q);
      
      let mttoData = snap.docs.map((d: any) => {
        const data = d.data();
        const tieneInvoice = data.invoice && String(data.invoice).trim() !== '';
        data.estatus = tieneInvoice ? 'Facturado' : 'No facturado';
        
        return { id: d.id, ...data };
      });

      // ✅ ORDEN: 1) Fecha de la más reciente a la más antigua. 2) Por referencia (folio).
      const obtenerTiempo = (m: any) => {
        if (m.fecha) { const t = new Date(m.fecha).getTime(); if (!isNaN(t)) return t; }
        if (m.createdAt) { const t = new Date(m.createdAt).getTime(); if (!isNaN(t)) return t; }
        return 0;
      };
      mttoData.sort((a, b) => {
        // 1) Fecha del gasto (más reciente primero)
        const tA = obtenerTiempo(a);
        const tB = obtenerTiempo(b);
        if (tA !== tB) return tB - tA;
        // 2) Referencia / folio del mismo día: consecutivo más alto primero
        return consecutivoDe(b) - consecutivoDe(a);
      });

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
      
      const respaldoGlobales = [...mttoGlobales];
      setMttoGlobales(prev => prev.filter(m => m.id !== id));
      setGastosSeleccionados(prev => prev.filter(selId => String(selId) !== String(id)));
      if (mttoViendo?.id === id) setMttoViendo(null);
      
      try {
        const docRef = doc(db, 'gastos_mtto', id);
        await deleteDoc(docRef);
      } catch (error) {
        console.error("Error al eliminar en Firebase:", error);
        alert("Hubo un error al eliminar en el servidor. El registro regresará a la lista.");
        setMttoGlobales(respaldoGlobales);
      }
    }
  };

  const mostrarNombreUnidad = (unidadValor: string) => {
    if (!unidadValor) return '-';
    if (unidadValor === 'Oficina') return 'Oficina';
    if (catalogosCacheados.unidades) {
        const uni = catalogosCacheados.unidades.find((u:any) => u.id === unidadValor);
        if (uni) return uni.unidad || uni.numeroEconomico || uni.nombre;
    }
    return unidadValor;
  };

  const mostrarDatoMapeado = (id: any, catalogo: string, campoRetorno: string = 'nombre') => {
    if (!id) return '-';
    if (!catalogosCacheados[catalogo] || !Array.isArray(catalogosCacheados[catalogo])) return String(id);
    
    if (Array.isArray(id)) {
        return id.map(itemId => {
            const elemento = catalogosCacheados[catalogo].find((item: any) => item.id === itemId);
            return elemento ? (elemento[campoRetorno] || elemento.nombre || elemento.descripcion || itemId) : itemId;
        }).join(', ');
    }

    const elemento = catalogosCacheados[catalogo].find((item: any) => item.id === id);
    if (!elemento) return id;
    return elemento[campoRetorno] || elemento.nombre || elemento.descripcion || elemento.ref || id;
  };

  const formatoMoneda = (monto: any) => {
    if (monto === undefined || monto === null || monto === '') return '-';
    return `$ ${parseFloat(monto).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };
  
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
      idsValidos.forEach(id => {
        const docRef = doc(db, 'gastos_mtto', id);
        batch.update(docRef, { 
          invoice: nuevoInvoiceTexto.trim(),
          estatus: 'Facturado' 
        });
      });
      await batch.commit();
      await cargarDatos(); 
      alert(`Se aplicó el Invoice exitosamente.`);
      setModalInvoiceMasivo(false);
      setGastosSeleccionados([]); 
      setNuevoInvoiceTexto('');
    } catch (error) {
      alert("Hubo un error al aplicar el Invoice masivo.");
    } finally {
      setCargandoMasivo(false);
    }
  };

  const registrosFiltrados = useMemo(() => {
    const b = busqueda.toLowerCase();
    return mttoGlobales.filter(m => (
      String(m.numeroGasto || '').toLowerCase().includes(b) ||
      String(formatearFolio(m)).toLowerCase().includes(b) ||
      String(m.invoice || '').toLowerCase().includes(b) ||
      String(m.estatus || '').toLowerCase().includes(b) ||
      String(m.operadorNombre || m.operador || '').toLowerCase().includes(b) ||
      String(m.proveedorNombre || '').toLowerCase().includes(b)
    ));
  }, [busqueda, mttoGlobales]);

  // ✅ CÁLCULO DEL SUMARIO DE GASTOS EN TIEMPO REAL
  const resumenSeleccion = useMemo(() => {
    let totalImporte = 0;
    let totalIva = 0;
    let granTotal = 0;
    const numerosGasto: string[] = [];

    gastosSeleccionados.forEach(id => {
      const gasto = mttoGlobales.find(m => m.id === id);
      if (gasto) {
        totalImporte += parseFloat(gasto.importe || 0);
        totalIva += parseFloat(gasto.ivaMonto || 0);
        granTotal += parseFloat(gasto.total || 0);
        numerosGasto.push(formatearFolio(gasto));
      }
    });

    return { totalImporte, totalIva, granTotal, cantidad: gastosSeleccionados.length, numerosGasto };
  }, [gastosSeleccionados, mttoGlobales]);

  const totalPaginas = Math.ceil(registrosFiltrados.length / registrosPorPagina);
  const indiceUltimoRegistro = paginaActual * registrosPorPagina;
  const indicePrimerRegistro = indiceUltimoRegistro - registrosPorPagina;
  const registrosEnPantalla = registrosFiltrados.slice(indicePrimerRegistro, indiceUltimoRegistro);

  const irPaginaSiguiente = () => setPaginaActual(prev => Math.min(prev + 1, totalPaginas));
  const irPaginaAnterior = () => setPaginaActual(prev => Math.max(prev - 1, 1));

  // ✅ LÓGICA DE DRAG & DROP PARA COLUMNAS
  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.effectAllowed = 'move';
    setDraggedColIndex(index);
  };

  const handleDragEnter = (index: number) => {
    if (draggedColIndex === null || draggedColIndex === index) return;
    const nuevasColumnas = [...columnasTabla];
    const colMovida = nuevasColumnas.splice(draggedColIndex, 1)[0];
    nuevasColumnas.splice(index, 0, colMovida);
    setDraggedColIndex(index);
    setColumnasTabla(nuevasColumnas);
  };

  const toggleColumnaVisible = (index: number) => {
    const nuevas = [...columnasTabla];
    nuevas[index].visible = !nuevas[index].visible;
    setColumnasTabla(nuevas);
  };

  // ✅ RENDERIZADOR DINÁMICO DE CELDAS MTTO
  const renderCellContent = (m: any, colId: string) => {
    switch (colId) {
      case 'numeroGasto': return <span style={{ color: '#58a6ff', fontWeight: 'bold' }}>{formatearFolio(m)}</span>;
      case 'invoice': return <span style={{ color: '#c9d1d9' }}>{m.invoice || '-'}</span>;
      case 'estatus': return <span style={{ color: m.estatus === 'Facturado' ? '#3fb950' : '#f85149', fontWeight: 'bold' }}>{m.estatus || '-'}</span>;
      case 'fecha': return <span style={{ color: '#c9d1d9' }}>{m.fecha || '-'}</span>;
      case 'unidad': return <span style={{ color: '#c9d1d9' }}>{mostrarNombreUnidad(m.unidadId || m.unidad)}</span>;
      case 'operador': return <span style={{ color: '#c9d1d9' }}>{m.operadorNombre || m.operador || '-'}</span>;
      case 'descripcion': return <span style={{ color: '#c9d1d9', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block' }}>{m.descripcion || m.descripcionGeneral || '-'}</span>;
      case 'proveedor': return <span style={{ color: '#c9d1d9' }}>{m.proveedorNombre || mostrarDatoMapeado(m.proveedorId, 'empresas')}</span>;
      case 'tipoServicio': return <span style={{ color: '#c9d1d9' }}>{mostrarDatoMapeado(m.tipoServicioId, 'servicios')}</span>;
      case 'autorizadoPor': return <span style={{ color: '#c9d1d9' }}>{m.autorizadoPor || '-'}</span>;
      case 'condicionPago': return <span style={{ color: '#c9d1d9' }}>{m.condicionPago || '-'}</span>;
      case 'plazo': return <span style={{ color: '#c9d1d9' }}>{m.plazo || '-'}</span>;
      case 'moneda': return <span style={{ color: '#c9d1d9' }}>{mostrarDatoMapeado(m.monedaId, 'monedas', 'moneda')}</span>;
      case 'importe': return <span style={{ color: '#c9d1d9' }}>{formatoMoneda(m.importe)}</span>;
      case 'iva': return <span style={{ color: '#c9d1d9' }}>{formatoMoneda(m.ivaMonto)} <span style={{fontSize:'0.8rem'}}>({m.ivaPorcentaje || 0}%)</span></span>;
      case 'retIva': return <span style={{ color: '#f85149' }}>{formatoMoneda(m.retIva)}</span>;
      case 'retIsr': return <span style={{ color: '#f85149' }}>{formatoMoneda(m.retIsr)}</span>;
      case 'total': return <span style={{ color: '#3fb950', fontWeight: 'bold' }}>{formatoMoneda(m.total)}</span>;
      case 'facturaTexto': return <span style={{ color: '#c9d1d9' }}>{m.facturaTexto || '-'}</span>;
      case 'fechaFactura': return <span style={{ color: '#c9d1d9' }}>{m.fechaFactura || '-'}</span>;
      case 'descripcionFactura': return <span style={{ color: '#c9d1d9', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block' }}>{m.descripcionFactura || '-'}</span>;
      case 'fechaPago': return <span style={{ color: '#c9d1d9' }}>{m.fechaPago || '-'}</span>;
      case 'formaPago': return <span style={{ color: '#c9d1d9' }}>{mostrarDatoMapeado(m.formaPagoId, 'formasPago', 'forma_pago')}</span>;
      case 'observaciones': return <span style={{ color: '#c9d1d9', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block' }}>{m.observaciones || '-'}</span>;
      case 'operacionAsignada': return <span style={{ color: '#58a6ff' }}>{mostrarDatoMapeado(m.operacionAsignadaId, 'operaciones', 'ref')}</span>;
      default: return <span style={{ color: '#c9d1d9' }}>-</span>;
    }
  };

  // ✅ EXPORTACIÓN EN EXCEL (XLSX) RESPALDADA EN COLUMNAS VISIBLES
  const exportarExcel = () => {
    if (registrosFiltrados.length === 0) return alert("No hay datos para exportar.");
    
    const columnasVisibles = columnasTabla.filter(c => c.visible);

    const datosExcel = registrosFiltrados.map(m => {
      const fila: any = {};
      columnasVisibles.forEach(col => {
        let val: any = '-';
        switch (col.id) {
          case 'numeroGasto': val = formatearFolio(m); break;
          case 'invoice': val = m.invoice || ''; break;
          case 'estatus': val = m.estatus || ''; break;
          case 'fecha': val = m.fecha || ''; break;
          case 'unidad': val = mostrarNombreUnidad(m.unidadId || m.unidad); break;
          case 'operador': val = m.operadorNombre || m.operador || ''; break;
          case 'descripcion': val = m.descripcion || m.descripcionGeneral || ''; break;
          case 'proveedor': val = m.proveedorNombre || mostrarDatoMapeado(m.proveedorId, 'empresas'); break;
          case 'tipoServicio': val = mostrarDatoMapeado(m.tipoServicioId, 'servicios'); break;
          case 'autorizadoPor': val = m.autorizadoPor || ''; break;
          case 'condicionPago': val = m.condicionPago || ''; break;
          case 'plazo': val = m.plazo || ''; break;
          case 'moneda': val = mostrarDatoMapeado(m.monedaId, 'monedas', 'moneda'); break;
          case 'importe': val = Number(m.importe || 0); break;
          case 'iva': val = `${Number(m.ivaMonto || 0).toFixed(2)} (${m.ivaPorcentaje || 0}%)`; break;
          case 'retIva': val = Number(m.retIva || 0); break;
          case 'retIsr': val = Number(m.retIsr || 0); break;
          case 'total': val = Number(m.total || 0); break;
          case 'facturaTexto': val = m.facturaTexto || ''; break;
          case 'fechaFactura': val = m.fechaFactura || ''; break;
          case 'descripcionFactura': val = m.descripcionFactura || ''; break;
          case 'fechaPago': val = m.fechaPago || ''; break;
          case 'formaPago': val = mostrarDatoMapeado(m.formaPagoId, 'formasPago', 'forma_pago'); break;
          case 'observaciones': val = m.observaciones || ''; break;
          case 'operacionAsignada': val = mostrarDatoMapeado(m.operacionAsignadaId, 'operaciones', 'ref'); break;
        }
        fila[col.label] = val;
      });
      return fila;
    });

    const worksheet = XLSX.utils.json_to_sheet(datosExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Gastos MTTO');
    XLSX.writeFile(workbook, `Gastos_MTTO_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const tabsDetalle = [
    { id: 'general', label: 'Información General' },
    { id: 'finanzas', label: 'Detalles Financieros' },
    { id: 'documentos', label: 'Documentos y Cierre' }
  ];

  // Estilos reutilizables para el panel de detalles
  const labelStyle = { color:'#8b949e', display:'block', fontSize:'0.8rem', marginBottom: '4px', textTransform: 'uppercase' as const, fontWeight: 'bold' };
  const valStyle = { color: '#c9d1d9', fontSize: '0.95rem', fontWeight: '500' };
  const boxStyle = { backgroundColor:'#161b22', padding:'12px', borderRadius:'6px', color: '#c9d1d9', border: '1px solid #30363d', marginTop: '4px', minHeight: '60px' };

  return (
    <div className="module-container" style={{ padding: '24px', animation: 'fadeIn 0.3s ease', width: '100%', boxSizing: 'border-box' }}>
      
      <style>{`
        .detail-grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
        @media (max-width: 768px) { .detail-grid-3 { grid-template-columns: 1fr; } }
        .row-hover { background-color: #0d1117; transition: background-color 0.2s; cursor: pointer; border-bottom: 1px solid #21262d; }
        .row-hover:hover { background-color: #21262d; }
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

      <div style={{ marginBottom: '24px' }}>
        <h1 className="module-title" style={{ fontSize: '1.8rem', color: '#f0f6fc', margin: '0 0 16px 0', fontWeight: 'bold' }}>Gastos Mantenimiento (MTTO)</h1>
        <div style={{ display: 'flex', borderBottom: '1px solid #30363d', gap: '16px' }}>
          <button onClick={() => setVistaActiva('tabla')} style={{ padding: '8px 16px', background: 'none', border: 'none', borderBottom: vistaActiva === 'tabla' ? '2px solid #D84315' : '2px solid transparent', color: vistaActiva === 'tabla' ? '#f0f6fc' : '#8b949e', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: vistaActiva === 'tabla' ? 'bold' : 'normal' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
            Todos los Gastos (MTTO)
          </button>
          <button onClick={() => setVistaActiva('agrupado')} style={{ padding: '8px 16px', background: 'none', border: 'none', borderBottom: vistaActiva === 'agrupado' ? '2px solid #D84315' : '2px solid transparent', color: vistaActiva === 'agrupado' ? '#f0f6fc' : '#8b949e', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: vistaActiva === 'agrupado' ? 'bold' : 'normal' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
            Agrupados por Invoice
          </button>
        </div>
      </div>

      {vistaActiva === 'agrupado' ? <MttoAgrupadosInvoice /> : (
        <div style={{ width: '100%', margin: '0 auto' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '16px', marginBottom: '20px', width: '100%' }}>
            
            <div style={{ display: 'flex', gap: '12px', flex: '1 1 auto', maxWidth: '600px' }}>
              <div style={{ width: '150px' }}>
                <select className="form-control" style={{ width: '100%', backgroundColor: '#0d1117', border: '1px solid #30363d', color: '#c9d1d9', padding: '8px 12px', borderRadius: '6px' }}><option>Filtro: Todo</option></select>
              </div>
              <div style={{ position: 'relative', width: '100%' }}>
                <svg style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#8b949e' }} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <input type="text" placeholder="Buscar por # Gasto, Invoice, Operador..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} style={{ width: '100%', padding: '8px 12px 8px 40px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', boxSizing: 'border-box' }} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              {gastosSeleccionados.length > 0 && (
                <button 
                  title="Asignar Invoice Masivo"
                  onClick={() => setModalInvoiceMasivo(true)} 
                  style={{ backgroundColor: '#238636', color: '#ffffff', border: 'none', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                  <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path fillRule="evenodd" d="M1.5 1.5A.5.5 0 0 0 1 2v4.8a2.5 2.5 0 0 0 2.5 2.5h9.793l-3.347 3.346a.5.5 0 0 0 .708.708l4.2-4.2a.5.5 0 1 0-.708.708L13.293 8.3H3.5A1.5 1.5 0 0 1 2 6.8V2a.5.5 0 0 0-.5-.5z"/></svg>
                  ({gastosSeleccionados.length})
                </button>
              )}
              
              <button className="btn btn-outline" onClick={() => setModalColumnas(true)} style={{ backgroundColor: 'transparent', border: '1px solid #8b949e', color: '#c9d1d9', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }} title="Configurar Columnas">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
              </button>

              <button 
                title="Exportar a Excel"
                onClick={exportarExcel} 
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent', border: '1px solid #8b949e', padding: '8px 12px', borderRadius: '6px', color: '#c9d1d9', cursor: 'pointer' }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              </button>
              <button 
                title="Agregar Gasto MTTO"
                onClick={handleNuevo} 
                style={{ backgroundColor: '#D84315', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              </button>
            </div>
          </div>

          {/* ✅ PANEL DE SUMARIO DE GASTOS */}
          {gastosSeleccionados.length > 0 && (
            <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '20px', marginBottom: '20px', animation: 'fadeIn 0.3s ease' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '16px' }}>
                <div style={{ borderRight: '1px solid #30363d' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Seleccionados</span>
                  <span style={{ color: '#58a6ff', fontSize: '1.8rem', fontWeight: 'bold' }}>{resumenSeleccion.cantidad}</span>
                </div>
                <div style={{ borderRight: '1px solid #30363d' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Suma Importe (Base)</span>
                  <span style={{ color: '#3fb950', fontSize: '1.5rem', fontWeight: 'bold' }}>{formatoMoneda(resumenSeleccion.totalImporte)}</span>
                </div>
                <div style={{ borderRight: '1px solid #30363d' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Suma IVA</span>
                  <span style={{ color: '#3fb950', fontSize: '1.5rem', fontWeight: 'bold' }}>{formatoMoneda(resumenSeleccion.totalIva)}</span>
                </div>
                <div>
                  <span style={{ display: 'block', color: '#D84315', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Gran Total</span>
                  <span style={{ color: '#f0f6fc', fontSize: '1.8rem', fontWeight: 'bold' }}>{formatoMoneda(resumenSeleccion.granTotal)}</span>
                </div>
              </div>
              <div style={{ borderTop: '1px dashed #30363d', paddingTop: '16px' }}>
                <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '8px' }}>Gastos incluidos:</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {resumenSeleccion.numerosGasto.map((ref, i) => (
                    <span key={i} style={{ backgroundColor: '#161b22', border: '1px solid #30363d', color: '#c9d1d9', padding: '4px 10px', borderRadius: '12px', fontSize: '0.85rem', fontFamily: 'monospace' }}>{ref}</span>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 280px)', width: '100%' }}>
            {cargando ? <div style={{ padding: '40px', textAlign: 'center', color: '#8b949e' }}>Cargando datos...</div> : (
              <table className="data-table" style={{ width: '100%', minWidth: '1500px', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead style={{ backgroundColor: '#161b22', position: 'sticky', top: 0, zIndex: 10 }}>
                  <tr>
                    <th style={{ padding: '16px 8px', width: '40px', position: 'sticky', left: 0, backgroundColor: '#161b22', zIndex: 12, borderRight: '1px solid #30363d', borderBottom: '1px solid #30363d' }}></th>
                    <th style={{ padding: '16px', width: '100px', textAlign: 'center', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', position: 'sticky', left: '56px', backgroundColor: '#161b22', zIndex: 12, borderRight: '1px solid #30363d', borderBottom: '1px solid #30363d' }}>Acciones</th>
                    {columnasTabla.filter(c => c.visible).map(col => (
                      <th key={`th_${col.id}`} style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {registrosEnPantalla.length === 0 ? (
                    <tr><td colSpan={columnasTabla.length + 2} style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>Sin resultados.</td></tr>
                  ) : (
                    registrosEnPantalla.map((m: any) => {
                      const isSelected = gastosSeleccionados.includes(m.id);
                      const yaFacturado = m.estatus === 'Facturado' || (m.invoice && m.invoice.trim() !== '');
                      return (
                      <tr 
                        key={m.id} 
                        className="row-hover"
                        style={{ backgroundColor: isSelected ? 'rgba(56, 139, 253, 0.1)' : '' }}
                        onClick={() => setMttoViendo(m)}
                      >
                        <td style={{ padding: '16px 8px', textAlign: 'center', position: 'sticky', left: 0, backgroundColor: isSelected ? '#1f2937' : 'inherit', zIndex: 5, borderRight: '1px solid #30363d' }} onClick={(e: any) => e.stopPropagation()}>
                          {!yaFacturado && <input type="checkbox" checked={isSelected} onChange={() => toggleSeleccion(m.id)} style={{ cursor: 'pointer', transform: 'scale(1.2)' }} />}
                        </td>
                        <td style={{ padding: '16px', position: 'sticky', left: '56px', backgroundColor: isSelected ? '#1f2937' : 'inherit', zIndex: 5, borderRight: '1px solid #30363d' }} onClick={(e: any) => e.stopPropagation()}>
                          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                            <button 
                              title="Editar Gasto"
                              onClick={() => editarMtto(m)} 
                              style={{ background: 'transparent', border: '1px solid #3b82f6', color: '#3b82f6', borderRadius: '4px', padding: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
                              onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'}
                              onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                            </button>
                            <button 
                              title="Eliminar Gasto"
                              onClick={() => eliminarMtto(m.id)} 
                              style={{ background: 'transparent', border: '1px solid #ef4444', color: '#ef4444', borderRadius: '4px', padding: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
                              onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'}
                              onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                            </button>
                          </div>
                        </td>
                        {columnasTabla.filter(c => c.visible).map(col => (
                          <td key={`cell_${m.id}_${col.id}`} style={{ padding: '16px', whiteSpace: 'nowrap' }}>
                            {renderCellContent(m, col.id)}
                          </td>
                        ))}
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
                <button 
                  title="Página Anterior"
                  onClick={irPaginaAnterior} 
                  disabled={paginaActual === 1} 
                  style={{ padding: '6px 12px', backgroundColor: paginaActual === 1 ? '#0d1117' : '#21262d', color: paginaActual === 1 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === 1 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                </button>
                <span style={{ padding: '6px 12px', color: '#f0f6fc', fontWeight: 'bold' }}>{paginaActual} / {totalPaginas || 1}</span>
                <button 
                  title="Página Siguiente"
                  onClick={irPaginaSiguiente} 
                  disabled={paginaActual === totalPaginas || totalPaginas === 0} 
                  style={{ padding: '6px 12px', backgroundColor: paginaActual === totalPaginas || totalPaginas === 0 ? '#0d1117' : '#21262d', color: paginaActual === totalPaginas || totalPaginas === 0 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === totalPaginas || totalPaginas === 0 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* MODAL INVOICE MASIVO */}
      {modalInvoiceMasivo && (
        <div className="modal-overlay" style={{ zIndex: 3000 }}>
          <div className="form-card" style={{ maxWidth: '450px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px' }}>
            <div className="form-header" style={{ padding: '16px 24px', borderBottom: '1px solid #30363d', display: 'flex', justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.25rem' }}>Asignar Invoice Masivo</h2>
              <button onClick={() => setModalInvoiceMasivo(false)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>
            <div style={{ padding: '24px' }}>
              <p style={{ color: '#8b949e', fontSize: '0.9rem', marginBottom: '20px' }}>Estás a punto de asignar el mismo número de Invoice a <strong>{gastosSeleccionados.length}</strong> registro(s).</p>
              <div className="form-group">
                <label style={{ display: 'block', marginBottom: '8px', color: '#c9d1d9', fontSize: '0.85rem', fontWeight: 'bold' }}>Número de Invoice a Asignar</label>
                <input type="text" placeholder="Ej: INV-99234" value={nuevoInvoiceTexto} onChange={e => setNuevoInvoiceTexto(e.target.value)} autoFocus style={{ width: '100%', padding: '12px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '6px', color: '#f0f6fc', fontSize: '1.1rem' }} />
              </div>
            </div>
            <div className="form-actions" style={{ padding: '16px 24px', display: 'flex', justifyContent: 'flex-end', gap: '12px', borderTop: '1px solid #30363d', backgroundColor: '#161b22', borderBottomLeftRadius: '8px', borderBottomRightRadius: '8px' }}>
              <button onClick={() => setModalInvoiceMasivo(false)} disabled={cargandoMasivo} className="btn btn-outline" style={{ padding: '8px 16px', borderRadius: '6px' }}>Cancelar</button>
              <button onClick={aplicarInvoiceMasivo} disabled={cargandoMasivo || !nuevoInvoiceTexto.trim()} className="btn btn-primary" style={{ padding: '8px 16px', borderRadius: '6px', backgroundColor: '#238636', border: 'none' }}>{cargandoMasivo ? 'Aplicando...' : 'Aplicar'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ✅ MODAL PARA CONFIGURAR COLUMNAS EN GRID DE 3 COLUMNAS */}
      {modalColumnas && (
        <div className="modal-overlay" style={{ zIndex: 2000, position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', backdropFilter: 'blur(4px)' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', width: '1000px', maxWidth: '95%', padding: '24px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px', borderBottom: '1px solid #30363d', paddingBottom: '12px' }}>
              <h3 style={{ margin: 0, color: '#f0f6fc' }}>Configurar Columnas</h3>
              <button onClick={() => setModalColumnas(false)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>
            <p style={{ color: '#8b949e', fontSize: '0.85rem', marginBottom: '24px' }}>Arrastra los campos para reordenarlos. Desmarca los que desees ocultar de la tabla principal y del reporte de Excel.</p>
            
            <ul style={{ 
              listStyle: 'none', padding: 0, margin: 0, maxHeight: '60vh', overflowY: 'auto', 
              display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' 
            }}>
              {columnasTabla.map((col, idx) => (
                <li 
                  key={col.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, idx)}
                  onDragEnter={() => handleDragEnter(idx)}
                  onDragEnd={() => setDraggedColIndex(null)}
                  onDragOver={(e) => e.preventDefault()}
                  style={{ 
                    display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', 
                    backgroundColor: draggedColIndex === idx ? '#1f2937' : '#161b22', 
                    border: '1px solid #30363d', borderRadius: '6px', cursor: 'grab',
                    transition: 'background-color 0.2s'
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                  <input type="checkbox" checked={col.visible} onChange={() => toggleColumnaVisible(idx)} style={{ cursor: 'pointer', transform: 'scale(1.2)' }} />
                  <span style={{ color: col.visible ? '#c9d1d9' : '#484f58', fontSize: '0.85rem', fontWeight: col.visible ? 'bold' : 'normal', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{col.label}</span>
                </li>
              ))}
            </ul>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '24px', borderTop: '1px solid #30363d', paddingTop: '16px' }}>
              <button onClick={() => setModalColumnas(false)} style={{ backgroundColor: '#D84315', color: '#fff', border: 'none', padding: '10px 32px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Aplicar Cambios</button>
            </div>
          </div>
        </div>
      )}

      {/* ✅ MODAL DE DETALLES RECONSTRUIDO */}
      {mttoViendo && (
        <div className="modal-overlay" style={{ zIndex: 1500 }}>
          <div className="form-card detail-card" style={{ maxWidth: '1000px', width: '100%', maxHeight: '90vh', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', display: 'flex', flexDirection: 'column' }}>
            <div className="form-header" style={{ padding: '20px 24px', display: 'flex', justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0, color: '#f0f6fc' }}>Detalle de Gasto <span style={{ color: '#58a6ff' }}>{formatearFolio(mttoViendo)}</span></h2>
              <button onClick={() => setMttoViendo(null)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>
            
            <div style={{ display: 'flex', borderBottom: '1px solid #30363d', padding: '0 24px' }}>
              {tabsDetalle.map(tab => (<button key={tab.id} onClick={() => setPestañaDetalleActiva(tab.id)} style={{ padding: '12px 16px', background: 'none', border: 'none', borderBottom: pestañaDetalleActiva === tab.id ? '2px solid #D84315' : '2px solid transparent', color: pestañaDetalleActiva === tab.id ? '#f0f6fc' : '#8b949e', cursor: 'pointer' }}>{tab.label}</button>))}
            </div>
            
            <div className="detail-content" style={{ padding: '24px', overflowY: 'auto' }}>
              
              {/* PESTAÑA 1: INFORMACIÓN GENERAL */}
              {pestañaDetalleActiva === 'general' && (
                <div className="detail-grid-3">
                   <div><label style={labelStyle}># DE GASTO</label><span style={valStyle}>{formatearFolio(mttoViendo)}</span></div>
                   <div><label style={labelStyle}># DE INVOICE</label><span style={valStyle}>{mttoViendo.invoice || '-'}</span></div>
                   <div><label style={labelStyle}>ESTATUS</label><span style={{color: mttoViendo.estatus === 'Facturado' ? '#3fb950' : '#f85149', fontWeight: 'bold'}}>{mttoViendo.estatus || '-'}</span></div>
                   <div><label style={labelStyle}>FECHA</label><span style={valStyle}>{mttoViendo.fecha || '-'}</span></div>
                   <div><label style={labelStyle}>TIPO DE GASTO</label><span style={valStyle}>{mttoViendo.tipoGasto || '-'}</span></div>
                   <div><label style={labelStyle}>UNIDAD</label><span style={valStyle}>{mostrarNombreUnidad(mttoViendo.unidadId || mttoViendo.unidad)}</span></div>
                   <div><label style={labelStyle}>OPERADOR</label><span style={valStyle}>{mttoViendo.operadorNombre || mttoViendo.operador || '-'}</span></div>
                   <div style={{gridColumn:'span 3'}}><label style={labelStyle}>DESCRIPCIÓN GENERAL</label><div style={boxStyle}>{mttoViendo.descripcion || mttoViendo.descripcionGeneral || '-'}</div></div>
                </div>
              )}

              {/* PESTAÑA 2: FINANZAS */}
              {pestañaDetalleActiva === 'finanzas' && (
                <div className="detail-grid-3">
                   <div style={{gridColumn: 'span 3'}}><label style={labelStyle}>PROVEEDOR</label><span style={valStyle}>{mttoViendo.proveedorNombre || mostrarDatoMapeado(mttoViendo.proveedorId, 'empresas')}</span></div>
                   <div style={{gridColumn: 'span 3'}}><label style={labelStyle}>TIPO DE SERVICIO</label>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '4px' }}>
                          {Array.isArray(mttoViendo.tipoServicioId) && mttoViendo.tipoServicioId.length > 0 
                          ? mttoViendo.tipoServicioId.map((idS: string) => (
                              <span key={idS} style={{ backgroundColor: '#21262d', padding: '4px 8px', borderRadius: '16px', fontSize: '0.85rem', border: '1px solid #30363d', color: '#c9d1d9' }}>
                                  {mostrarDatoMapeado(idS, 'servicios')}
                              </span>
                              ))
                          : <span style={valStyle}>{mostrarDatoMapeado(mttoViendo.tipoServicioId, 'servicios')}</span>
                          }
                      </div>
                   </div>
                   <div><label style={labelStyle}>CONDICIÓN DE PAGO</label><span style={valStyle}>{mttoViendo.condicionPago || '-'}</span></div>
                   {mttoViendo.condicionPago === 'Crédito' && (
                     <div><label style={labelStyle}>PLAZO (DÍAS)</label><span style={valStyle}>{mttoViendo.plazo || '-'}</span></div>
                   )}
                   <div><label style={labelStyle}>MONEDA</label><span style={valStyle}>{mostrarDatoMapeado(mttoViendo.monedaId, 'monedas', 'moneda')}</span></div>

                   <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '8px 0' }} /></div>

                   <div><label style={labelStyle}>IMPORTE (MONTO BASE)</label><span style={{color: '#58a6ff', fontWeight: 'bold', fontSize: '1.1rem'}}>{formatoMoneda(mttoViendo.importe)}</span></div>
                   <div><label style={labelStyle}>IVA (+)</label><span style={valStyle}>{formatoMoneda(mttoViendo.ivaMonto)} <span style={{fontSize:'0.8rem'}}>({mttoViendo.ivaPorcentaje || 0}%)</span></span></div>
                   <div></div>
                   
                   <div><label style={labelStyle}>RET IVA (-)</label><span style={{color: '#f85149'}}>{formatoMoneda(mttoViendo.retIva)}</span></div>
                   <div><label style={labelStyle}>RET ISR (-)</label><span style={{color: '#f85149'}}>{formatoMoneda(mttoViendo.retIsr)}</span></div>

                   <div style={{gridColumn:'span 3'}}><label style={{...labelStyle, color:'#3fb950'}}>TOTAL FINAL</label><span style={{fontSize:'1.8rem', fontWeight:'bold', color:'#3fb950'}}>{formatoMoneda(mttoViendo.total)}</span></div>
                </div>
              )}

              {/* PESTAÑA 3: DOCUMENTOS Y CIERRE */}
              {pestañaDetalleActiva === 'documentos' && (
                <div className="detail-grid-3">
                   <div><label style={labelStyle}>FACTURA (TEXTO)</label><span style={valStyle}>{mttoViendo.facturaTexto || '-'}</span></div>
                   <div><label style={labelStyle}>FECHA FACTURA</label><span style={valStyle}>{mttoViendo.fechaFactura || '-'}</span></div>
                   <div><label style={labelStyle}>DESCRIPCIÓN FACTURA</label><span style={valStyle}>{mttoViendo.descripcionFactura || '-'}</span></div>
                   
                   <div><label style={labelStyle}>ARCHIVO (PDF)</label>
                      {mttoViendo.archivoPdfUrl ? (
                          <a href={mttoViendo.archivoPdfUrl} target="_blank" rel="noreferrer" style={{color: '#58a6ff', textDecoration: 'underline'}}>Ver Documento</a>
                      ) : <span style={valStyle}>Sin archivo</span>}
                   </div>

                   <div><label style={labelStyle}>FECHA DE PAGO</label><span style={valStyle}>{mttoViendo.fechaPago || '-'}</span></div>
                   <div><label style={labelStyle}>FORMA DE PAGO</label><span style={valStyle}>{mostrarDatoMapeado(mttoViendo.formaPagoId, 'formasPago', 'forma_pago')}</span></div>
                   
                   <div><label style={labelStyle}>AUTORIZADO POR</label><span style={valStyle}>{mttoViendo.autorizadoPor || '-'}</span></div>
                   <div><label style={labelStyle}>ASIGNAR A OPERACIÓN</label><span style={valStyle}>{mostrarDatoMapeado(mttoViendo.operacionAsignadaId, 'operaciones', 'ref')}</span></div>

                   <div style={{gridColumn:'span 3'}}><label style={labelStyle}>OBSERVACIONES</label><div style={boxStyle}>{mttoViendo.observaciones || '-'}</div></div>
                </div>
              )}
            </div>
            
            <div style={{ padding: '16px 24px', textAlign: 'right', borderTop: '1px solid #30363d' }}>
              <button onClick={() => setMttoViendo(null)} className="btn btn-outline">Cerrar Detalles</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MttoDashboard;