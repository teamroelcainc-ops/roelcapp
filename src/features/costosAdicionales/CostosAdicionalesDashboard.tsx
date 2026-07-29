// src/features/costosAdicionales/CostosAdicionalesDashboard.tsx
//
// Módulo para registrar COSTOS ADICIONALES (cliente y proveedor) ligados a una
// operación, guardados en una colección aparte: `costos_adicionales`.
//
// Cada registro: { operacionId, operacionRef, tipo: 'cliente'|'proveedor',
//   convenioId, convenioNombre, observaciones, monto, createdAt }
//
// Al guardar/eliminar, el TOTAL de cada lado se escribe en la operación
// (cargosAdicionales / cargosAdicionalesProv) y se recalculan subtotales,
// conversiones (USD/MXN según el tipo de cambio guardado) y la utilidad,
// para que los cálculos del resto del sistema queden consistentes.
//
// Lecturas mínimas: catálogos desde caché local (mismas llaves cat_v1__* que el
// resto de la app), operaciones paginadas (50 + "Cargar más"), y los costos solo
// de la operación seleccionada.

import { useState, useEffect, useMemo, useRef } from 'react';
import {
  collection, getDocs, query, orderBy, limit, startAfter,
  doc, addDoc, deleteDoc, updateDoc, where
} from 'firebase/firestore';
import { db } from '../../config/firebase';
import './CostosAdicionalesDashboard.css';

const ID_USD = '7dca62b3';
const ID_MXN = 'f95d8894';
const TAMANO_PAGINA = 50;

// ── Caché local de catálogos (comparte llaves cat_v1__<alias> con el resto de la app) ──
const DIA_MS = 24 * 60 * 60 * 1000;
const CATS: Record<string, string> = {
  tarifas:                  'catalogo_tarifas_referencia',
  catalogoMoneda:           'catalogo_moneda',
  conveniosProv:            'convenios_proveedores',
  catalogoConvProvDetalles: 'convenios_proveedores_detalles',
  catalogoConvClientes:     'convenios_clientes',
  catalogoConvDetalles:     'convenios_clientes_detalles',
};
const TTL_MS: Record<string, number> = {
  tarifas: 7 * DIA_MS, catalogoMoneda: 7 * DIA_MS,
  conveniosProv: DIA_MS, catalogoConvProvDetalles: DIA_MS,
  catalogoConvClientes: DIA_MS, catalogoConvDetalles: DIA_MS,
};
const claveCache = (alias: string) => `cat_v1__${alias}`;
const leerCache = (alias: string): { ts: number; data: any[] } | null => {
  try {
    const raw = localStorage.getItem(claveCache(alias));
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return obj && Array.isArray(obj.data) ? obj : null;
  } catch { return null; }
};
const escribirCache = (alias: string, data: any[]) => {
  try { localStorage.setItem(claveCache(alias), JSON.stringify({ ts: Date.now(), data })); } catch {}
};
const cacheVigente = (alias: string): boolean => {
  const obj = leerCache(alias);
  if (!obj) return false;
  return (Date.now() - (obj.ts || 0)) < (TTL_MS[alias] ?? DIA_MS);
};

