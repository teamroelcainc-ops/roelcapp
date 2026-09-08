// src/features/tarifarioClientes/components/TarifarioClientesDashboard.tsx
// ---------------------------------------------------------------------------
// ✅ V00191 — TARIFARIO CLIENTES (módulo nuevo).
//   Captura: Fecha, Cliente que Paga, Moneda del cliente y Crédito — moneda y
//   crédito vienen DIRECTO de la tabla Empresas y NO son editables aquí.
//   El botón "Pre convenios" abre un modal con las TARIFAS DE REFERENCIA
//   (catalogo_tarifas_referencia): descripción + costos sugeridos
//   (tarifa_cliente_1/2/3). Con un check se eligen las tarifas que conforman
//   el pre convenio y al Guardar se crea el registro en `tarifario_clientes`
//   con status "Pendiente".
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, getDocs, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db, auth } from '../../../config/firebase';
import { registrarLog } from '../../../utils/logger';
import { hoyLocalISO } from '../../../utils/fechaHoraLocal';
import './TarifarioClientesDashboard.css';

const ID_USD = '7dca62b3';
const ID_MXN = 'f95d8894';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- docs sin tipo canónico (mismo criterio de otros módulos).
type Doc = any;

/** Canoniza cualquier representación de moneda (id de catálogo o nombre) a USD/MXN. */
const canonMoneda = (v: unknown): 'USD' | 'MXN' | '' => {
  const t = String(v ?? '').trim();
  if (!t) return '';
  if (t === ID_USD) return 'USD';
  if (t === ID_MXN) return 'MXN';
  const u = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  if (u.includes('USD') || u.includes('DOLAR') || u === 'US$' || u === 'DLS') return 'USD';
  if (u.includes('MXN') || u.includes('PESO') || u === 'MN') return 'MXN';
  return '';
};

