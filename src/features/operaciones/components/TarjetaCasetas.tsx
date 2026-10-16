// ✅ V00360: tarjeta "CASETAS DEL DÍA" — muestra lo GASTADO HOY en cruces
//   (total en Dólares y total en Pesos) y el botón diario "＋ Actualizar saldo":
//   modal con Puente (lista del catálogo), Moneda (no editable), Saldo a
//   agregar, Saldo pendiente por puente y Total. Las recargas quedan en
//   saldos_puentes y el saldo se consume al marcar Verde MX (exportación,
//   Puente III en pesos) o Verde USA (importación, Caseta AVI en dólares).
// ✅ V00455: "Actualizar saldo" abre el MISMO formulario de Referencias de Puentes →
//   Saldo (ModalAgregarSaldoPuente) con la caseta de la tarjeta ya elegida, y al
//   presionar la tarjeta se ven los movimientos de su saldo (ModalMovimientosPuente).
import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { useModuloEscuchando } from '../../../utils/moduloVivoContexto';
import { idReal, useCatalogo } from '../../../shared/data/catalogos';
import { monedaCanonica, nombreMoneda as nombreMonedaCanonica } from '../../../shared/dominio/moneda';
import type { TarjetaPuente } from '../../puentes/services/puentesCatalogo';
import { movimientosDePuente, type OtroCruceMin, type RefPuente, type SaldoPuenteMin } from '../services/movimientosPuente';
import { lazyWithRetry } from '../../../utils/lazyWithRetry';
import './TarjetaCasetas.css';

// ✅ V00455: los modales se cargan al abrirlos (la tarjeta va en la carga inicial de la app)
const ModalAgregarSaldoPuente = lazyWithRetry(() => import('../../puentes/components/ModalAgregarSaldoPuente'), 'ModalAgregarSaldoPuente');
const ModalMovimientosPuente = lazyWithRetry(() => import('./ModalMovimientosPuente'), 'ModalMovimientosPuente');

const norm = (s: unknown): string => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
// ✅ V00439 (Fase 3.x): moneda con el helper compartido; lo no reconocido se deja tal cual.
const nombreMoneda = (v: unknown): string => nombreMonedaCanonica(monedaCanonica(v)) || String(v ?? '');
const fmtMonto = (v: unknown): string => {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
};
// ✅ V00398: fecha LOCAL (antes UTC: por la tarde-noche ya era "mañana")
const hoyISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

interface Puente { id: string; nombre: string; moneda: string; }
interface CruceMin { puenteNombre: string; fecha: string; fechaServicio: string; monto: number; moneda: string; ref: string; statusNombre: string; evento: string; }
// ✅ V00455: la referencia guarda además la fecha de servicio y la hora del verde de cada fila (para "Cruces de hoy")
type RefTarjeta = RefPuente & { filasHoy: { fechaServicio: string; horaVerde: string }[] };

// ✅ V00389: a qué tarjeta pertenece cada puente del catálogo
type GrupoPuente = TarjetaPuente;
const GRUPOS: { clave: GrupoPuente; titulo: string }[] = [
  { clave: 'avi', titulo: 'Puente AVI' },
  { clave: 'p3', titulo: 'Puente III' },
  { clave: 'colombia', titulo: 'Puente Colombia' },
];
const esPisoColombia = (nombre: string) => norm(nombre) === 'puente mx colombia';
const grupoDePuente = (nombre: string): GrupoPuente | null => {
  const n = norm(nombre);
  if (!n) return null;
  if (n.includes('colombia')) return 'colombia';
  if (n.includes('avi')) return 'avi';
  if (n.includes('puente iii') || n.includes('puente 3')) return 'p3';
  if (n.includes('mx')) return 'p3'; // casetas de México hacia Nuevo Laredo (ej. Caseta Mx Auto)
  return null;
};

