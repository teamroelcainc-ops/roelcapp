// src/features/pagos/components/PagosDashboard.tsx
// ---------------------------------------------------------------------------
// MÓDULO DE PAGOS (cobranza de clientes y pagos a proveedores).
//   · Un PAGO puede cubrir VARIAS facturas: se seleccionan facturas con status
//     "Facturado" y saldo pendiente, y el monto se APLICA de la más antigua a
//     la más reciente (FIFO). La última puede quedar en pago parcial.
//   · Datos del pago: fecha, método (ACH, transferencia, efectivo, ...),
//     número/referencia, monto, observaciones y comprobante PDF adjunto.
//   · Cada factura guarda su acumulado: montoPagado, saldoPendiente y
//     statusPago (PAGADA / PARCIAL), sin tocar su statusFactura.
//   · Eliminar un pago REVIERTE la aplicación en sus facturas.
// ---------------------------------------------------------------------------
import { useState, useEffect, useMemo } from 'react';
import {
  collection, query, where, getDocs, onSnapshot, writeBatch, doc, arrayUnion, arrayRemove, limit,
} from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../../../config/firebase';
import { useUsuarioStore } from '../../../stores/useUsuarioStore';
import { registrarLog } from '../../../utils/logger';
import { Plus, FileText, Trash2, X, Search } from 'lucide-react';
import './PagosDashboard.css';

type TipoPago = 'cliente' | 'proveedor';

const METODOS_PAGO = ['Transferencia', 'ACH', 'Efectivo', 'Cheque', 'Depósito', 'Tarjeta', 'Otro'];

interface FacturaPagable {
  id: string;
  invoice: string;
  fecha: string;          // ISO o dd/mm — se ordena normalizada
  entidadId: string;
  entidadNombre: string;
  total: number;
  montoPagado: number;
  saldo: number;
  moneda: string;
}

interface FacturaAplicada {
  facturaId: string;
  invoice: string;
  fecha: string;
  total: number;
  saldoAnterior: number;
  aplicado: number;
  saldoNuevo: number;
}

interface PagoDoc {
  id: string;
  tipo: TipoPago;
  numeroPago: string;
  fecha: string;
  metodoPago: string;
  referencia: string;
  entidadNombre: string;
  monto: number;
  moneda: string;
  observaciones?: string;
  pdfUrl?: string;
  pdfNombre?: string;
  facturas: FacturaAplicada[];
  creadoEn?: string;
  creadoPor?: string;
}

const money = (n: number, moneda = '') =>
  `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${moneda ? ` ${moneda}` : ''}`;

// Normaliza fechas dd/mm/aaaa o ISO a una clave ordenable AAAA-MM-DD.
const claveFecha = (f: string): string => {
  const s = String(f || '').trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  return s;
};

const hoyISO = () => new Date().toISOString().slice(0, 10);

