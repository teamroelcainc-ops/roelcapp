// src/features/nominas/components/ReferenciasNominaDashboard.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  onSnapshot, 
  query, 
  writeBatch, 
  doc, 
  limit,
  orderBy
} from 'firebase/firestore';
import { db } from '../../../config/firebase';
import * as XLSX from 'xlsx';

export const ReferenciasNominaDashboard = () => {
  const [activeTab, setActiveTab] = useState<'operaciones' | 'historial'>('historial');
  
  const [operacionesGlobales, setOperacionesGlobales] = useState<any[]>([]);
  const [nominasGlobales, setNominasGlobales] = useState<any[]>([]);
  
  // Catálogos
  const [operadoresList, setOperadoresList] = useState<any[]>([]);
  const [formasPagoList, setFormasPagoList] = useState<any[]>([]);
  const [bancosList, setBancosList] = useState<any[]>([]);

  // Filtros Pestaña 1
  const [filtroOperador, setFiltroOperador] = useState('');
  const [fechaInicio, setFechaInicio] = useState('');
  const [fechaFin, setFechaFin] = useState('');
  const [seleccionadas, setSeleccionadas] = useState<string[]>([]);

  // Paginación y Búsqueda
  const [busquedaHistorial, setBusquedaHistorial] = useState('');
  const [paginaActual, setPaginaActual] = useState(1);
  const registrosPorPagina = 50;

  // Estado del Modal de Nómina
  const [modalAbierto, setModalAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [nominaViendo, setNominaViendo] = useState<any | null>(null);

  // Campos del Formulario
  const [fechaPago, setFechaPago] = useState(new Date().toISOString().split('T')[0]);
  const [formaPagoSeleccionada, setFormaPagoSeleccionada] = useState('');
  const [bancoSeleccionado, setBancoSeleccionado] = useState('');
  const [statusPagado, setStatusPagado] = useState<'Pendiente' | 'Pagada'>('Pendiente');
  const [consecutivoForm, setConsecutivoForm] = useState('');
  const [notaDepositos, setNotaDepositos] = useState('');

  // Campos de Moneda
  const [nomina, setNomina] = useState<number | ''>('');
  const [diferenciaAplicable, setDiferenciaAplicable] = useState<number | ''>('');
  const [infonavit, setInfonavit] = useState<number | ''>('');
  const [imss, setImss] = useState<number | ''>('');
  const [isr, setIsr] = useState<number | ''>('');
  const [extras, setExtras] = useState<number | ''>('');
  const [depositoGastos, setDepositoGastos] = useState<number | ''>('');
  const [saldoPrestamo, setSaldoPrestamo] = useState<number | ''>('');
  const [ahorro, setAhorro] = useState<number | ''>('');
  const [ahorroAcumulado, setAhorroAcumulado] = useState<number | ''>('');
  const [prestamo, setPrestamo] = useState<number | ''>('');
  const [pagoPrestamo, setPagoPrestamo] = useState<number | ''>('');
  const [vacaciones, setVacaciones] = useState<number | ''>('');
  const [pagarAhorro, setPagarAhorro] = useState<number | ''>('');
  const [fonacot, setFonacot] = useState<number | ''>('');
  const [otrosDepositos, setOtrosDepositos] = useState<number | ''>('');
  const [otrasDeducciones, setOtrasDeducciones] = useState<number | ''>('');
  const [fonacotInicial, setFonacotInicial] = useState<number | ''>('');
  const [saldo, setSaldo] = useState<number | ''>('');
  const [masDepositos, setMasDepositos] = useState<number | ''>('');

  const formatoMoneda = (monto: any) => {
    const num = parseFloat(monto || 0);
    return isNaN(num) ? '$ 0.00' : `$ ${num.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // ✅ 1. CARGA DEL HISTORIAL DE NÓMINAS (Lectura Mínima)
  useEffect(() => {
    const qNominas = query(collection(db, 'referencias_nomina'), orderBy('createdAt', 'desc'), limit(400));
    const unSubNominas = onSnapshot(qNominas, (snap) => {
      const noms = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      setNominasGlobales(noms);
    });
    return () => unSubNominas();
  }, []);

  // ✅ 2. LAZY LOAD DE OPERACIONES Y CATÁLOGOS AL ENTRAR A ASIGNAR
  useEffect(() => {
    if (activeTab !== 'operaciones') return;

    const unSubEmpleados = onSnapshot(collection(db, 'empleados'), (snap) => {
      setOperadoresList(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });

    const unSubFormas = onSnapshot(collection(db, 'catalogo_formas_pago'), (snap) => {
      setFormasPagoList(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });

    const unSubBancos = onSnapshot(collection(db, 'catalogo_bancos'), (snap) => {
      setBancosList(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });

    const qOps = query(collection(db, 'operaciones'), limit(500));
    const unSubOperaciones = onSnapshot(qOps, (snap) => {
      const ops = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      ops.sort((a: any, b: any) => new Date(b.fechaServicio || b.createdAt || 0).getTime() - new Date(a.fechaServicio || a.createdAt || 0).getTime());
      setOperacionesGlobales(ops);
    });

    return () => { unSubEmpleados(); unSubFormas(); unSubBancos(); unSubOperaciones(); };
  }, [activeTab]);

  const generarConsecutivo = (fechaStr: string) => {
    const [year, month, day] = fechaStr.split('-');
    const prefix = `NOMINA-${day}${month}${year}-`;
    const nominasDeEseDia = nominasGlobales.filter(n => n.consecutivo?.startsWith(prefix));
    let maxSeq = 0;
    nominasDeEseDia.forEach(n => {
      const parts = n.consecutivo.split('-');
      if (parts.length === 3) {
        const seq = parseInt(parts[2], 10);
        if (seq > maxSeq) maxSeq = seq;
      }
    });
    return `${prefix}${String(maxSeq + 1).padStart(3, '0')}`;
  };

  const getNombreOperador = (idOrName: string) => {
    if (!idOrName) return '-';
    const found = operadoresList.find(o => o.id === idOrName || `${o.firstName} ${o.lastNamePaternal}`.trim() === idOrName.trim());
    return found ? `${found.firstName || ''} ${found.lastNamePaternal || ''}`.trim() : idOrName;
  };

  const getNombreBanco = (id: string) => bancosList.find(b => b.id === id)?.nombre || id;
  const getNombreFormaPago = (id: string) => formasPagoList.find(f => f.id === id)?.forma_pago || id;

  const formatearFechaSpanish = (fechaString: string) => {
    if (!fechaString) return '-';
    try { 
      return new Date(fechaString + 'T00:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }); 
    } catch { return fechaString; }
  };

  // ✅ FILTRO ESTRICTO DE OPERACIONES
  const operadoresOptions = useMemo(() => {
    const names = operadoresList.map(emp => `${emp.firstName || ''} ${emp.lastNamePaternal || ''}`.trim()).filter(Boolean);
    return Array.from(new Set(names)).sort();
  }, [operadoresList]);

  const operacionesPendientes = useMemo(() => {
    if (!filtroOperador || !fechaInicio || !fechaFin) return []; 
    return operacionesGlobales.filter(op => {
      const opOperador = getNombreOperador(op.operadorNombre || op.operadorId || op.operador || '');
      const opFecha = op.fechaServicio || op.fecha || '';
      const noAsignada = !op.referenciaNominaId;
      
      const matchOperador = opOperador === filtroOperador;
      const matchFecha = opFecha >= fechaInicio && opFecha <= fechaFin;

      return matchOperador && matchFecha && noAsignada;
    });
  }, [operacionesGlobales, filtroOperador, fechaInicio, fechaFin, operadoresList]);

  const toggleSeleccion = (id: string) => {
    setSeleccionadas(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
  };

  const resumenSeleccion = useMemo(() => {
    let subtotal = 0;
    const refs: string[] = [];
    seleccionadas.forEach(id => {
      const op = operacionesGlobales.find(o => o.id === id);
      if (op) {
        subtotal += Number(op.sueldoTotal || op.sueldoOperador || 0);
        refs.push(op.ref || op.id?.substring(0,6));
      }
    });
    return { subtotal, refs };
  }, [seleccionadas, operacionesGlobales]);

  // ✅ GUARDADO DE LA NÓMINA (Desnormalizado Estricto)
  const handleGuardarNomina = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardando(true);
    try {
      const batch = writeBatch(db);
      const nuevoId = doc(collection(db, 'referencias_nomina')).id;
      const consecutivoFinal = generarConsecutivo(fechaPago);

      const foundOp = operadoresList.find(o => `${o.firstName || ''} ${o.lastNamePaternal || ''}`.trim() === filtroOperador.trim());

      // Creamos un array estático con los textos de las operaciones para no depender de la DB después
      const operacionesResumenEstable = seleccionadas.map(id => {
        const op = operacionesGlobales.find(o => o.id === id);
        return {
          id: id,
          ref: op?.ref || id.substring(0,6),
          sueldo: Number(op?.sueldoTotal || op?.sueldoOperador || 0)
        };
      });

      const data = {
        consecutivo: consecutivoFinal,
        fechaPago: fechaPago,
        fechaInicio: fechaInicio,
        fechaFin: fechaFin,
        operadorId: foundOp ? foundOp.id : null,
        operadorNombre: filtroOperador, // Valor estático
        operacionesIds: seleccionadas, // Para lógica interna
        operacionesGuardadas: operacionesResumenEstable, // ✅ Textos estáticos listos para renderizar
        subtotalPagar: resumenSeleccion.subtotal,
        statusPagado: statusPagado === 'Pagada',
        
        // Monetarios
        nomina: Number(nomina),
        diferenciaAplicable: Number(diferenciaAplicable),
        infonavit: Number(infonavit),
        imss: Number(imss),
        isr: Number(isr),
        extras: Number(extras),
        depositoGastos: Number(depositoGastos),
        saldoPrestamo: Number(saldoPrestamo),
        ahorro: Number(ahorro),
        ahorroAcumulado: Number(ahorroAcumulado),
        prestamo: Number(prestamo),
        pagoPrestamo: Number(pagoPrestamo),
        vacaciones: Number(vacaciones),
        pagarAhorro: Number(pagarAhorro),
        fonacot: Number(fonacot),
        otrosDepositos: Number(otrosDepositos),
        otrasDeducciones: Number(otrasDeducciones),
        fonacotInicial: Number(fonacotInicial),
        saldo: Number(saldo),
        masDepositos: Number(masDepositos),
        
        // Catálogos estáticos
        formaPagoId: formaPagoSeleccionada,
        formaPagoNombre: getNombreFormaPago(formaPagoSeleccionada),
        bancoPagoId: bancoSeleccionado,
        bancoPagoNombre: getNombreBanco(bancoSeleccionado),
        notaDepositos: notaDepositos,
        createdAt: new Date().toISOString()
      };

      batch.set(doc(db, 'referencias_nomina', nuevoId), data);
      
      seleccionadas.forEach(id => {
        batch.update(doc(db, 'operaciones', id), { 
          referenciaNominaId: nuevoId, 
          referenciaNominaConsecutivo: consecutivoFinal 
        });
      });

      await batch.commit();
      setModalAbierto(false);
      setSeleccionadas([]);
      resetFormulario();
      setActiveTab('historial');
    } catch (error) {
      console.error(error);
      alert("Error al guardar la nómina.");
    } finally {
      setGuardando(false);
    }
  };

  const handleEliminarNomina = async (e: React.MouseEvent, nomData: any) => {
    e.stopPropagation();
    if (window.confirm(`¿Estás seguro de eliminar la nómina ${nomData.consecutivo}? Las operaciones asociadas quedarán liberadas nuevamente.`)) {
      try {
        const batch = writeBatch(db);
        batch.delete(doc(db, 'referencias_nomina', nomData.id));

        if (Array.isArray(nomData.operacionesIds)) {
          nomData.operacionesIds.forEach((opId: string) => {
            batch.update(doc(db, 'operaciones', opId), {
              referenciaNominaId: null,
              referenciaNominaConsecutivo: null
            });
          });
        }
        await batch.commit();
      } catch (error) {
        console.error("Error al eliminar nómina:", error);
        alert("Hubo un error al eliminar.");
      }
    }
  };

  const resetFormulario = () => {
    setNomina(''); setDiferenciaAplicable(''); setInfonavit(''); setImss(''); setIsr('');
    setExtras(''); setDepositoGastos(''); setSaldoPrestamo(''); setAhorro('');
    setAhorroAcumulado(''); setPrestamo(''); setPagoPrestamo(''); setVacaciones('');
    setPagarAhorro(''); setFonacot(''); setOtrosDepositos(''); setOtrasDeducciones('');
    setFonacotInicial(''); setSaldo(''); setMasDepositos(''); setNotaDepositos('');
    setFormaPagoSeleccionada(''); setBancoSeleccionado(''); setStatusPagado('Pendiente');
  };

  // ✅ FILTRADO Y PAGINACIÓN HISTORIAL
  const historialFiltrado = useMemo(() => {
    const t = busquedaHistorial.toLowerCase();
    return nominasGlobales.filter(n => 
      n.consecutivo?.toLowerCase().includes(t) || 
      (n.operadorNombre || n.operadorId || '').toLowerCase().includes(t)
    );
  }, [nominasGlobales, busquedaHistorial]);

  const totalPaginas = Math.ceil(historialFiltrado.length / registrosPorPagina);
  const indexLast = paginaActual * registrosPorPagina;
  const indexFirst = indexLast - registrosPorPagina;
  const registrosVisibles = historialFiltrado.slice(indexFirst, indexLast);

  const irPaginaSiguiente = () => setPaginaActual(p => Math.min(p + 1, totalPaginas));
  const irPaginaAnterior = () => setPaginaActual(p => Math.max(p - 1, 1));

  const exportarCSV = () => {
    if (historialFiltrado.length === 0) return alert("No hay datos para exportar.");
    const datosExcel = historialFiltrado.map(n => ({
      'Consecutivo': n.consecutivo,
      'Operador': n.operadorNombre || n.operadorId,
      'Fecha Pago': formatearFechaSpanish(n.fechaPago),
      'Semana': `${formatearFechaSpanish(n.fechaInicio)} al ${formatearFechaSpanish(n.fechaFin)}`,
      'Status': n.statusPagado ? 'PAGADA' : 'PENDIENTE',
      'Subtotal Ops': n.subtotalPagar,
      'Nómina': n.nomina,
      'Banco': n.bancoPagoNombre || n.bancoPagoId,
      'Forma Pago': n.formaPagoNombre || n.formaPagoId,
      'IMSS': n.imss,
      'ISR': n.isr,
      'Infonavit': n.infonavit,
      'Notas': n.notaDepositos
    }));

    const worksheet = XLSX.utils.json_to_sheet(datosExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Nominas');
    XLSX.writeFile(workbook, `Historial_Nominas_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const tabStyle = (active: boolean) => ({
    padding: '12px 24px', background: 'none', border: 'none', cursor: 'pointer',
    color: active ? '#f0f6fc' : '#8b949e', borderBottom: active ? '2px solid #D84315' : '2px solid transparent',
    fontWeight: active ? 'bold' : 'normal' as any
  });

  return (
    <div className="module-container" style={{ padding: '24px', animation: 'fadeIn 0.3s ease' }}>
      <h1 style={{ color: '#f0f6fc', fontSize: '1.5rem', marginBottom: '24px' }}>Referencias de Nómina</h1>

      <div style={{ display: 'flex', borderBottom: '1px solid #30363d', marginBottom: '24px' }}>
        <button onClick={() => setActiveTab('operaciones')} style={tabStyle(activeTab === 'operaciones')}>Asignar Operaciones</button>
        <button onClick={() => setActiveTab('historial')} style={tabStyle(activeTab === 'historial')}>Historial de Nóminas</button>
      </div>

      {activeTab === 'operaciones' ? (
        <div className="animation-fade-in">
          
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', marginBottom: '20px', alignItems: 'flex-end', backgroundColor: '#0d1117', padding: '20px', borderRadius: '8px', border: '1px solid #30363d' }}>
            <div style={{ flex: 1, minWidth: '200px' }}>
              <label style={{ color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>OPERADOR</label>
              <select value={filtroOperador} onChange={e => { setFiltroOperador(e.target.value); setSeleccionadas([]); }} style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px' }}>
                <option value="">Seleccionar Operador...</option>
                {operadoresOptions.map((name, i) => <option key={i} value={name}>{name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>FECHA INICIO (Rango)</label>
              <input type="date" value={fechaInicio} onChange={e => {setFechaInicio(e.target.value); setSeleccionadas([]);}} style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px' }} />
            </div>
            <div>
              <label style={{ color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>FECHA FIN (Rango)</label>
              <input type="date" value={fechaFin} onChange={e => {setFechaFin(e.target.value); setSeleccionadas([]);}} style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px' }} />
            </div>

            <button 
              disabled={seleccionadas.length === 0} 
              onClick={() => { setConsecutivoForm(generarConsecutivo(fechaPago)); setModalAbierto(true); }}
              style={{ padding: '10px 20px', backgroundColor: seleccionadas.length > 0 ? '#D84315' : '#30363d', color: '#fff', border: 'none', borderRadius: '6px', cursor: seleccionadas.length > 0 ? 'pointer' : 'not-allowed', fontWeight: 'bold', whiteSpace: 'nowrap' }}
            >
              Generar Nómina ({seleccionadas.length})
            </button>
          </div>

          {seleccionadas.length > 0 && (
            <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '20px', marginBottom: '20px', animation: 'fadeIn 0.3s ease' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', marginBottom: '16px' }}>
                <div style={{ borderRight: '1px solid #30363d' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Operaciones Seleccionadas</span>
                  <span style={{ color: '#58a6ff', fontSize: '1.8rem', fontWeight: 'bold' }}>{seleccionadas.length}</span>
                </div>
                <div>
                  <span style={{ display: 'block', color: '#D84315', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Subtotal Sueldos a Pagar</span>
                  <span style={{ color: '#3fb950', fontSize: '1.8rem', fontWeight: 'bold' }}>{formatoMoneda(resumenSeleccion.subtotal)}</span>
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
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>OPERADOR</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>ORIGEN</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>DESTINO</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>SUELDO OP.</th>
                </tr>
              </thead>
              <tbody>
                {(!filtroOperador || !fechaInicio || !fechaFin) ? (
                  <tr><td colSpan={7} style={{ padding: '40px', textAlign: 'center', color: '#8b949e' }}>Llena todos los filtros superiores para buscar operaciones pendientes.</td></tr>
                ) : operacionesPendientes.length === 0 ? (
                  <tr><td colSpan={7} style={{ padding: '40px', textAlign: 'center', color: '#8b949e' }}>No hay operaciones pendientes en este rango.</td></tr>
                ) : (
                  operacionesPendientes.map(op => (
                    <tr key={op.id} onClick={() => toggleSeleccion(op.id)} style={{ cursor: 'pointer', borderBottom: '1px solid #21262d', backgroundColor: seleccionadas.includes(op.id) ? 'rgba(216,67,21,0.1)' : 'transparent' }}>
                      <td style={{ padding: '16px', textAlign: 'center', whiteSpace: 'nowrap' }}><input type="checkbox" checked={seleccionadas.includes(op.id)} readOnly style={{ cursor: 'pointer', width: '16px', height: '16px' }} /></td>
                      <td style={{ padding: '16px', color: '#58a6ff', fontWeight: 'bold', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{op.ref || op.id.substring(0,6)}</td>
                      <td style={{ padding: '16px', color: '#c9d1d9', whiteSpace: 'nowrap' }}>{formatearFechaSpanish(op.fechaServicio || op.createdAt)}</td>
                      <td style={{ padding: '16px', color: '#c9d1d9', whiteSpace: 'nowrap' }}>{getNombreOperador(op.operadorNombre || op.operadorId || op.operador)}</td>
                      <td style={{ padding: '16px', color: '#c9d1d9', whiteSpace: 'nowrap' }}>{op.origen || '-'}</td>
                      <td style={{ padding: '16px', color: '#c9d1d9', whiteSpace: 'nowrap' }}>{op.destino || '-'}</td>
                      <td style={{ padding: '16px', color: '#3fb950', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{formatoMoneda(op.sueldoTotal || op.sueldoOperador)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      ) : (
        <div className="animation-fade-in">
          <div style={{ position: 'relative', marginBottom: '20px', display: 'flex', justifyContent: 'space-between' }}>
            <input type="text" placeholder="Buscar en historial (Consecutivo, Operador)..." value={busquedaHistorial} onChange={e => setBusquedaHistorial(e.target.value)} style={{ width: '100%', maxWidth: '400px', padding: '10px 16px', backgroundColor: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px' }} />
            <button title="Exportar a Excel" onClick={exportarCSV} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent', border: '1px solid #8b949e', color: '#c9d1d9', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </button>
          </div>

          <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 280px)', backgroundColor: '#161b22' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead style={{ backgroundColor: '#1f2937', color: '#8b949e', fontSize: '0.8rem', position: 'sticky', top: 0, zIndex: 10 }}>
                <tr>
                  <th style={{ padding: '16px', textAlign: 'center', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>ACCIONES</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>CONSECUTIVO</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>STATUS</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>OPERADOR</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>FECHA PAGO</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>PERÍODO (SEMANA)</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>SUBTOTAL OPS</th>
                </tr>
              </thead>
              <tbody>
                {registrosVisibles.length === 0 ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>No hay referencias de nómina registradas.</td></tr>
                ) : (
                  registrosVisibles.map(r => (
                    <tr key={r.id} style={{ borderBottom: '1px solid #21262d' }}>
                      <td style={{ padding: '16px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                          <button 
                            title="Ver Ficha" 
                            onClick={() => setNominaViendo(r)} 
                            style={{ background: 'transparent', border: '1px solid #3b82f6', borderRadius: '4px', color: '#3b82f6', cursor: 'pointer', padding: '6px', display: 'flex' }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                          </button>
                          
                          <button 
                            title="Eliminar Nómina" 
                            onClick={(e) => handleEliminarNomina(e, r)} 
                            style={{ background: 'transparent', border: '1px solid #ef4444', borderRadius: '4px', color: '#ef4444', cursor: 'pointer', padding: '6px', display: 'flex' }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                          </button>
                        </div>
                      </td>
                      <td style={{ padding: '16px', color: '#D84315', fontWeight: 'bold', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{r.consecutivo}</td>
                      <td style={{ padding: '16px', whiteSpace: 'nowrap' }}>
                        <span style={{ 
                          padding: '4px 12px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 'bold', 
                          backgroundColor: r.statusPagado ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                          color: r.statusPagado ? '#10b981' : '#f59e0b',
                          border: `1px solid ${r.statusPagado ? '#10b981' : '#f59e0b'}`
                        }}>
                          {r.statusPagado ? 'PAGADA' : 'PENDIENTE'}
                        </span>
                      </td>
                      <td style={{ padding: '16px', color: '#f0f6fc', whiteSpace: 'nowrap' }}>{r.operadorNombre || r.operadorId || '-'}</td>
                      <td style={{ padding: '16px', color: '#c9d1d9', whiteSpace: 'nowrap' }}>{formatearFechaSpanish(r.fechaPago)}</td>
                      <td style={{ padding: '16px', color: '#8b949e', whiteSpace: 'nowrap' }}>{formatearFechaSpanish(r.fechaInicio)} <br/>al {formatearFechaSpanish(r.fechaFin)}</td>
                      <td style={{ padding: '16px', color: '#58a6ff', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{formatoMoneda(r.subtotalPagar)}</td>
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

      {/* MODAL FORMULARIO */}
      {modalAbierto && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px', backdropFilter: 'blur(8px)' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', width: '100%', maxWidth: '900px', maxHeight: '90vh', overflowY: 'auto', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px', borderBottom: '1px solid #30363d', paddingBottom: '16px' }}>
              <h2 style={{ color: '#f0f6fc', margin: 0 }}>Generar Nómina: <span style={{ color: '#D84315' }}>{consecutivoForm}</span></h2>
              <button onClick={() => setModalAbierto(false)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#010409', padding: '16px', borderRadius: '8px', border: '1px dashed #30363d', marginBottom: '24px' }}>
              <div>
                <span style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Operador Seleccionado</span>
                <span style={{ color: '#f0f6fc', fontSize: '1.1rem', fontWeight: 'bold' }}>{filtroOperador}</span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Subtotal Operaciones ({seleccionadas.length})</span>
                <span style={{ color: '#58a6ff', fontSize: '1.4rem', fontWeight: 'bold' }}>{formatoMoneda(resumenSeleccion.subtotal)}</span>
              </div>
            </div>
            
            <form onSubmit={handleGuardarNomina}>
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '24px' }}>
                <div>
                  <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>FECHA PAGO</label>
                  <input type="date" required value={fechaPago} onChange={e => {setFechaPago(e.target.value); setConsecutivoForm(generarConsecutivo(e.target.value));}} style={{ width: '100%', padding: '8px', backgroundColor: '#161b22', color: '#fff', border: '1px solid #30363d', borderRadius: '4px' }} />
                </div>
                <div>
                  <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>STATUS NÓMINA</label>
                  <select value={statusPagado} onChange={e => setStatusPagado(e.target.value as any)} style={{ width: '100%', padding: '8px', backgroundColor: statusPagado === 'Pagada' ? 'rgba(16, 185, 129, 0.1)' : '#161b22', color: statusPagado === 'Pagada' ? '#10b981' : '#f0f6fc', border: '1px solid #30363d', borderRadius: '4px', fontWeight: 'bold' }}>
                    <option value="Pendiente">Pendiente</option>
                    <option value="Pagada">Pagada ✔</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '24px' }}>
                <div>
                  <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>FORMA DE PAGO</label>
                  <select required value={formaPagoSeleccionada} onChange={e => setFormaPagoSeleccionada(e.target.value)} style={{ width: '100%', padding: '8px', backgroundColor: '#161b22', color: '#fff', border: '1px solid #30363d', borderRadius: '4px' }}>
                    <option value="">Seleccionar...</option>
                    {formasPagoList.map(f => <option key={f.id} value={f.id}>{f.forma_pago}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>BANCO DE PAGO</label>
                  <select required value={bancoSeleccionado} onChange={e => setBancoSeleccionado(e.target.value)} style={{ width: '100%', padding: '8px', backgroundColor: '#161b22', color: '#fff', border: '1px solid #30363d', borderRadius: '4px' }}>
                    <option value="">Seleccionar...</option>
                    {bancosList.map(b => <option key={b.id} value={b.id}>{b.nombre}</option>)}
                  </select>
                </div>
              </div>

              <h3 style={{ color: '#58a6ff', fontSize: '1rem', borderBottom: '1px solid #30363d', paddingBottom: '8px', marginBottom: '16px' }}>Cantidades (MXN)</h3>
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '24px' }}>
                {[
                  {label: 'NÓMINA', val: nomina, setter: setNomina},
                  {label: 'DIFERENCIA APLIC.', val: diferenciaAplicable, setter: setDiferenciaAplicable},
                  {label: 'INFONAVIT', val: infonavit, setter: setInfonavit},
                  {label: 'IMSS', val: imss, setter: setImss},
                  {label: 'ISR', val: isr, setter: setIsr},
                  {label: 'EXTRAS', val: extras, setter: setExtras},
                  {label: 'DEP. GASTOS', val: depositoGastos, setter: setDepositoGastos},
                  {label: 'SALDO PREST.', val: saldoPrestamo, setter: setSaldoPrestamo},
                  {label: 'AHORRO', val: ahorro, setter: setAhorro},
                  {label: 'AHORRO ACUM.', val: ahorroAcumulado, setter: setAhorroAcumulado},
                  {label: 'PRÉSTAMO', val: prestamo, setter: setPrestamo},
                  {label: 'PAGO PRÉSTAMO', val: pagoPrestamo, setter: setPagoPrestamo},
                  {label: 'VACACIONES', val: vacaciones, setter: setVacaciones},
                  {label: 'PAGAR AHORRO', val: pagarAhorro, setter: setPagarAhorro},
                  {label: 'FONACOT', val: fonacot, setter: setFonacot},
                  {label: 'FONACOT INICIAL', val: fonacotInicial, setter: setFonacotInicial},
                  {label: 'OTROS DEP.', val: otrosDepositos, setter: setOtrosDepositos},
                  {label: 'OTRAS DED.', val: otrasDeducciones, setter: setOtrasDeducciones},
                  {label: 'SALDO', val: saldo, setter: setSaldo},
                  {label: 'MÁS DEPÓSITOS', val: masDepositos, setter: setMasDepositos},
                ].map((campo, i) => (
                  <div key={i}>
                    <label style={{ color: '#8b949e', fontSize: '0.7rem', display: 'block', marginBottom: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{campo.label}</label>
                    <input type="number" step="0.01" value={campo.val} onChange={e => campo.setter(e.target.valueAsNumber || '')} style={{ width: '100%', padding: '8px', backgroundColor: '#161b22', color: '#3fb950', border: '1px solid #30363d', borderRadius: '4px', fontWeight: 'bold' }} />
                  </div>
                ))}
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>NOTAS / OBSERVACIONES</label>
                <textarea value={notaDepositos} onChange={e => setNotaDepositos(e.target.value)} style={{ width: '100%', padding: '8px', backgroundColor: '#161b22', color: '#fff', border: '1px solid #30363d', borderRadius: '4px', height: '60px' }} />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', borderTop: '1px solid #30363d', paddingTop: '20px' }}>
                <button type="button" onClick={() => setModalAbierto(false)} disabled={guardando} style={{ padding: '8px 24px', background: 'none', color: '#8b949e', border: '1px solid #30363d', borderRadius: '6px', cursor: 'pointer' }}>Cancelar</button>
                <button type="submit" disabled={guardando} style={{ padding: '8px 24px', backgroundColor: '#238636', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>{guardando ? 'Guardando...' : 'Confirmar Nómina'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ✅ MODAL FICHA NÓMINA CON OPERACIONES DESNORMALIZADAS */}
      {nominaViendo && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 1500, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px', backdropFilter: 'blur(4px)' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', width: '900px', maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
            
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #30363d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.4rem' }}>Ficha de Nómina</h2>
              <button onClick={() => setNominaViendo(null)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>
            
            <div style={{ padding: '24px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px', marginBottom: '24px' }}>
                <div style={{ gridColumn: 'span 3', display: 'flex', justifyContent: 'space-between', backgroundColor: '#161b22', padding: '16px', borderRadius: '8px', border: '1px solid #30363d', alignItems: 'center' }}>
                  <div>
                    <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Consecutivo</span>
                    <span style={{ color: '#D84315', fontSize: '1.2rem', fontWeight: 'bold', fontFamily: 'monospace' }}>{nominaViendo.consecutivo}</span>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Status</span>
                    <span style={{ 
                        padding: '4px 12px', borderRadius: '12px', fontSize: '0.85rem', fontWeight: 'bold', 
                        backgroundColor: nominaViendo.statusPagado ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                        color: nominaViendo.statusPagado ? '#10b981' : '#f59e0b',
                        border: `1px solid ${nominaViendo.statusPagado ? '#10b981' : '#f59e0b'}`
                      }}>
                        {nominaViendo.statusPagado ? 'PAGADA' : 'PENDIENTE'}
                    </span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Fecha de Pago</span>
                    <span style={{ color: '#c9d1d9', fontSize: '1rem', fontWeight: 'bold' }}>{formatearFechaSpanish(nominaViendo.fechaPago)}</span>
                  </div>
                </div>

                <div>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Operador</span>
                  <span style={{ color: '#f0f6fc', fontSize: '1rem', fontWeight: 'bold' }}>{nominaViendo.operadorNombre || '-'}</span>
                </div>
                <div>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Período Reportado</span>
                  <span style={{ color: '#c9d1d9', fontSize: '0.9rem' }}>{formatearFechaSpanish(nominaViendo.fechaInicio)} al {formatearFechaSpanish(nominaViendo.fechaFin)}</span>
                </div>
                <div>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Método</span>
                  <span style={{ color: '#c9d1d9', fontSize: '0.9rem' }}>{nominaViendo.bancoPagoNombre} ({nominaViendo.formaPagoNombre})</span>
                </div>

                <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '0' }} /></div>

                <div style={{ gridColumn: 'span 3', display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '16px', backgroundColor: '#010409', padding: '16px', borderRadius: '8px', border: '1px dashed #30363d' }}>
                  {[
                    {lbl: 'SUBTOTAL OPERACIONES', val: nominaViendo.subtotalPagar},
                    {lbl: 'NÓMINA', val: nominaViendo.nomina},
                    {lbl: 'DIFERENCIA APLICABLE', val: nominaViendo.diferenciaAplicable},
                    {lbl: 'IMSS', val: nominaViendo.imss},
                    {lbl: 'ISR', val: nominaViendo.isr},
                    {lbl: 'INFONAVIT', val: nominaViendo.infonavit},
                    {lbl: 'EXTRAS', val: nominaViendo.extras},
                    {lbl: 'FONACOT', val: nominaViendo.fonacot},
                    {lbl: 'AHORRO', val: nominaViendo.ahorro},
                    {lbl: 'PRÉSTAMO', val: nominaViendo.prestamo},
                    {lbl: 'SALDO', val: nominaViendo.saldo},
                    {lbl: 'VACACIONES', val: nominaViendo.vacaciones},
                  ].map((it, idx) => (
                    <div key={idx}>
                      <span style={{ display: 'block', color: '#8b949e', fontSize: '0.65rem', fontWeight: 'bold', textTransform: 'uppercase' }}>{it.lbl}</span>
                      <span style={{ color: '#58a6ff', fontSize: '0.95rem', fontWeight: 'bold' }}>{formatoMoneda(it.val)}</span>
                    </div>
                  ))}
                </div>

                <div style={{ gridColumn: 'span 3' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Notas / Observaciones</span>
                  <div style={{ color: '#c9d1d9', backgroundColor: '#161b22', padding: '12px', borderRadius: '6px', border: '1px solid #30363d', minHeight: '40px' }}>
                    {nominaViendo.notaDepositos || '-'}
                  </div>
                </div>

                {/* ✅ LECTURA ESTÁTICA DE LAS OPERACIONES SIN CONSUMIR LA COLECCIÓN */}
                <div style={{ gridColumn: 'span 3', marginTop: '16px' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '12px' }}>
                    Operaciones Pagadas en esta Nómina ({nominaViendo.operacionesGuardadas?.length || 0})
                  </span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {nominaViendo.operacionesGuardadas?.map((op: any) => (
                      <span 
                        key={op.id} 
                        title={`Sueldo Original: ${formatoMoneda(op.sueldo)}`}
                        style={{ 
                          backgroundColor: '#21262d', border: '1px solid #58a6ff', color: '#58a6ff', 
                          padding: '6px 14px', borderRadius: '16px', fontSize: '0.85rem', fontFamily: 'monospace',
                          cursor: 'default', display: 'inline-flex', alignItems: 'center', gap: '6px'
                        }}
                      >
                        {op.ref}
                      </span>
                    )) || <span style={{ color: '#8b949e' }}>Sin detalle de operaciones.</span>}
                  </div>
                </div>

              </div>
            </div>
            
            <div style={{ padding: '16px 24px', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #30363d', backgroundColor: '#161b22' }}>
              <button onClick={() => setNominaViendo(null)} className="btn btn-outline" style={{ padding: '8px 24px', borderRadius: '6px', color: '#c9d1d9', border: '1px solid #30363d', background: 'transparent', cursor: 'pointer' }}>Cerrar Ficha</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};