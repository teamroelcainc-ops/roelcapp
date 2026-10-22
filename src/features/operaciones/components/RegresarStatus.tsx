// src/features/operaciones/components/RegresarStatus.tsx
// ---------------------------------------------------------------------------
// ✅ V00476 — "Regresar estatus" en la ficha de Servicios Completados: una operación
// completada o en Falso regresa a cualquier estatus de su flujo (Reglas de Estatus), con la
// fecha y hora del movimiento. Si el estatus no es Completado/Falso, vuelve a Operaciones
// Activas. La ventana dice antes de guardar qué pasa con el sueldo del operador y a qué
// referencias (facturas, nómina, diésel) sigue ligada.
// ---------------------------------------------------------------------------
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Undo2 } from 'lucide-react';
import CargandoDatos from '../../../shared/components/CargandoDatos';
import { ahoraLocalISOCorto } from '../../../utils/fechaHoraLocal';
import { obtenerNombresStatusDelFlujo } from '../config/statusRules';
import { efectosDelRegreso, fechaHoraCorta, opcionesDeRegreso } from '../services/regresoStatus';
import type { OpcionRegreso, StatusResuelto } from '../services/regresoStatus';
import { ErrorRegreso, leerBitacora, regresarStatusOperacion } from '../services/regresoStatusDatos';
import './RegresarStatus.css';

type Datos = Record<string, unknown>;

interface Props {
  op: Datos;
  /** Módulo para el Historial de Actividad. */
  modulo: string;
  /** Nombre o id → {id, nombre} del catálogo de estatus. */
  resolverStatus: (valor: string) => StatusResuelto;
  /** Nombres del catálogo de estatus (solo si la operación no tiene flujo ni bitácora). */
  catalogoStatus: readonly string[];
  onRegresada: (cambios: Datos, destino: StatusResuelto, vuelveAActivas: boolean) => void;
}

/** La más reciente por la que pasó (sin contar Completado/Falso): la que se propone. */
const propuesta = (opciones: readonly OpcionRegreso[]): string => {
  const pasadas = opciones.filter((o) => o.ultimaVez && !o.terminado).sort((a, b) => b.ultimaVez.localeCompare(a.ultimaVez));
  return pasadas[0]?.nombre ?? '';
};