const fmtMoney = (n: number): string =>
  `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Costos sugeridos (> 0) de una tarifa de referencia. */
const costosDe = (t: Doc): number[] =>
  [t.tarifa_cliente_1, t.tarifa_cliente_2, t.tarifa_cliente_3].map((v) => Number(v) || 0).filter((v) => v > 0);

const norm = (t: unknown): string =>
  String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function TarifarioClientesDashboard() {
  // ── Catálogos ──
  const [empresas, setEmpresas] = useState<Doc[]>([]);
  const [tiposEmpresaCat, setTiposEmpresaCat] = useState<Record<string, string>>({});
  const [tarifasRef, setTarifasRef] = useState<Doc[]>([]);
  const [cargandoCat, setCargandoCat] = useState(true);

  // ── Captura ──
  const [fecha, setFecha] = useState(hoyLocalISO());
  const [busquedaCliente, setBusquedaCliente] = useState('');
  const [sugerenciasAbiertas, setSugerenciasAbiertas] = useState(false);
  const [clienteSel, setClienteSel] = useState<Doc | null>(null);

  // ── Modal Pre convenios ──
  const [modalAbierto, setModalAbierto] = useState(false);
  const [busquedaTarifa, setBusquedaTarifa] = useState('');
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [guardando, setGuardando] = useState(false);

  // ── Pre convenios guardados ──
  const [registros, setRegistros] = useState<Doc[]>([]);
  const [filaAbierta, setFilaAbierta] = useState('');

  useEffect(() => {
    let activo = true;
    (async () => {
      try {
        const [eSnap, tSnap, trSnap] = await Promise.all([
          getDocs(collection(db, 'empresas')),
          getDocs(collection(db, 'catalogo_tipo_empresa')),
          getDocs(collection(db, 'catalogo_tarifas_referencia')),
        ]);
        if (!activo) return;
        setEmpresas(eSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        const tipos: Record<string, string> = {};
        tSnap.docs.forEach((d) => { tipos[d.id] = String((d.data() as Doc).nombre || ''); });
        setTiposEmpresaCat(tipos);
        setTarifasRef(
          trSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
            .sort((a: Doc, b: Doc) => String(a.descripcion || '').localeCompare(String(b.descripcion || ''), 'es', { sensitivity: 'base' }))
        );
      } catch (e) {
        console.error('No se pudieron cargar los catálogos del tarifario:', e);
      } finally {
        if (activo) setCargandoCat(false);
      }
    })();

    const unsub = onSnapshot(
      query(collection(db, 'tarifario_clientes'), orderBy('createdAt', 'desc'), limit(200)),
      (snap) => setRegistros(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setRegistros([])
    );
    return () => { activo = false; unsub(); };
  }, []);

  /** Etiquetas de tipo de la empresa (tiposEmpresa guarda ids del catálogo). */
  const tiposDe = (emp: Doc): string[] => {
    const crudos: unknown[] = Array.isArray(emp?.tiposEmpresa) ? emp.tiposEmpresa : (emp?.tiposEmpresa ? [emp.tiposEmpresa] : []);
    return crudos.map((t) => tiposEmpresaCat[String(t)] || String(t)).filter(Boolean);
  };

  // Sugerencias del buscador de cliente — las empresas tipo "Cliente (Paga)"
  // van primero, pero todas son elegibles.
  const sugerencias = useMemo(() => {
    const b = norm(busquedaCliente);
    if (b.length < 2) return [];
    const coincide = empresas.filter((e) =>
      norm(e.nombre).includes(b) || norm(e.nombreCorto).includes(b)
    );
    const esPaga = (e: Doc) => tiposDe(e).some((t) => norm(t).includes('paga'));
    return coincide
      .sort((a, b2) => (Number(esPaga(b2)) - Number(esPaga(a))) || String(a.nombre || '').localeCompare(String(b2.nombre || ''), 'es', { sensitivity: 'base' }))
      .slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busquedaCliente, empresas, tiposEmpresaCat]);

  // Moneda y crédito — solo lectura, directo de Empresas.
  const monedaCliente = clienteSel ? (canonMoneda(clienteSel.moneda) || canonMoneda(clienteSel.monedaId) || canonMoneda(clienteSel.monedaNombre)) : '';
  const etiquetaMoneda = monedaCliente === 'USD' ? 'USD — Dólares' : monedaCliente === 'MXN' ? 'MXN — Pesos' : '';
  const creditoDias = Number(clienteSel?.diasCredito) || 0;
  const limiteCredito = Number(clienteSel?.limiteCredito) || 0;
  const etiquetaCredito = clienteSel
    ? `${creditoDias > 0 ? `${creditoDias} día(s)` : 'Sin días de crédito'}${limiteCredito > 0 ? ` · Límite ${fmtMoney(limiteCredito)}` : ''}`
    : '';

  const elegirCliente = (emp: Doc) => {
    setClienteSel(emp);
    setBusquedaCliente(String(emp.nombre || ''));
    setSugerenciasAbiertas(false);
  };

  const tarifasVisibles = useMemo(() => {
    const b = norm(busquedaTarifa);
    if (!b) return tarifasRef;
    return tarifasRef.filter((t) =>
      norm(t.descripcion).includes(b) || norm(t.origen).includes(b) || norm(t.destino).includes(b)
    );
  }, [tarifasRef, busquedaTarifa]);

  const toggleTarifa = (id: string) =>
    setSeleccion((prev) => { const s = new Set(prev); if (s.has(id)) s.delete(id); else s.add(id); return s; });

  const guardarPreConvenio = async () => {
    if (!clienteSel || seleccion.size === 0 || guardando) return;
    setGuardando(true);
    try {
      const elegidas = tarifasRef.filter((t) => seleccion.has(t.id));
      await addDoc(collection(db, 'tarifario_clientes'), {
        fecha,
        clienteId: String(clienteSel.id),
        clienteNombre: String(clienteSel.nombre || ''),
        clienteNombreCorto: String(clienteSel.nombreCorto || ''),
        moneda: monedaCliente,
        monedaNombre: etiquetaMoneda,
        creditoDias,
        limiteCredito,
        tarifas: elegidas.map((t) => ({
          tarifaReferenciaId: String(t.id),
          descripcion: String(t.descripcion || ''),
          origen: String(t.origen || ''),
          destino: String(t.destino || ''),
          costosSugeridos: costosDe(t),
          status: 'Pendiente',
        })),
        status: 'Pendiente',
        createdAt: new Date().toISOString(),
        creadoPor: auth.currentUser?.email || '',
      });
      await registrarLog('Tarifario Clientes', 'Creación', `Creó un pre convenio de "${clienteSel.nombre}" con ${elegidas.length} tarifa(s) (status Pendiente).`);
      setModalAbierto(false);
      setSeleccion(new Set());
      setBusquedaTarifa('');
    } catch (e) {
      console.error('No se pudo guardar el pre convenio:', e);
      alert('No se pudo guardar el pre convenio.');
    } finally {
      setGuardando(false);
    }
  };

  const eliminarRegistro = async (r: Doc) => {
    if (!window.confirm(`¿Eliminar el pre convenio de "${r.clienteNombre}" del ${r.fecha}?`)) return;
    try {
      await deleteDoc(doc(db, 'tarifario_clientes', r.id));
      await registrarLog('Tarifario Clientes', 'Eliminación', `Eliminó el pre convenio de "${r.clienteNombre}" (${r.fecha}).`);
    } catch (e) {
      console.error('No se pudo eliminar el pre convenio:', e);
      alert('No se pudo eliminar el pre convenio.');
    }
  };

  return (
    <div className="tc-contenedor">
      <div className="tc-encabezado">
        <h1 className="tc-titulo">Tarifario Clientes</h1>
        <p className="tc-sub">Captura el pre convenio del cliente a partir de las Tarifas de Referencia. La moneda y el crédito vienen de la tabla Empresas y no se editan aquí.</p>
      </div>

      {/* ── CAPTURA ── */}
      <div className="tc-captura">
        <div className="tc-campo">
          <label className="tc-label">Fecha</label>
          <input type="date" className="form-control" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>

        <div className="tc-campo tc-campo-cliente">
          <label className="tc-label">Cliente que Paga</label>
          <input
            type="text"
            className="form-control"
            placeholder={cargandoCat ? 'Cargando empresas…' : 'Buscar cliente…'}
            value={busquedaCliente}
            disabled={cargandoCat}
            onChange={(e) => { setBusquedaCliente(e.target.value); setClienteSel(null); setSugerenciasAbiertas(true); }}
            onFocus={() => setSugerenciasAbiertas(true)}
          />
          {sugerenciasAbiertas && sugerencias.length > 0 && !clienteSel && (
            <div className="tc-sugerencias">
              {sugerencias.map((emp) => (
                <button key={emp.id} type="button" className="tc-sugerencia" onClick={() => elegirCliente(emp)}>
                  <span className="tc-sug-nombre">{emp.nombre}</span>
                  <span className="tc-sug-tipo">{emp.numeroCliente ? `${emp.numeroCliente} · ` : ''}{tiposDe(emp).join(' · ') || 'Sin tipo'}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="tc-campo">
          <label className="tc-label">Moneda del Cliente</label>
          <input type="text" className="form-control tc-solo-lectura" value={clienteSel ? (etiquetaMoneda || 'SIN MONEDA en Empresas') : ''} placeholder="—" readOnly disabled />
        </div>

        <div className="tc-campo">
          <label className="tc-label">Crédito</label>
          <input type="text" className="form-control tc-solo-lectura" value={etiquetaCredito} placeholder="—" readOnly disabled />
        </div>

        <div className="tc-campo tc-campo-boton">
          <button
            type="button"
            className="tc-btn-preconvenio"
            disabled={!clienteSel}
            title={clienteSel ? 'Elegir las tarifas de referencia que conforman el pre convenio' : 'Primero elige el cliente'}
            onClick={() => { setModalAbierto(true); setBusquedaTarifa(''); }}
          >
            Pre convenios
          </button>
        </div>
      </div>

      {/* ── PRE CONVENIOS GUARDADOS ── */}
      <div className="tc-lista">
        <h2 className="tc-subtitulo">Pre convenios capturados</h2>
        {registros.length === 0 ? (
          <p className="tc-vacio">Aún no hay pre convenios capturados.</p>
        ) : (
          <div className="tc-marco">
            <table className="tc-tabla">
              <thead>
                <tr><th></th><th>FECHA</th><th>CLIENTE</th><th>MONEDA</th><th>CRÉDITO</th><th>TARIFAS</th><th>STATUS</th><th></th></tr>
              </thead>
              <tbody>
                {registros.map((r) => (
                  <>
                    <tr key={r.id}>
                      <td className="tc-td-toggle">
                        <button type="button" className="tc-toggle" onClick={() => setFilaAbierta(filaAbierta === r.id ? '' : r.id)} title={filaAbierta === r.id ? 'Contraer' : 'Ver las tarifas'}>
                          {filaAbierta === r.id ? '▾' : '▸'}
                        </button>
                      </td>
                      <td>{r.fecha || '—'}</td>
                      <td className="tc-td-cliente">{r.clienteNombre || '—'}</td>
                      <td>{r.moneda ? <span className={`tc-chip ${r.moneda === 'USD' ? 'tc-chip-usd' : 'tc-chip-mxn'}`}>{r.moneda}</span> : '—'}</td>
                      <td>{r.creditoDias > 0 ? `${r.creditoDias} día(s)` : '—'}</td>
                      <td className="tc-td-num">{Array.isArray(r.tarifas) ? r.tarifas.length : 0}</td>
                      <td><span className={`tc-chip ${String(r.status) === 'Pendiente' ? 'tc-chip-pendiente' : 'tc-chip-otro'}`}>{r.status || '—'}</span></td>
                      <td className="tc-td-acciones">
                        <button type="button" className="tc-btn-eliminar" title="Eliminar este pre convenio" onClick={() => eliminarRegistro(r)}>🗑</button>
                      </td>
                    </tr>
                    {filaAbierta === r.id && (
                      <tr key={`${r.id}-det`} className="tc-fila-detalle">
                        <td colSpan={8}>
                          <table className="tc-tabla-interna">
                            <thead>
                              <tr><th>DESCRIPCIÓN</th><th>ORIGEN</th><th>DESTINO</th><th>COSTOS SUGERIDOS</th><th>STATUS</th></tr>
                            </thead>
                            <tbody>
                              {(r.tarifas || []).map((t: Doc, i: number) => (
                                <tr key={`${r.id}-${i}`}>
                                  <td>{t.descripcion || '—'}</td>
                                  <td>{t.origen || '—'}</td>
                                  <td>{t.destino || '—'}</td>
                                  <td className="tc-td-num">{(t.costosSugeridos || []).length > 0 ? (t.costosSugeridos as number[]).map(fmtMoney).join(' · ') : '—'}</td>
                                  <td><span className="tc-chip tc-chip-pendiente">{t.status || 'Pendiente'}</span></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── MODAL PRE CONVENIOS ── */}
      {modalAbierto && clienteSel && (
        <div className="modal-overlay tc-overlay" onClick={() => !guardando && setModalAbierto(false)}>
          <div className="tc-modal" onClick={(e) => e.stopPropagation()}>
            <div className="tc-modal-encabezado">
              <div>
                <h3 className="tc-modal-titulo">Pre convenio — <span className="tc-td-cliente">{clienteSel.nombre}</span></h3>
                <p className="tc-modal-sub">
                  Marca las tarifas de referencia que conforman el pre convenio. Se guardará con status <b>Pendiente</b>.
                  {etiquetaMoneda && <> Moneda del cliente: <span className={`tc-chip ${monedaCliente === 'USD' ? 'tc-chip-usd' : 'tc-chip-mxn'}`}>{monedaCliente}</span></>}
                </p>
              </div>
              <button type="button" className="tc-cerrar" onClick={() => !guardando && setModalAbierto(false)}>✕</button>
            </div>

            <input
              type="text"
              className="form-control tc-buscador-tarifas"
              placeholder="Buscar por descripción, origen o destino…"
              value={busquedaTarifa}
              onChange={(e) => setBusquedaTarifa(e.target.value)}
            />

            <div className="tc-marco tc-modal-marco">
              {tarifasVisibles.length === 0 ? (
                <p className="tc-vacio">{tarifasRef.length === 0 ? 'No hay tarifas en el catálogo de Tarifas de Referencia.' : 'Ninguna tarifa coincide con la búsqueda.'}</p>
              ) : (
                <table className="tc-tabla">
                  <thead>
                    <tr><th className="tc-th-check"></th><th>DESCRIPCIÓN</th><th>ORIGEN</th><th>DESTINO</th><th>COSTOS SUGERIDOS</th></tr>
                  </thead>
                  <tbody>
                    {tarifasVisibles.map((t) => {
                      const costos = costosDe(t);
                      const marcada = seleccion.has(t.id);
                      return (
                        <tr key={t.id} className={marcada ? 'tc-fila-marcada' : ''} onClick={() => toggleTarifa(t.id)}>
                          <td className="tc-th-check">
                            <input type="checkbox" checked={marcada} onChange={() => toggleTarifa(t.id)} onClick={(e) => e.stopPropagation()} />
                          </td>
                          <td>{t.descripcion || '—'}</td>
                          <td>{t.origen || '—'}</td>
                          <td>{t.destino || '—'}</td>
                          <td className="tc-td-num">{costos.length > 0 ? costos.map(fmtMoney).join(' · ') : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div className="tc-modal-pie">
              <span className="tc-conteo-sel"><b>{seleccion.size}</b> tarifa(s) seleccionada(s)</span>
              <div className="tc-modal-botones">
                <button type="button" className="btn btn-outline" disabled={guardando} onClick={() => setModalAbierto(false)}>Cancelar</button>
                <button type="button" className="tc-btn-guardar" disabled={seleccion.size === 0 || guardando} onClick={guardarPreConvenio}>
                  {guardando ? 'Guardando…' : 'Guardar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default TarifarioClientesDashboard;