const formatoMoneda = (m: any) => {
  const n = parseFloat(m || 0);
  return isNaN(n) ? '$ 0.00' : `$ ${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const formatearFecha = (f: string) => {
  if (!f) return '-';
  try { return new Date(f + 'T00:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return f; }
};

interface CostosAdicionalesDashboardProps {
  // Si se pasa una operación, el módulo abre directamente en ella (modo modal),
  // omitiendo la lista. Sirve para invocarlo desde el formulario de operación.
  operacionFija?: any;
  // Botón de cierre cuando se usa como modal (vuelve al formulario).
  onCerrar?: () => void;
  // Avisa al padre los nuevos totales para que sincronice sus cálculos.
  onCostosActualizados?: (cambios: { cargosAdicionales: number; cargosAdicionalesProv: number }) => void;
}

export const CostosAdicionalesDashboard = ({ operacionFija, onCerrar, onCostosActualizados }: CostosAdicionalesDashboardProps = {}) => {
  const comoModal = !!operacionFija;
  const [operaciones, setOperaciones] = useState<any[]>([]);
  const [cargandoOps, setCargandoOps] = useState(true);
  const [hayMas, setHayMas] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [busqueda, setBusqueda] = useState('');

  const [catalogos, setCatalogos] = useState<any>({});
  const enVueloRef = useRef<Set<string>>(new Set());

  const [opSeleccionada, setOpSeleccionada] = useState<any | null>(operacionFija || null);
  const [costos, setCostos] = useState<any[]>([]);
  const [cargandoCostos, setCargandoCostos] = useState(false);

  // Modal "Agregar Costos Adicionales"
  const [modal, setModal] = useState<{ tipo: 'cliente' | 'proveedor' } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [convenioSel, setConvenioSel] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [monto, setMonto] = useState<number | ''>('');

  // ── Catálogos (caché-first) ──
  const cargarCatalogos = async () => {
    // Hidrata de caché al instante
    const inicial: any = {};
    Object.keys(CATS).forEach(alias => {
      const c = leerCache(alias);
      if (c && Array.isArray(c.data)) inicial[alias] = c.data;
    });
    if (Object.keys(inicial).length) setCatalogos((prev: any) => ({ ...prev, ...inicial }));
    // Descarga solo lo vencido/faltante
    const pendientes = Object.entries(CATS)
      .filter(([alias]) => !cacheVigente(alias) && !enVueloRef.current.has(alias))
      .map(([alias, col]) => ({ alias, col }));
    pendientes.forEach(p => enVueloRef.current.add(p.alias));
    await Promise.all(pendientes.map(async ({ alias, col }) => {
      try {
        const snap = await getDocs(collection(db, col));
        const data = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
        escribirCache(alias, data);
        setCatalogos((prev: any) => ({ ...prev, [alias]: data }));
      } catch (e) { console.error(`Error catálogo ${col}:`, e); }
      finally { enVueloRef.current.delete(alias); }
    }));
  };

  const descargarOperaciones = async () => {
    setCargandoOps(true);
    try {
      const q = query(collection(db, 'operaciones'), orderBy('fechaServicio', 'desc'), limit(TAMANO_PAGINA));
      const snap = await getDocs(q);
      setOperaciones(snap.docs.map((d: any) => ({ id: d.id, ...d.data() })));
      setHayMas(snap.docs.length === TAMANO_PAGINA);
    } catch (e: any) {
      console.error('Error al cargar operaciones:', e);
      const msg = String(e?.message || e?.code || e || '').toLowerCase();
      if (msg.includes('resource-exhausted') || msg.includes('quota') || msg.includes('429')) {
        alert('Cuota de lecturas de Firestore agotada. Se reinicia a las 2 AM (hora México).');
      } else if (msg.includes('permission')) {
        alert('Sin permisos para leer operaciones. Revisa las reglas de Firestore.');
      } else {
        alert('Hubo un problema al cargar las operaciones.');
      }
    }
    setCargandoOps(false);
  };

  const cargarMas = async () => {
    if (!hayMas || cargandoMas || operaciones.length === 0) return;
    setCargandoMas(true);
    try {
      const ultimo = operaciones[operaciones.length - 1];
      const q = query(collection(db, 'operaciones'), orderBy('fechaServicio', 'desc'),
        startAfter(ultimo.fechaServicio || ''), limit(TAMANO_PAGINA));
      const snap = await getDocs(q);
      setOperaciones(prev => [...prev, ...snap.docs.map((d: any) => ({ id: d.id, ...d.data() }))]);
      setHayMas(snap.docs.length === TAMANO_PAGINA);
    } catch (e) { console.error('Error al cargar más:', e); }
    setCargandoMas(false);
  };

  useEffect(() => {
    cargarCatalogos();
    if (operacionFija) {
      cargarCostos(operacionFija); // modo modal: no descargamos la lista (0 lecturas extra)
    } else {
      descargarOperaciones();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Costos de la operación seleccionada ──
  const cargarCostos = async (op: any) => {
    if (!op) return;
    setCargandoCostos(true);
    try {
      const q = query(collection(db, 'costos_adicionales'), where('operacionId', '==', op.id));
      const snap = await getDocs(q);
      const data = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
      data.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
      setCostos(data);
    } catch (e) {
      console.error('Error al cargar costos adicionales:', e);
      alert('No se pudieron cargar los costos adicionales de esta operación.');
    }
    setCargandoCostos(false);
  };

  const seleccionarOperacion = (op: any) => {
    setOpSeleccionada(op);
    setCostos([]);
    cargarCostos(op);
  };

  // ── Convenios del cliente / proveedor de la operación seleccionada ──
  const conveniosCliente = useMemo(() => {
    const op = opSeleccionada;
    if (!op) return [];
    const clientId = op.clientePaga || op.clienteId;
    const convClientes = catalogos.catalogoConvClientes || [];
    const convDetalles = catalogos.catalogoConvDetalles || [];
    const tarifas = catalogos.tarifas || [];
    if (!clientId || convClientes.length === 0) return [];
    const maestros = convClientes.filter((c: any) => String(c.clienteId).trim() === String(clientId).trim());
    if (maestros.length === 0) return [];
    const maestroIds = new Set(maestros.map((m: any) => String(m.id).trim()));
    const detalles = convDetalles.filter((d: any) => maestroIds.has(String(d.convenioId).trim()));
    return detalles.map((d: any) => {
      const tarifaId = d.tipoConvenioId || d.tipo_convenio_id || d.tipoConvenio || d['TIPO DE CONVENIO'];
      const tObj = tarifas.find((t: any) => String(t.id).trim() === String(tarifaId).trim());
      const nombre = d.tipoConvenioNombre || tObj?.descripcion || tObj?.nombre || (tarifaId ? `Tarifa (${tarifaId})` : 'Sin Asignar');
      return { id: d.id, nombre };
    });
  }, [opSeleccionada, catalogos.catalogoConvClientes, catalogos.catalogoConvDetalles, catalogos.tarifas]);

  const conveniosProveedor = useMemo(() => {
    const op = opSeleccionada;
    if (!op) return [];
    const provId = op.proveedorUnidad;
    const conveniosProv = catalogos.conveniosProv || [];
    const convProvDetalles = catalogos.catalogoConvProvDetalles || [];
    const tarifas = catalogos.tarifas || [];
    if (!provId || conveniosProv.length === 0) return [];
    const maestros = conveniosProv.filter((c: any) =>
      String(c.proveedorId || c.proveedor || c.id_proveedor || '').trim() === String(provId).trim());
    if (maestros.length === 0) return [];
    const maestroIds = new Set(maestros.map((m: any) => String(m.id).trim()));
    const detalles = convProvDetalles.filter((d: any) =>
      maestroIds.has(String(d.convenioId || d.convenio || d.id_convenio || '').trim()));
    return detalles.map((d: any) => {
      const tarifaId = d.tipoConvenioId || d.tipo_convenio || d.tarifaId || d['TIPO DE CONVENIO'];
      const tObj = tarifas.find((t: any) => String(t.id).trim() === String(tarifaId).trim());
      const nombre = tObj?.descripcion || tObj?.nombre || d.tipoConvenioNombre || 'Concepto sin nombre';
      return { id: d.id, nombre };
    });
  }, [opSeleccionada, catalogos.conveniosProv, catalogos.catalogoConvProvDetalles, catalogos.tarifas]);

  const conveniosDelModal = modal?.tipo === 'proveedor' ? conveniosProveedor : conveniosCliente;

  // ── Totales por tipo ──
  const totalCliente = useMemo(() =>
    costos.filter(c => c.tipo === 'cliente').reduce((s, c) => s + Number(c.monto || 0), 0), [costos]);
  const totalProveedor = useMemo(() =>
    costos.filter(c => c.tipo === 'proveedor').reduce((s, c) => s + Number(c.monto || 0), 0), [costos]);

  // ── Recalcular conversiones de la operación (espejo del formulario) ──
  const monedaNombre = (id: string) => (catalogos.catalogoMoneda || []).find((m: any) => m.id === id)?.moneda || '';
  const esUSD = (id: string) => id === ID_USD || monedaNombre(id).toUpperCase().includes('USD');
  const esMXN = (id: string) => id === ID_MXN || monedaNombre(id).toUpperCase().includes('MXN');
  const conv = (subtotal: number, monedaId: string, tc: number) => {
    if (esUSD(monedaId)) return { dol: subtotal, pes: 0, conv: subtotal * tc };
    if (esMXN(monedaId)) return { dol: 0, pes: subtotal, conv: subtotal };
    return { dol: 0, pes: 0, conv: subtotal }; // moneda desconocida: sin TC
  };

  const recalcularOperacion = (op: any, cargosCliente: number, cargosProv: number) => {
    const tc = Number(op.tipoCambioAprobado) || 0;
    const subtotalCliente = Number(op.montoConvenioCliente || 0) + cargosCliente;
    const c = conv(subtotalCliente, op.facturadoEnCobrar, tc);
    const subtotalProv = Number(op.totalAPagarProv || 0) + cargosProv;
    const p = conv(subtotalProv, op.facturadoEnUnidad, tc);
    return {
      cargosAdicionales: cargosCliente,
      subtotalCliente, dolaresCliente: c.dol, pesosCliente: c.pes, conversionCliente: c.conv,
      cargosAdicionalesProv: cargosProv,
      subtotalProv, dolaresProv: p.dol, pesosProv: p.pes, conversionProv: p.conv,
      utilidadEstimada: c.conv - p.conv,
    };
  };

  // Tras agregar/eliminar, recalcula desde la lista de costos y actualiza la operación
  const sincronizarOperacion = async (op: any, listaCostos: any[]) => {
    const tCliente = listaCostos.filter(c => c.tipo === 'cliente').reduce((s, c) => s + Number(c.monto || 0), 0);
    const tProv = listaCostos.filter(c => c.tipo === 'proveedor').reduce((s, c) => s + Number(c.monto || 0), 0);
    const cambios = recalcularOperacion(op, tCliente, tProv);
    await updateDoc(doc(db, 'operaciones', op.id), cambios);
    const opActualizada = { ...op, ...cambios };
    setOpSeleccionada(opActualizada);
    setOperaciones(prev => prev.map(o => o.id === op.id ? opActualizada : o));
    onCostosActualizados?.({ cargosAdicionales: tCliente, cargosAdicionalesProv: tProv });
  };

  const abrirModal = (tipo: 'cliente' | 'proveedor') => {
    setConvenioSel(''); setObservaciones(''); setMonto('');
    setModal({ tipo });
  };

  const totalActualTipo = modal?.tipo === 'proveedor' ? totalProveedor : totalCliente;
  const totalConNuevo = totalActualTipo + (Number(monto) || 0);

  const guardarCosto = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!opSeleccionada || !modal) return;
    if (!monto && monto !== 0) return alert('Captura el monto de Cargos Adicionales.');
    setGuardando(true);
    try {
      const convNombre = conveniosDelModal.find((c: any) => c.id === convenioSel)?.nombre || '';
      const nuevo = {
        operacionId: opSeleccionada.id,
        operacionRef: opSeleccionada.ref || opSeleccionada.id?.substring(0, 6) || '',
        tipo: modal.tipo,
        convenioId: convenioSel || null,
        convenioNombre: convNombre,
        observaciones: observaciones || '',
        monto: Number(monto) || 0,
        createdAt: new Date().toISOString(),
      };
      const ref = await addDoc(collection(db, 'costos_adicionales'), nuevo);
      const listaNueva = [...costos, { id: ref.id, ...nuevo }];
      setCostos(listaNueva);
      await sincronizarOperacion(opSeleccionada, listaNueva);
      setModal(null);
    } catch (err) {
      console.error('Error al guardar costo adicional:', err);
      alert('No se pudo guardar el costo adicional.');
    }
    setGuardando(false);
  };

  const eliminarCosto = async (costo: any) => {
    if (!opSeleccionada) return;
    if (!window.confirm('¿Eliminar este costo adicional?')) return;
    try {
      await deleteDoc(doc(db, 'costos_adicionales', costo.id));
      const listaNueva = costos.filter(c => c.id !== costo.id);
      setCostos(listaNueva);
      await sincronizarOperacion(opSeleccionada, listaNueva);
    } catch (err) {
      console.error('Error al eliminar costo adicional:', err);
      alert('No se pudo eliminar el costo adicional.');
    }
  };

  // ── Búsqueda de operaciones (sobre las cargadas) ──
  const opsFiltradas = useMemo(() => {
    const b = busqueda.toLowerCase().trim();
    if (!b) return operaciones;
    return operaciones.filter(op =>
      String(op.ref || op.id || '').toLowerCase().includes(b) ||
      String(op.clienteNombre || op.nombreCliente || '').toLowerCase().includes(b) ||
      String(op.proveedorUnidadNombre || '').toLowerCase().includes(b)
    );
  }, [operaciones, busqueda]);

  const labelInput: React.CSSProperties = { color: '#8b949e', fontSize: '0.75rem', fontWeight: 'bold', display: 'block', marginBottom: '6px', textTransform: 'uppercase' };
  const inputStyle: React.CSSProperties = { width: '100%', padding: '10px 12px', backgroundColor: '#161b22', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', boxSizing: 'border-box' };

  const renderPanelCostos = (tipo: 'cliente' | 'proveedor') => {
    const lista = costos.filter(c => c.tipo === tipo);
    const total = tipo === 'cliente' ? totalCliente : totalProveedor;
    const color = tipo === 'cliente' ? '#3fb950' : '#58a6ff';
    return (
      <div className="cad-x1">
        <div className="cad-x2">
          <h3 className="cad-x3">
            Costos Adicionales · <span style={{ color }}>{tipo === 'cliente' ? 'Cliente' : 'Proveedor'}</span>
          </h3>
          <button className="cad-x4" onClick={() => abrirModal(tipo)}>+ Agregar</button>
        </div>
        {cargandoCostos ? (
          <div className="cad-x5">Cargando...</div>
        ) : lista.length === 0 ? (
          <div className="cad-x6">Sin costos adicionales registrados.</div>
        ) : (
          <div className="cad-x7">
            {lista.map(c => (
              <div className="cad-x8" key={c.id}>
                <div className="cad-x9">
                  <div className="cad-x10">{c.convenioNombre || 'Sin convenio'}</div>
                  {c.observaciones && <div className="cad-x11">{c.observaciones}</div>}
                </div>
                <div className="cad-x12">
                  <span style={{ color, fontWeight: 'bold' }}>{formatoMoneda(c.monto)}</span>
                  <button className="cad-x13" onClick={() => eliminarCosto(c)} title="Eliminar">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="cad-x14">
          <span className="cad-x15">Total Costo Adicionales</span>
          <span style={{ color, fontSize: '1.3rem', fontWeight: 'bold' }}>{formatoMoneda(total)}</span>
        </div>
      </div>
    );
  };

  const contenido = (
    <div className="module-container" style={{ padding: comoModal ? '20px 24px 48px' : '24px', animation: 'fadeIn 0.3s ease' }}>
      <h1 className="cad-x16">Costos Adicionales</h1>

      {!opSeleccionada ? (
        <>
          <div className="cad-x17">
            <input type="text" placeholder="Buscar operación (Ref, Cliente, Proveedor)..." value={busqueda} onChange={e => setBusqueda(e.target.value)} style={inputStyle} />
          </div>
          <div className="table-container cad-x18">
            <table className="cad-x19">
              <thead className="cad-x20">
                <tr>
                  <th className="cad-x21">REFERENCIA</th>
                  <th className="cad-x21">FECHA</th>
                  <th className="cad-x21">CLIENTE</th>
                  <th className="cad-x21">PROVEEDOR</th>
                  <th className="cad-x21"></th>
                </tr>
              </thead>
              <tbody>
                {cargandoOps ? (
                  <tr><td className="cad-x22" colSpan={5}>Cargando operaciones...</td></tr>
                ) : opsFiltradas.length === 0 ? (
                  <tr><td className="cad-x22" colSpan={5}>Sin operaciones.</td></tr>
                ) : (
                  opsFiltradas.map(op => (
                    <tr className="cad-x23" key={op.id} onClick={() => seleccionarOperacion(op)}>
                      <td className="cad-x24">{op.ref || op.id?.substring(0, 6)}</td>
                      <td className="cad-x25">{formatearFecha(op.fechaServicio)}</td>
                      <td className="cad-x26">{op.clienteNombre || op.nombreCliente || '-'}</td>
                      <td className="cad-x26">{op.proveedorUnidadNombre || '-'}</td>
                      <td className="cad-x27">
                        <span className="cad-x28">Gestionar →</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {hayMas && !cargandoOps && (
            <div className="cad-x29">
              <button onClick={cargarMas} disabled={cargandoMas} style={{ padding: '8px 16px', backgroundColor: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: cargandoMas ? 'wait' : 'pointer' }}>
                {cargandoMas ? 'Cargando...' : '+ Cargar más (50)'}
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="cad-x30">
            <div>
              <button className="cad-x31" onClick={() => { if (comoModal) { onCerrar?.(); } else { setOpSeleccionada(null); setCostos([]); } }}>{comoModal ? '✕ Cerrar y volver al formulario' : '← Volver a la lista'}</button>
              <div className="cad-x32">
                <span className="cad-x33">{opSeleccionada.ref || opSeleccionada.id?.substring(0, 6)}</span>
                <span className="cad-x34">{opSeleccionada.clienteNombre || opSeleccionada.nombreCliente || '-'}</span>
                <span className="cad-x35">·</span>
                <span className="cad-x36">{opSeleccionada.proveedorUnidadNombre || 'Sin proveedor'}</span>
              </div>
            </div>
            <div className="cad-x37">
              <span className="cad-x38">Utilidad Estimada</span>
              <span style={{ color: Number(opSeleccionada.utilidadEstimada) < 0 ? '#f85149' : '#3fb950', fontSize: '1.2rem', fontWeight: 'bold' }}>{formatoMoneda(opSeleccionada.utilidadEstimada)}</span>
            </div>
          </div>

          <div className="cad-x39">
            {renderPanelCostos('cliente')}
            {renderPanelCostos('proveedor')}
          </div>
        </>
      )}

      {/* MODAL AGREGAR COSTOS ADICIONALES */}
      {modal && (
        <div className="modal-overlay cad-x40">
          <div className="cad-x41">
            <form onSubmit={guardarCosto}>
              <div className="cad-x42">
                <h2 className="cad-x43">
                  Agregar Costos Adicionales <span style={{ color: modal.tipo === 'proveedor' ? '#58a6ff' : '#3fb950', fontSize: '0.9rem' }}>· {modal.tipo === 'proveedor' ? 'Proveedor' : 'Cliente'}</span>
                </h2>
                <div className="cad-x44">
                  <button className="cad-x45" type="button" onClick={() => setModal(null)} disabled={guardando}>Cancelar</button>
                  <button className="cad-x46" type="submit" disabled={guardando}>{guardando ? 'Guardando...' : 'Guardar'}</button>
                </div>
              </div>

              <div className="cad-x47">
                <div>
                  <label style={labelInput}>Convenio</label>
                  <select value={convenioSel} onChange={e => setConvenioSel(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                    <option value="">-- Seleccionar --</option>
                    {conveniosDelModal.map((c: any) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                  {conveniosDelModal.length === 0 && (
                    <span className="cad-x48">
                      {modal.tipo === 'proveedor' ? 'Este proveedor no tiene convenios; puedes dejarlo vacío.' : 'Este cliente no tiene convenios; puedes dejarlo vacío.'}
                    </span>
                  )}
                </div>

                <div>
                  <label style={labelInput}>Observaciones</label>
                  <input type="text" value={observaciones} onChange={e => setObservaciones(e.target.value)} style={inputStyle} />
                </div>

                <div>
                  <label style={labelInput}>Cargos Adicionales</label>
                  <div className="cad-x49">
                    <span className="cad-x50">$</span>
                    <input type="number" step="0.01" value={monto} placeholder="0.00" onChange={e => setMonto(e.target.valueAsNumber || '')} style={{ ...inputStyle, paddingLeft: '26px', color: '#3fb950', fontWeight: 'bold' }} />
                  </div>
                </div>

                <div>
                  <label style={labelInput}>Total Costo Adicionales</label>
                  <div style={{ ...inputStyle, color: '#8b949e', fontWeight: 'bold', display: 'flex', alignItems: 'center' }}>
                    {formatoMoneda(totalConNuevo)}
                  </div>
                  <span className="cad-x48">Actual {formatoMoneda(totalActualTipo)} + nuevo {formatoMoneda(Number(monto) || 0)}</span>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );

  if (comoModal) {
    // Modo modal: overlay a pantalla completa por encima del formulario de operación.
    return (
      <div className="cad-x51">
        {contenido}
      </div>
    );
  }
  return contenido;
};