export default function RegresarStatus({ op, modulo, resolverStatus, catalogoStatus, onRegresada }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [opciones, setOpciones] = useState<OpcionRegreso[] | null>(null);
  const [elegido, setElegido] = useState('');
  const [fechaHora, setFechaHora] = useState('');
  const [guardando, setGuardando] = useState(false);
  const pedido = useRef(0);

  const actual = String(op.statusNombre || '').trim() || resolverStatus(String(op.status || '')).nombre;
  const refTxt = String(op.ref || op.id || '');

  const abrir = async () => {
    const n = ++pedido.current;
    setAbierto(true);
    setOpciones(null);
    setElegido('');
    setFechaHora(ahoraLocalISOCorto());
    const [flujo, historial] = await Promise.all([
      obtenerNombresStatusDelFlujo(op),
      leerBitacora(op).catch((e: unknown) => { console.warn('[RegresarStatus] bitácora:', e); return []; }),
    ]);
    if (n !== pedido.current) return;
    const lista = opcionesDeRegreso({ flujo, historial, catalogo: catalogoStatus, actual, resolver: resolverStatus });
    setOpciones(lista);
    setElegido(propuesta(lista));
  };

  const cerrar = () => { if (guardando) return; pedido.current++; setAbierto(false); };

  const destino = elegido ? resolverStatus(elegido) : null;
  const efectos = destino ? efectosDelRegreso(op, destino) : null;

  const guardar = async () => {
    if (!destino || !efectos) return;
    if (!fechaHora) { alert('Escribe la fecha y hora del movimiento.'); return; }
    setGuardando(true);
    try {
      const { cambios } = await regresarStatusOperacion(op, destino, fechaHora, modulo);
      setGuardando(false);
      setAbierto(false);
      onRegresada(cambios, destino, efectos.vuelveAActivas);
    } catch (e) {
      setGuardando(false);
      if (e instanceof ErrorRegreso) { alert(e.message); return; }
      console.error('[RegresarStatus] No se pudo regresar el estatus:', e);
      const err = e as { message?: unknown; code?: unknown };
      alert(`No se pudo regresar el estatus. La operación quedó como estaba.\n\nDetalle técnico: ${String(err?.message || err?.code || 'desconocido')}`);
    }
  };

  return (
    <>
      <button type="button" className="rgs-btn" onClick={() => { void abrir(); }} title="Regresar la operación a otro estatus de su flujo">
        <Undo2 size={16} aria-hidden="true" />
        Regresar estatus
      </button>
      {abierto && createPortal(
        <div className="rgs-fondo" onMouseDown={(e) => { if (e.target === e.currentTarget) cerrar(); }}>
          <div className="rgs-modal" role="dialog" aria-modal="true" aria-labelledby="rgs-titulo">
            <div className="rgs-enc">
              <div>
                <h3 id="rgs-titulo" className="rgs-titulo">Regresar estatus</h3>
                <p className="rgs-sub">{refTxt} está en <b>{actual || 'sin estatus'}</b></p>
              </div>
              <button type="button" className="rgs-cerrar" onClick={cerrar} aria-label="Cerrar">✕</button>
            </div>

            <div className="rgs-cuerpo">
              {opciones === null ? (
                <CargandoDatos texto="Buscando los estatus de su flujo…" compacto />
              ) : opciones.length === 0 ? (
                <p className="rgs-vacio">Esta operación no tiene otros estatus en su flujo. Revisa Configuración → Reglas de Estatus.</p>
              ) : (
                <fieldset className="rgs-grupo">
                  <legend className="rgs-lbl">¿A qué estatus regresa?</legend>
                  <ul className="rgs-lista">
                    {opciones.map((o) => (
                      <li key={o.nombre}>
                        <label className={`rgs-opcion${elegido === o.nombre ? ' rgs-opcion--elegida' : ''}`}>
                          <input type="radio" name="rgs-destino" value={o.nombre} checked={elegido === o.nombre} onChange={() => setElegido(o.nombre)} />
                          <span className="rgs-nombre">{o.nombre}</span>
                          {o.terminado
                            ? <span className="rgs-etiqueta">Se queda en Completados</span>
                            : o.ultimaVez && <span className="rgs-paso">pasó el {fechaHoraCorta(o.ultimaVez)}</span>}
                        </label>
                      </li>
                    ))}
                  </ul>
                </fieldset>
              )}

              <label className="rgs-lbl" htmlFor="rgs-fecha">Fecha y hora del movimiento</label>
              <input id="rgs-fecha" type="datetime-local" className="form-control rgs-fecha" value={fechaHora} onChange={(e) => setFechaHora(e.target.value)} />

              {efectos && destino && (
                <div className="rgs-efectos" aria-live="polite">
                  <p className="rgs-efecto">
                    {efectos.vuelveAActivas
                      ? <>Sale de Servicios Completados y vuelve a <b>Operaciones Activas</b> en {destino.nombre}.</>
                      : <>Se queda en Servicios Completados como {destino.nombre}.</>}
                  </p>
                  {efectos.sueldo && <p className="rgs-efecto">{efectos.sueldo}</p>}
                  {efectos.conexiones.length > 0 && (
                    <p className="rgs-aviso">Sigue ligada a: {efectos.conexiones.join(' · ')}. Esas referencias no cambian; revísalas si hace falta.</p>
                  )}
                </div>
              )}
            </div>

            <div className="rgs-pie">
              <button type="button" className="btn btn-outline" disabled={guardando} onClick={cerrar}>Cancelar</button>
              <button type="button" className="rgs-guardar" disabled={guardando || !destino} onClick={() => { void guardar(); }}>
                {guardando ? 'Guardando…' : destino ? `Regresar a ${destino.nombre}` : 'Elige un estatus'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