export function PagosDashboard() {
  const usuario = useUsuarioStore((s) => s.usuario);

  const [tab, setTab] = useState<TipoPago>('cliente');
  const [pagos, setPagos] = useState<PagoDoc[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [pagoViendo, setPagoViendo] = useState<PagoDoc | null>(null);

  // ── Modal Registrar Pago ──
  const [modalAbierto, setModalAbierto] = useState(false);
  const [facturasPendientes, setFacturasPendientes] = useState<FacturaPagable[]>([]);
  const [cargandoFacturas, setCargandoFacturas] = useState(false);
  const [entidadSel, setEntidadSel] = useState('');       // nombre de la entidad
  const [busquedaEntidad, setBusquedaEntidad] = useState('');
  const [facturasSel, setFacturasSel] = useState<string[]>([]);
  const [fechaPago, setFechaPago] = useState(hoyISO());
  const [metodoPago, setMetodoPago] = useState('Transferencia');
  const [referencia, setReferencia] = useState('');
  const [montoTexto, setMontoTexto] = useState('');
  const [montoEditado, setMontoEditado] = useState(false);
  const [observaciones, setObservaciones] = useState('');
  const [archivoPdf, setArchivoPdf] = useState<File | null>(null);
  const [guardando, setGuardando] = useState(false);

  // ── Lista de pagos del tab activo, en vivo ──
  useEffect(() => {
    const q = query(collection(db, 'pagos'), where('tipo', '==', tab));
    const unsubscribe = onSnapshot(q, (snap) => {
      const lista = snap.docs
        .map((d) => ({ ...(d.data() as Omit<PagoDoc, 'id'>), id: d.id }))
        .sort((a, b) => claveFecha(b.fecha).localeCompare(claveFecha(a.fecha)));
      setPagos(lista);
    });
    return () => unsubscribe();
  }, [tab]);

  const pagosFiltrados = useMemo(() => {
    if (!busqueda.trim()) return pagos;
    const b = busqueda.toLowerCase();
    return pagos.filter((p) =>
      p.entidadNombre?.toLowerCase().includes(b) ||
      p.numeroPago?.toLowerCase().includes(b) ||
      p.referencia?.toLowerCase().includes(b) ||
      p.metodoPago?.toLowerCase().includes(b) ||
      p.facturas?.some((f) => f.invoice?.toLowerCase().includes(b))
    );
  }, [pagos, busqueda]);

  // ── Cargar facturas con saldo pendiente al abrir el modal ──
  const abrirModal = async () => {
    setModalAbierto(true);
    setCargandoFacturas(true);
    setEntidadSel('');
    setBusquedaEntidad('');
    setFacturasSel([]);
    setFechaPago(hoyISO());
    setMetodoPago('Transferencia');
    setReferencia('');
    setMontoTexto('');
    setMontoEditado(false);
    setObservaciones('');
    setArchivoPdf(null);
    try {
      const coleccion = tab === 'cliente' ? 'facturas_clientes' : 'facturas_proveedores';
      const snap = await getDocs(query(
        collection(db, coleccion),
        where('statusFactura', '==', 'Facturado'),
        limit(1000)
      ));
      const lista: FacturaPagable[] = snap.docs.map((d) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- doc de factura sin tipo canónico (mismo criterio que los dashboards de facturación).
        const raw = d.data() as any;
        const total = Number(raw.subtotalFactura) || Number(raw.total) || Number(raw.montoFactura) || 0;
        const pagado = Number(raw.montoPagado) || 0;
        return {
          id: d.id,
          invoice: String(raw.invoice || raw.folio || d.id),
          fecha: String(raw.fecha || raw.fechaFactura || ''),
          entidadId: String((tab === 'cliente' ? raw.clienteId : raw.proveedorId) || ''),
          entidadNombre: String((tab === 'cliente' ? (raw.clienteNombre || raw.cliente) : (raw.proveedorNombre || raw.proveedor)) || 'Sin nombre'),
          total,
          montoPagado: pagado,
          saldo: Math.max(0, total - pagado),
          moneda: String(raw.monedaFacturacion || raw.moneda || ''),
        };
      }).filter((f) => f.total > 0 && f.saldo > 0.009);
      setFacturasPendientes(lista);
    } catch (e) {
      console.error('No se pudieron cargar las facturas pendientes:', e);
      alert('No se pudieron cargar las facturas pendientes.');
    } finally {
      setCargandoFacturas(false);
    }
  };

  // Entidades (clientes/proveedores) con facturas pendientes.
  const entidades = useMemo(() => {
    const mapa = new Map<string, { nombre: string; cuantas: number; saldo: number }>();
    facturasPendientes.forEach((f) => {
      const prev = mapa.get(f.entidadNombre) || { nombre: f.entidadNombre, cuantas: 0, saldo: 0 };
      prev.cuantas += 1;
      prev.saldo += f.saldo;
      mapa.set(f.entidadNombre, prev);
    });
    return Array.from(mapa.values()).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [facturasPendientes]);

  const entidadesFiltradas = useMemo(() => {
    if (!busquedaEntidad.trim()) return entidades;
    const b = busquedaEntidad.toLowerCase();
    return entidades.filter((e) => e.nombre.toLowerCase().includes(b));
  }, [entidades, busquedaEntidad]);

  // Facturas de la entidad elegida, de la MÁS ANTIGUA a la más reciente.
  const facturasDeEntidad = useMemo(() =>
    facturasPendientes
      .filter((f) => f.entidadNombre === entidadSel)
      .sort((a, b) => claveFecha(a.fecha).localeCompare(claveFecha(b.fecha))),
  [facturasPendientes, entidadSel]);

  const seleccionadasOrdenadas = useMemo(() =>
    facturasDeEntidad.filter((f) => facturasSel.includes(f.id)),
  [facturasDeEntidad, facturasSel]);

  const sumaSaldosSel = useMemo(() =>
    seleccionadasOrdenadas.reduce((s, f) => s + f.saldo, 0),
  [seleccionadasOrdenadas]);

  const monedasSel = useMemo(() =>
    Array.from(new Set(seleccionadasOrdenadas.map((f) => f.moneda).filter(Boolean))),
  [seleccionadasOrdenadas]);

  // Monto por defecto = suma de saldos (si el usuario no lo ha editado a mano).
  useEffect(() => {
    if (!montoEditado) setMontoTexto(sumaSaldosSel > 0 ? sumaSaldosSel.toFixed(2) : '');
  }, [sumaSaldosSel, montoEditado]);

  const monto = Number(montoTexto) || 0;

  // ✅ DISTRIBUCIÓN FIFO en vivo (más antigua → más reciente).
  const aplicacion = useMemo<FacturaAplicada[]>(() => {
    let restante = monto;
    return seleccionadasOrdenadas.map((f) => {
      const aplicado = Math.max(0, Math.min(f.saldo, restante));
      restante = Math.max(0, restante - aplicado);
      return {
        facturaId: f.id,
        invoice: f.invoice,
        fecha: f.fecha,
        total: f.total,
        saldoAnterior: f.saldo,
        aplicado,
        saldoNuevo: Math.max(0, f.saldo - aplicado),
      };
    });
  }, [seleccionadasOrdenadas, monto]);

  const toggleFactura = (id: string) => {
    setFacturasSel((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const toggleTodas = () => {
    const todas = facturasDeEntidad.every((f) => facturasSel.includes(f.id));
    setFacturasSel(todas ? [] : facturasDeEntidad.map((f) => f.id));
  };

  // ── Guardar el pago ──
  const guardarPago = async () => {
    if (!usuario) return;
    if (seleccionadasOrdenadas.length === 0) { alert('Selecciona al menos una factura.'); return; }
    if (monto <= 0) { alert('Captura el monto del pago.'); return; }
    if (monto > sumaSaldosSel + 0.009) {
      alert(`El monto (${money(monto)}) es MAYOR que la suma de los saldos seleccionados (${money(sumaSaldosSel)}). Ajusta el monto o selecciona más facturas.`);
      return;
    }
    if (monedasSel.length > 1) {
      alert(`Las facturas seleccionadas tienen monedas distintas (${monedasSel.join(', ')}). Un pago solo puede cubrir facturas de la misma moneda.`);
      return;
    }
    if (!fechaPago) { alert('Captura la fecha del pago.'); return; }

    setGuardando(true);
    try {
      const pagoRef = doc(collection(db, 'pagos'));

      // Comprobante PDF (opcional): se sube ANTES del batch.
      let pdfUrl = '';
      let pdfNombre = '';
      if (archivoPdf) {
        const destino = storageRef(storage, `pagos/${pagoRef.id}/${archivoPdf.name}`);
        await uploadBytes(destino, archivoPdf);
        pdfUrl = await getDownloadURL(destino);
        pdfNombre = archivoPdf.name;
      }

      const d = new Date();
      const numeroPago = referencia.trim() || `PAGO-${String(d.getDate()).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}${d.getFullYear()}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;

      const batch = writeBatch(db);
      batch.set(pagoRef, {
        tipo: tab,
        numeroPago,
        fecha: fechaPago,
        metodoPago,
        referencia: referencia.trim(),
        entidadId: seleccionadasOrdenadas[0]?.entidadId || '',
        entidadNombre: entidadSel,
        monto,
        moneda: monedasSel[0] || '',
        observaciones: observaciones.trim(),
        pdfUrl,
        pdfNombre,
        facturas: aplicacion,
        creadoEn: new Date().toISOString(),
        creadoPor: usuario.nombre || usuario.email || usuario.id,
      });

      const coleccion = tab === 'cliente' ? 'facturas_clientes' : 'facturas_proveedores';
      aplicacion.forEach((a) => {
        if (a.aplicado <= 0) return;
        const fact = seleccionadasOrdenadas.find((f) => f.id === a.facturaId);
        const pagadoNuevo = (fact?.montoPagado || 0) + a.aplicado;
        batch.set(doc(db, coleccion, a.facturaId), {
          montoPagado: pagadoNuevo,
          saldoPendiente: a.saldoNuevo,
          statusPago: a.saldoNuevo <= 0.009 ? 'PAGADA' : 'PARCIAL',
          pagosIds: arrayUnion(pagoRef.id),
        }, { merge: true });
      });

      await batch.commit();
      registrarLog('Pagos', 'Creación', `Registró el pago ${numeroPago} (${money(monto, monedasSel[0])}) de ${entidadSel} cubriendo ${aplicacion.filter(a => a.aplicado > 0).length} factura(s).`).catch(() => {});
      setModalAbierto(false);
    } catch (e) {
      console.error('No se pudo guardar el pago:', e);
      alert('No se pudo guardar el pago. Intenta de nuevo.');
    } finally {
      setGuardando(false);
    }
  };

  // ── Eliminar pago: revierte la aplicación en sus facturas ──
  const eliminarPago = async (p: PagoDoc) => {
    if (!window.confirm(`¿Eliminar el pago ${p.numeroPago} de ${p.entidadNombre} por ${money(p.monto, p.moneda)}?\n\nSe REVERTIRÁ lo aplicado en sus ${p.facturas?.length || 0} factura(s).`)) return;
    try {
      // Leer el estado ACTUAL de cada factura para revertir sobre lo vigente.
      const coleccion = p.tipo === 'cliente' ? 'facturas_clientes' : 'facturas_proveedores';
      const batch = writeBatch(db);
      for (const a of (p.facturas || [])) {
        if (a.aplicado <= 0) continue;
        const snap = await getDocs(query(collection(db, coleccion), where('__name__', '==', a.facturaId), limit(1)));
        if (snap.empty) continue;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- doc de factura sin tipo canónico.
        const raw = snap.docs[0].data() as any;
        const total = Number(raw.subtotalFactura) || Number(raw.total) || Number(raw.montoFactura) || 0;
        const pagadoNuevo = Math.max(0, (Number(raw.montoPagado) || 0) - a.aplicado);
        const saldoNuevo = Math.max(0, total - pagadoNuevo);
        batch.set(doc(db, coleccion, a.facturaId), {
          montoPagado: pagadoNuevo,
          saldoPendiente: saldoNuevo,
          statusPago: pagadoNuevo <= 0.009 ? '' : (saldoNuevo <= 0.009 ? 'PAGADA' : 'PARCIAL'),
          pagosIds: arrayRemove(p.id),
        }, { merge: true });
      }
      batch.delete(doc(db, 'pagos', p.id));
      await batch.commit();
      registrarLog('Pagos', 'Eliminación', `Eliminó el pago ${p.numeroPago} de ${p.entidadNombre} (${money(p.monto, p.moneda)}) y revirtió su aplicación.`).catch(() => {});
      setPagoViendo(null);
    } catch (e) {
      console.error('No se pudo eliminar el pago:', e);
      alert('No se pudo eliminar el pago. Intenta de nuevo.');
    }
  };

  // ────────────────────────────── RENDER ──────────────────────────────
  return (
    <div className="pg-contenedor">
      <div className="pg-encabezado">
        <h1 className="pg-titulo">Pagos</h1>
        <button className="pg-btn-nuevo" onClick={abrirModal}>
          <Plus size={16} /> Registrar Pago
        </button>
      </div>

      <div className="pg-tabs">
        <button className={`pg-tab${tab === 'cliente' ? ' activa' : ''}`} onClick={() => setTab('cliente')}>Pagos de Clientes</button>
        <button className={`pg-tab${tab === 'proveedor' ? ' activa' : ''}`} onClick={() => setTab('proveedor')}>Pagos a Proveedores</button>
      </div>

      <div className="pg-buscador">
        <Search size={15} />
        <input
          type="text"
          placeholder="Buscar por cliente/proveedor, número, referencia o factura..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
      </div>

      {/* ✅ Resumen del listado (conteo y total por moneda) */}
      {pagosFiltrados.length > 0 && (
        <div className="pg-resumen">
          <span className="pg-resumen-item"><strong>{pagosFiltrados.length}</strong> pago(s)</span>
          {Object.entries(pagosFiltrados.reduce((acc: Record<string, number>, p) => {
            const k = p.moneda || 'S/M';
            acc[k] = (acc[k] || 0) + (Number(p.monto) || 0);
            return acc;
          }, {})).map(([mon, tot]) => (
            <span className="pg-resumen-item" key={mon}>Total <strong>{money(tot, mon === 'S/M' ? '' : mon)}</strong></span>
          ))}
        </div>
      )}

      <div className="pg-tabla-marco">
        <table className="pg-tabla">
          <thead>
            <tr>
              <th>ACCIONES</th>
              <th>FECHA</th>
              <th># PAGO</th>
              <th>{tab === 'cliente' ? 'CLIENTE' : 'PROVEEDOR'}</th>
              <th>MÉTODO</th>
              <th>MONTO</th>
              <th>FACTURAS</th>
              <th>COMPROBANTE</th>
            </tr>
          </thead>
          <tbody>
            {pagosFiltrados.length === 0 ? (
              <tr><td colSpan={8} className="pg-vacio">{busqueda ? 'Sin resultados.' : 'Aún no hay pagos registrados.'}</td></tr>
            ) : pagosFiltrados.map((p) => (
              <tr key={p.id} className="pg-fila" onClick={() => setPagoViendo(p)} title="Ver detalle del pago">
                <td onClick={(e) => e.stopPropagation()}>
                  <button className="pg-btn-borrar" onClick={() => eliminarPago(p)} title="Eliminar pago (revierte su aplicación)">
                    <Trash2 size={14} />
                  </button>
                </td>
                <td className="pg-fecha">{p.fecha}</td>
                <td className="pg-numero">{p.numeroPago}</td>
                <td className="pg-entidad">{p.entidadNombre}</td>
                <td>{p.metodoPago}</td>
                <td className="pg-monto">{money(p.monto, p.moneda)}</td>
                <td>
                  <div className="pg-chips">
                    {(p.facturas || []).filter(f => f.aplicado > 0).map((f) => (
                      <span className="pg-chip" key={f.facturaId} title={`Aplicado ${money(f.aplicado)} · Saldo ${money(f.saldoNuevo)}`}>
                        {f.invoice}{f.saldoNuevo > 0.009 ? ' (parcial)' : ''}
                      </span>
                    ))}
                  </div>
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  {p.pdfUrl
                    ? <a className="pg-pdf" href={p.pdfUrl} target="_blank" rel="noopener noreferrer"><FileText size={14} /> Ver</a>
                    : <span className="pg-sin-pdf">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ══════════ FICHA DEL PAGO ══════════ */}
      {pagoViendo && (
        <div className="pg-overlay" onClick={() => setPagoViendo(null)}>
          <div className="pg-modal pg-ficha" onClick={(e) => e.stopPropagation()}>
            <div className="pg-modal-encabezado">
              <h3>Pago {pagoViendo.numeroPago}</h3>
              <button className="pg-cerrar" onClick={() => setPagoViendo(null)}><X size={16} /></button>
            </div>
            <div className="pg-modal-cuerpo">
              <div className="pg-ficha-grid">
                <div><span className="pg-etq">Fecha</span><span>{pagoViendo.fecha}</span></div>
                <div><span className="pg-etq">{pagoViendo.tipo === 'cliente' ? 'Cliente' : 'Proveedor'}</span><span>{pagoViendo.entidadNombre}</span></div>
                <div><span className="pg-etq">Método</span><span>{pagoViendo.metodoPago}</span></div>
                <div><span className="pg-etq">Referencia</span><span>{pagoViendo.referencia || '—'}</span></div>
                <div><span className="pg-etq">Monto</span><span className="pg-monto">{money(pagoViendo.monto, pagoViendo.moneda)}</span></div>
                <div><span className="pg-etq">Registró</span><span>{pagoViendo.creadoPor || '—'}</span></div>
              </div>
              {pagoViendo.observaciones && <p className="pg-obs">{pagoViendo.observaciones}</p>}
              {pagoViendo.pdfUrl && (
                <a className="pg-pdf" href={pagoViendo.pdfUrl} target="_blank" rel="noopener noreferrer">
                  <FileText size={14} /> {pagoViendo.pdfNombre || 'Ver comprobante'}
                </a>
              )}
              <table className="pg-tabla pg-tabla-aplicacion">
                <thead>
                  <tr><th>FACTURA</th><th>FECHA</th><th>TOTAL</th><th>APLICADO</th><th>SALDO RESULTANTE</th></tr>
                </thead>
                <tbody>
                  {(pagoViendo.facturas || []).map((f) => (
                    <tr key={f.facturaId}>
                      <td className="pg-numero">{f.invoice}</td>
                      <td>{f.fecha}</td>
                      <td>{money(f.total)}</td>
                      <td className="pg-monto">{money(f.aplicado)}</td>
                      <td className={f.saldoNuevo > 0.009 ? 'pg-parcial' : 'pg-pagada'}>
                        {f.saldoNuevo > 0.009 ? money(f.saldoNuevo) : 'PAGADA'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pg-modal-pie">
              <button className="pg-btn-secundario" onClick={() => setPagoViendo(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════ MODAL REGISTRAR PAGO ══════════ */}
      {modalAbierto && (
        <div className="pg-overlay">
          <div className="pg-modal pg-modal-registro">
            <div className="pg-modal-encabezado">
              <h3>Registrar Pago · {tab === 'cliente' ? 'Cliente' : 'Proveedor'}</h3>
              <button className="pg-cerrar" onClick={() => setModalAbierto(false)}><X size={16} /></button>
            </div>

            <div className="pg-modal-cuerpo">
              {cargandoFacturas ? (
                <p className="pg-vacio">Cargando facturas pendientes…</p>
              ) : !entidadSel ? (
                <>
                  {/* PASO 1: elegir cliente/proveedor con facturas pendientes */}
                  <label className="pg-etq">1. Elige {tab === 'cliente' ? 'el cliente' : 'el proveedor'} (solo aparecen los que tienen facturas con saldo)</label>
                  <div className="pg-buscador">
                    <Search size={15} />
                    <input
                      type="text"
                      placeholder="Buscar por nombre..."
                      value={busquedaEntidad}
                      onChange={(e) => setBusquedaEntidad(e.target.value)}
                      autoFocus
                    />
                  </div>
                  {entidadesFiltradas.length === 0 ? (
                    <p className="pg-vacio">No hay facturas con saldo pendiente{busquedaEntidad ? ' para esa búsqueda' : ''}.</p>
                  ) : (
                    <ul className="pg-lista-entidades">
                      {entidadesFiltradas.map((e) => (
                        <li key={e.nombre}>
                          <button onClick={() => { setEntidadSel(e.nombre); setFacturasSel([]); }}>
                            <span className="pg-entidad">{e.nombre}</span>
                            <span className="pg-entidad-info">{e.cuantas} factura(s) · saldo {money(e.saldo)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <>
                  {/* PASO 2: seleccionar facturas (de la más antigua a la más reciente) */}
                  <div className="pg-paso2-encabezado">
                    <span className="pg-entidad">{entidadSel}</span>
                    <button className="pg-btn-liga" onClick={() => { setEntidadSel(''); setFacturasSel([]); }}>Cambiar</button>
                  </div>

                  {/* ✅ Dos columnas en escritorio: facturas | datos + aplicación
                      (evita el scroll vertical del modal). */}
                  <div className="pg-registro-cols">
                  <div className="pg-registro-col">
                  <label className="pg-etq">2. Selecciona las facturas a pagar (el pago se aplica de la más antigua a la más reciente)</label>
                  <div className="pg-tabla-marco pg-tabla-scroll pg-tabla-facturas">
                    <table className="pg-tabla">
                      <thead>
                        <tr>
                          <th className="pg-col-check">
                            <input type="checkbox" checked={facturasDeEntidad.length > 0 && facturasDeEntidad.every(f => facturasSel.includes(f.id))} onChange={toggleTodas} title="Seleccionar todas" />
                          </th>
                          <th>FACTURA</th><th>FECHA</th><th>TOTAL</th><th>PAGADO</th><th>SALDO</th><th>MONEDA</th>
                        </tr>
                      </thead>
                      <tbody>
                        {facturasDeEntidad.map((f) => (
                          <tr key={f.id} className="pg-fila" onClick={() => toggleFactura(f.id)}>
                            <td className="pg-col-check" onClick={(e) => e.stopPropagation()}>
                              <input type="checkbox" checked={facturasSel.includes(f.id)} onChange={() => toggleFactura(f.id)} />
                            </td>
                            <td className="pg-numero">{f.invoice}</td>
                            <td>{f.fecha}</td>
                            <td>{money(f.total)}</td>
                            <td>{f.montoPagado > 0 ? money(f.montoPagado) : '—'}</td>
                            <td className="pg-monto">{money(f.saldo)}</td>
                            <td>{f.moneda || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  </div>

                  <div className="pg-registro-col">
                  {/* PASO 3: datos del pago */}
                  <label className="pg-etq">3. Datos del pago</label>
                  <div className="pg-datos-grid">
                    <div className="pg-campo">
                      <label>Fecha</label>
                      <input type="date" value={fechaPago} onChange={(e) => setFechaPago(e.target.value)} />
                    </div>
                    <div className="pg-campo">
                      <label>Método de pago</label>
                      <select value={metodoPago} onChange={(e) => setMetodoPago(e.target.value)}>
                        {METODOS_PAGO.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                    <div className="pg-campo">
                      <label># de pago / referencia</label>
                      <input type="text" placeholder="Cheque, folio, rastreo..." value={referencia} onChange={(e) => setReferencia(e.target.value)} />
                    </div>
                    <div className="pg-campo">
                      <label>Monto del pago {monedasSel[0] ? `(${monedasSel[0]})` : ''}</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={montoTexto}
                        onChange={(e) => { setMontoTexto(e.target.value); setMontoEditado(true); }}
                      />
                      {/* ✅ El pago puede ser PARCIAL: basta capturar un monto menor. */}
                      <small className="pg-pista">Puede ser <b>parcial</b>: captura un monto menor y se aplicará de la factura más antigua a la más reciente.</small>
                      {monto > 0 && monto < sumaSaldosSel - 0.009 && (
                        <small className="pg-pista-parcial">Pago parcial: cubre {money(monto, monedasSel[0])} de {money(sumaSaldosSel, monedasSel[0])} — quedará pendiente {money(sumaSaldosSel - monto, monedasSel[0])}.</small>
                      )}
                    </div>
                    <div className="pg-campo pg-campo-ancho">
                      <label>Comprobante (PDF o imagen, opcional)</label>
                      <input type="file" accept="application/pdf,image/*" onChange={(e) => setArchivoPdf(e.target.files?.[0] || null)} />
                    </div>
                    <div className="pg-campo pg-campo-ancho">
                      <label>Observaciones</label>
                      <input type="text" value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
                    </div>
                  </div>

                  {monedasSel.length > 1 && (
                    <div className="pg-alerta">Las facturas seleccionadas mezclan monedas ({monedasSel.join(', ')}). Un pago solo puede cubrir facturas de la misma moneda.</div>
                  )}

                  {/* PASO 4: previsualización de la aplicación FIFO */}
                  {seleccionadasOrdenadas.length > 0 && (
                    <>
                      <label className="pg-etq">4. Así se aplicará el pago ({money(monto, monedasSel[0])} de {money(sumaSaldosSel, monedasSel[0])} seleccionado)</label>
                      <div className="pg-tabla-marco">
                        <table className="pg-tabla pg-tabla-aplicacion">
                          <thead>
                            <tr><th>ORDEN</th><th>FACTURA</th><th>FECHA</th><th>SALDO</th><th>SE APLICA</th><th>QUEDA</th></tr>
                          </thead>
                          <tbody>
                            {aplicacion.map((a, i) => (
                              <tr key={a.facturaId}>
                                <td>{i + 1}</td>
                                <td className="pg-numero">{a.invoice}</td>
                                <td>{a.fecha}</td>
                                <td>{money(a.saldoAnterior)}</td>
                                <td className="pg-monto">{a.aplicado > 0 ? money(a.aplicado) : '—'}</td>
                                <td className={a.saldoNuevo > 0.009 ? 'pg-parcial' : 'pg-pagada'}>
                                  {a.aplicado <= 0 ? 'Sin aplicar' : (a.saldoNuevo > 0.009 ? `${money(a.saldoNuevo)} (parcial)` : 'PAGADA')}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                  </div>
                  </div>
                </>
              )}
            </div>

            <div className="pg-modal-pie">
              <button className="pg-btn-secundario" onClick={() => setModalAbierto(false)} disabled={guardando}>Cancelar</button>
              {entidadSel && (
                <button className="pg-btn-primario" onClick={guardarPago} disabled={guardando || seleccionadasOrdenadas.length === 0}>
                  {guardando ? 'Guardando…' : 'Guardar Pago'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PagosDashboard;