export const TarjetaCasetas: React.FC = () => {
  // ✅ V00439 (Fase 3.x): puentes del catálogo Tipos de Gastos vía el listener compartido.
  const { datos: tiposGastos } = useCatalogo('catalogo_tipos_gastos');
  const puentes = useMemo<Puente[]>(() => tiposGastos
    .filter((x) => norm(x.categoria_gasto) === 'puente')
    .map((x) => ({ id: idReal(x), nombre: String(x.nombre_gasto || ''), moneda: nombreMoneda(x.moneda) }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre)), [tiposGastos]);
  const [recargas, setRecargas] = useState<SaldoPuenteMin[]>([]);
  // ✅ V00455: se guardan las referencias (para el modal de movimientos); los cruces salen de ellas
  const [refs, setRefs] = useState<RefTarjeta[]>([]);
  // ✅ V00395: OTROS CRUCES (sin operación, registrados en Referencias de Puentes) también descuentan
  const [otros, setOtros] = useState<OtroCruceMin[]>([]);
  // ✅ V00455: primera respuesta de cada listener (el modal de movimientos espera con CargandoDatos)
  const [listos, setListos] = useState({ saldos: false, refs: false, otros: false });
  const crucesOps = useMemo<CruceMin[]>(() => refs.flatMap((r) => r.filas.flatMap((o, i) => {
    const [nomCaseta, nomPiso] = String(o.puenteNombre || '').split(' + ');
    const extra = r.filasHoy[i] || { fechaServicio: r.fecha, horaVerde: '' };
    const base = { fecha: r.fecha, fechaServicio: extra.fechaServicio, ref: o.ref, statusNombre: r.consecutivo, evento: extra.horaVerde };
    const filas: CruceMin[] = [{ ...base, puenteNombre: String(nomCaseta || ''), monto: o.caseta, moneda: o.casetaMoneda }];
    if (nomPiso && o.piso > 0) filas.push({ ...base, puenteNombre: String(nomPiso), monto: o.piso, moneda: o.pisoMoneda });
    return filas;
  })), [refs]);
  const crucesOtros = useMemo<CruceMin[]>(() => otros.map((x) => ({ puenteNombre: x.puenteNombre, fecha: x.fecha, fechaServicio: x.fecha, monto: x.monto, moneda: x.moneda, ref: x.consecutivo, statusNombre: 'Otro cruce', evento: x.unidad })), [otros]);
  const cruces = useMemo(() => [...crucesOps, ...crucesOtros], [crucesOps, crucesOtros]);
  // ✅ V00362: clic en el gasto del día → operaciones que suman al saldo
  const [verGasto, setVerGasto] = useState<{ titulo: string; filtro: (nombre: string) => boolean; soloHoy?: boolean } | null>(null);
  // ✅ V00455: tarjeta cuyo saldo se actualiza / cuyos movimientos se ven
  const [recargaDe, setRecargaDe] = useState<GrupoPuente | null>(null);
  const [movimientosDe, setMovimientosDe] = useState<GrupoPuente | null>(null);

  // ✅ V00438 (Fase 2.7): la tarjeta vive dentro del módulo Operaciones (MantenerVivo):
  //   escucha solo mientras se ve; oculta conserva las cifras y al volver se re-suscribe.
  //   Sin ventana de fechas a propósito: el saldo restante sale de TODO el historial
  //   (recargas − cruces desde la 1ª recarga) y lo de "hoy" sale de esos mismos datos;
  //   acotar cambiaría las cifras. Saldo corrido en un documento → Fase 5.6.
  const moduloVisible = useModuloEscuchando(); // ✅ V00446: sigue escuchando unos minutos oculto
  useEffect(() => {
    if (!moduloVisible) return;
    const listo = (k: keyof typeof listos) => setListos((prev) => (prev[k] ? prev : { ...prev, [k]: true }));
    const u2 = onSnapshot(collection(db, 'saldos_puentes'), (snap) => {
      setRecargas(snap.docs.map((d) => {
        const x = d.data() as Record<string, unknown>;
        return { id: d.id, puenteId: String(x.puenteId || ''), puenteNombre: String(x.puenteNombre || ''), fecha: String(x.fecha || ''), hora: String(x.hora || ''), saldo: Number(x.saldo) || 0, moneda: String(x.moneda || ''), registradoPor: String(x.registradoPor || '') };
      }));
      listo('saldos');
    }, () => listo('saldos'));
    // ✅ V00410: las tarjetas cuadran con la pestaña SALDO de Referencias de Puentes —
    //   se descuenta lo que está en el HISTORIAL DE REFERENCIAS (calculado) + Otros Cruces.
    const u3 = onSnapshot(collection(db, 'referencias_puentes_auto'), (snap) => {
      setRefs(snap.docs.map((d) => {
        const r = d.data() as Record<string, unknown>;
        const fechaRef = String(r.fechaGeneracion || '');
        const ops = (Array.isArray(r.operacionesGuardadas) ? r.operacionesGuardadas : []) as Record<string, unknown>[];
        return {
          id: d.id, consecutivo: String(r.consecutivo || ''), puenteNombre: String(r.puenteNombre || ''), fecha: fechaRef, hora: String(r.horaGeneracion || ''), automatico: r.automatico === true,
          filas: ops.map((o) => ({ ref: String(o.ref || ''), puenteNombre: String(o.puenteNombre || ''), caseta: Number(o.caseta ?? o.puente) || 0, casetaMoneda: String(o.casetaMoneda || ''), piso: Number(o.piso) || 0, pisoMoneda: String(o.pisoMoneda || '') })),
          filasHoy: ops.map((o) => ({ fechaServicio: String(o.fecha || fechaRef).slice(0, 10), horaVerde: String(o.horaVerde || '') })),
        };
      }));
      listo('refs');
    }, () => listo('refs'));
    const u4 = onSnapshot(query(collection(db, 'referencias_puentes'), where('tipo', '==', 'otroCruce')), (snap) => {
      setOtros(snap.docs.map((d) => {
        const x = d.data() as Record<string, unknown>;
        const fecha = String(x.fechaCruce || x.fechaGeneracion || '');
        return { id: d.id, consecutivo: String(x.consecutivo || d.id), puenteNombre: String(x.puenteNombre || ''), fecha, hora: String(x.horaCruce || x.horaGeneracion || ''), monto: Number(x.monto ?? x.subtotalPuentes) || 0, moneda: nombreMoneda(x.moneda), unidad: String(x.unidad || '') };
      }));
      listo('otros');
    }, () => { setOtros([]); listo('otros'); });
    return () => { u2(); u3(); u4(); };
  }, [moduloVisible]);

  // ✅ V00389: TRES tarjetas separadas — Puente AVI, Puente III y Puente
  //   Colombia. Colombia muestra por separado la CASETA (cruzar) y el PUENTE
  //   (pisarlo, Puente Mx Colombia).
  const hoy = hoyISO();
  const sumar = (l: CruceMin[]) => l.reduce((acc, c) => acc + c.monto, 0);
  const monedaDe = (filtro: (nombre: string) => boolean) => puentes.find((p) => filtro(p.nombre))?.moneda || '';

  const lineasGrupo = (g: GrupoPuente): { etiqueta: string; filtro: (n: string) => boolean }[] =>
    g === 'colombia'
      ? [
          { etiqueta: 'Caseta', filtro: (n) => grupoDePuente(n) === 'colombia' && !esPisoColombia(n) },
          { etiqueta: 'Puente', filtro: (n) => esPisoColombia(n) },
        ]
      : [{ etiqueta: '', filtro: (n) => grupoDePuente(n) === g }];

  // ✅ V00392: CONTROL por cuenta — saldo agregado (recargas), cruces hechos,
  //   total consumido (la suma de esos cruces) y saldo restante = agregado − consumido.
  //   Los cruces cuentan desde la PRIMERA recarga del puente, igual que el saldo.
  // ✅ V00422: el saldo es del PUENTE completo (por nombre o por el puente del catálogo)
  const saldoEs = (filtroSaldo: (nombre: string) => boolean) => (r: SaldoPuenteMin) => filtroSaldo(r.puenteNombre) || puentes.some((p) => p.id === r.puenteId && filtroSaldo(p.nombre));
  const statsDe = (filtro: (nombre: string) => boolean, filtroSaldo: (nombre: string) => boolean = filtro) => {
    // ✅ V00418: IGUAL que la pestaña Saldo — el saldo es por PUENTE (grupo): los
    //   saldos agregados del grupo descuentan TODOS sus cobros (Puente III = caseta +
    //   trompo; Colombia = caseta + puente) desde el primer saldo del grupo.
    const recs = recargas
      .filter(saldoEs(filtroSaldo))
      .sort((a, b) => a.fecha.localeCompare(b.fecha));
    const primera = recs[0]?.fecha || '';
    const agregado = recs.reduce((acc, r) => acc + r.saldo, 0);
    const mios = recs.length ? cruces.filter((x) => filtro(x.puenteNombre) && (!primera || x.fecha >= primera)) : [];
    const consumido = mios.reduce((acc, x) => acc + x.monto, 0);
    // ✅ V00398: lo de HOY (por fecha de servicio); inicio + recargas hoy − consumido hoy = restante.
    const restante = agregado - consumido;
    const delDia = cruces.filter((x) => filtro(x.puenteNombre) && x.fechaServicio === hoy);
    const consumidoHoy = recs.length ? delDia.reduce((acc, x) => acc + x.monto, 0) : 0;
    const recargasHoy = recs.filter((r) => r.fecha === hoy).reduce((acc, r) => acc + r.saldo, 0);
    return { agregado, cruces: mios.length, consumido, restante, crucesHoy: delDia.length, consumidoHoy, recargasHoy, inicioDia: restante + consumidoHoy - recargasHoy };
  };

  const filtroDeGrupo = (g: GrupoPuente) => { const lineas = lineasGrupo(g); return (n: string) => lineas.some((l) => l.filtro(n)); };

  return (
    <>
      {GRUPOS.map((g) => {
        // ✅ V00411: diseño renovado — cifra grande = saldo restante (igual que la
        //   pestaña Saldo); filas compactas; Colombia en dos bloques (caseta / puente).
        const lineas = lineasGrupo(g.clave);
        const filtroTodo = filtroDeGrupo(g.clave);
        const total = statsDe(filtroTodo);
        const mon = monedaDe(filtroTodo);
        const partes = lineas.map((l) => ({ ...l, st: statsDe(l.filtro, filtroTodo) })); // ✅ V00422: cada concepto contra el saldo del puente
        return (
          <div key={g.clave} className="rd-card rd-card--morado rd-card--clic" title={`${g.titulo}: saldos agregados menos el Historial de referencias. Presiona la tarjeta para ver los movimientos del saldo.`}>
            {/* ✅ V00455: toda la tarjeta abre los movimientos de su saldo (los botones de adentro hacen lo suyo) · V00456: clases de App.css (rd-card--clic) */}
            <button type="button" className="rd-card__abrir" onClick={() => setMovimientosDe(g.clave)} aria-label={`Ver los movimientos del saldo de ${g.titulo}`} />
            <div className="rd-card__head">
              <span className="rd-card__label">{g.titulo}</span>
              {mon && <span className="rd-card__chip">{mon === 'Dólares' ? 'USD' : mon === 'Pesos' ? 'MXN' : mon}</span>}
            </div>
            <span className={`rd-card__value${total.restante < 0 ? ' rd-card__value--neg' : ''}`} title="Saldo restante = saldos agregados − referencias">{fmtMonto(total.restante)}</span>
            <span className="rd-card__sub">{total.restante < 0 ? 'Sobregirado' : 'Saldo restante'}</span>
            <div className="rd-filas">
              {partes.length > 1 ? partes.map((p) => (
                <React.Fragment key={p.etiqueta}>
                  <div className="rd-filas__f">
                    <span className="rd-filas__et rd-filas__et--fuerte">{p.etiqueta}</span>
                    <span className="rd-filas__v rd-filas__v--cargo" title="Total cruzado de este concepto">−{fmtMonto(p.st.consumido)}</span>
                  </div>
                  <button type="button" className="rd-filas__f rd-filas__f--btn" title="Ver los cruces de hoy" onClick={() => setVerGasto({ titulo: `${g.titulo} — ${p.etiqueta}`, filtro: p.filtro, soloHoy: true })}>
                    <span className="rd-filas__et">Hoy · {p.st.crucesHoy} {p.st.crucesHoy === 1 ? 'cruce' : 'cruces'}</span>
                    <span className="rd-filas__v rd-filas__v--cargo">−{fmtMonto(p.st.consumidoHoy)}</span>
                  </button>
                </React.Fragment>
              )) : (
                <>
                  <div className="rd-filas__f"><span className="rd-filas__et">Al iniciar hoy</span><span className="rd-filas__v">{fmtMonto(total.inicioDia)}</span></div>
                  {total.recargasHoy > 0 && <div className="rd-filas__f"><span className="rd-filas__et">Recargas hoy</span><span className="rd-filas__v rd-filas__v--abono">+{fmtMonto(total.recargasHoy)}</span></div>}
                  <button type="button" className="rd-filas__f rd-filas__f--btn" title="Ver los cruces de hoy" onClick={() => setVerGasto({ titulo: g.titulo, filtro: filtroTodo, soloHoy: true })}>
                    <span className="rd-filas__et">Hoy · {total.crucesHoy} {total.crucesHoy === 1 ? 'cruce' : 'cruces'}</span>
                    <span className="rd-filas__v rd-filas__v--cargo">−{fmtMonto(total.consumidoHoy)}</span>
                  </button>
                </>
              )}
            </div>
            <div className="rd-card__foot">
              <button type="button" className="rd-btn rd-btn--ancho" onClick={() => setRecargaDe(g.clave)} title={`Agregar saldo a ${g.titulo} (queda en Referencias de Puentes → Saldo)`}>Actualizar saldo</button>
            </div>
          </div>
        );
      })}

      {verGasto && (() => {
        const lista = cruces.filter((c) => (!verGasto.soloHoy || c.fechaServicio === hoy) && verGasto.filtro(c.puenteNombre)).sort((a, b) => b.fecha.localeCompare(a.fecha) || a.ref.localeCompare(b.ref));
        const total = sumar(lista);
        return (
          <div className="tcas-modal-fondo" onClick={() => setVerGasto(null)}>
            <div className="tcas-modal tcas-modal--gasto" onClick={(e) => e.stopPropagation()}>
              <div className="tcas-modal-titulo">Cruces de hoy — {verGasto.titulo}</div>
              <div className="tcas-gasto-marco">
                <table className="tcas-gasto-tabla">
                  <thead><tr><th>Fecha</th><th># Referencia</th><th>Status</th><th>Puente</th><th className="tcas-gasto-num">Peaje</th></tr></thead>
                  <tbody>
                    {lista.length === 0 && <tr><td colSpan={5} className="tcas-gasto-vacio">Sin cruces hoy.</td></tr>}
                    {lista.map((c, i) => (
                      <tr key={i}>
                        <td>{c.fechaServicio}</td>
                        <td className="tcas-gasto-ref">{c.ref}</td>
                        <td className="tcas-gasto-status" title={c.evento ? `Peaje cobrado al marcar: ${c.evento}` : ''}>{c.statusNombre || '—'}{c.evento && <em className="tcas-gasto-evento">✓ {c.evento}</em>}</td>
                        <td>{c.puenteNombre}</td>
                        <td className="tcas-gasto-num">−{fmtMonto(c.monto)} {c.moneda}</td>
                      </tr>
                    ))}
                  </tbody>
                  {lista.length > 0 && <tfoot><tr><td colSpan={4}>Consumido hoy ({lista.length} cruce{lista.length === 1 ? '' : 's'})</td><td className="tcas-gasto-num tcas-gasto-total">−{fmtMonto(total)}</td></tr></tfoot>}
                </table>
              </div>
              <div className="tcas-modal-pie"><button type="button" className="tcas-btn" onClick={() => setVerGasto(null)}>Cerrar</button></div>
            </div>
          </div>
        );
      })()}

      {recargaDe && <Suspense fallback={null}><ModalAgregarSaldoPuente tarjeta={recargaDe} onCerrar={() => setRecargaDe(null)} /></Suspense>}

      {movimientosDe && (() => {
        const g = GRUPOS.find((x) => x.clave === movimientosDe);
        const filtro = filtroDeGrupo(movimientosDe);
        const mon = monedaDe(filtro);
        return (
          <Suspense fallback={null}>
          <ModalMovimientosPuente
            titulo={g?.titulo || ''}
            restante={statsDe(filtro).restante}
            moneda={mon}
            movimientos={movimientosDePuente({ refs, saldos: recargas, otros }, filtro, saldoEs(filtro))}
            cargando={!(listos.saldos && listos.refs && listos.otros)}
            onCerrar={() => setMovimientosDe(null)}
          />
          </Suspense>
        );
      })()}
    </>
  );
};
