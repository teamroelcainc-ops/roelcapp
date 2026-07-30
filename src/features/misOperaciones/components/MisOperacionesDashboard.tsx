// src/features/misOperaciones/components/MisOperacionesDashboard.tsx
// ---------------------------------------------------------------------------
// MIS OPERACIONES — vista del OPERADOR (chofer).
//   · Solo ve las operaciones ACTIVAS asignadas a él: se vincula por NOMBRE
//     entre su usuario de la app y su registro de Colaborador (empleados).
//   · Marcar un horario es UN SOLO TAP: botón gigante (pantalla completa en
//     móvil) que avanza al siguiente status y sella fecha/hora — el operador
//     va conduciendo y no debe batallar con listas ni formularios.
//   · Replica el mecanismo oficial del sistema: documento en `horarios` +
//     actualización de status de la operación (mismo batch que usa tráfico).
//   · Funciona sin internet: la marca queda encolada (IndexedDB de Firestore)
//     y se sincroniza sola al reconectar.
// ---------------------------------------------------------------------------
import { useState, useEffect, useMemo } from 'react';
import {
  collection, query, where, onSnapshot, getDocs, writeBatch, doc, deleteDoc, updateDoc,
} from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { useUsuarioStore } from '../../../stores/useUsuarioStore';
import { useEstadoConexion } from '../../../hooks/useEstadoConexion';
import { registrarLog } from '../../../utils/logger';
import { nombreDeEmpleado } from '../../../utils/nombreEmpleado';
import { ChevronLeft, MapPin, Truck, CheckCircle2, Clock } from 'lucide-react';
import './MisOperacionesDashboard.css';

// Status que ya no son "activos" (mismos IDs que usa Operaciones Activas).
const IDS_STATUS_EXCLUIDOS = ['7607f692', 'f557b751', 'c2d57403'];

interface StatusCatalogo {
  id: string;
  nombre: string;
}

// ⭐ Campos de la operación que esta vista usa (el doc completo no tiene tipo canónico).
interface OperacionAsignada {
  id: string;
  _docId?: string;
  ref?: string;
  status?: string;
  statusNombre?: string;
  clienteNombre?: string;
  clientePagaNombre?: string;
  origenNombre?: string;
  destinoNombre?: string;
  remolqueNombre?: string;
  unidadNombre?: string;
  fechaServicio?: string;
  [extra: string]: unknown;
}

interface HorarioMarcado {
  id: string;
  statusNombre?: string;
  fechaHora?: string;
  registradoEn?: string;
}

interface UltimaMarca {
  horarioId: string;
  opId: string;
  statusAnteriorId: string;
  statusAnteriorNombre: string;
  statusMarcadoNombre: string;
  ts: number;
}

const normalizar = (s: unknown): string =>
  String(s || '').trim().toUpperCase().replace(/\s+/g, ' ');

const prefijoNumerico = (nombre: string): number => {
  const m = String(nombre).match(/^(\d+)/);
  return m ? Number(m[1]) : 999;
};

const horaLocalCorta = (): string => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  // Mismo formato que el input datetime-local que usa tráfico en 'horarios'.
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function MisOperacionesDashboard() {
  const usuario = useUsuarioStore((s) => s.usuario);
  const { enLinea } = useEstadoConexion();

  const [idsOperador, setIdsOperador] = useState<string[] | null>(null); // null = cargando
  const [operaciones, setOperaciones] = useState<OperacionAsignada[]>([]);
  const [statuses, setStatuses] = useState<StatusCatalogo[]>([]);
  const [opAbierta, setOpAbierta] = useState<OperacionAsignada | null>(null);
  const [horariosOp, setHorariosOp] = useState<HorarioMarcado[]>([]);
  const [marcando, setMarcando] = useState(false);
  const [ultimaMarca, setUltimaMarca] = useState<UltimaMarca | null>(null);
  const [aviso, setAviso] = useState('');

  // [1] Vincular el usuario con su registro de Colaborador.
  //   ✅ Primero el vínculo EXPLÍCITO (campo "Conectar con colaborador" del
  //   módulo Usuarios: usuario.colaboradorId). Si no existe, se respalda con
  //   la coincidencia por NOMBRE (compatibilidad con usuarios sin vincular).
  useEffect(() => {
    let activo = true;
    const vincular = async () => {
      if (usuario?.colaboradorId) {
        setIdsOperador([String(usuario.colaboradorId)]);
        return;
      }
      if (!usuario?.nombre) { setIdsOperador([]); return; }
      try {
        const snap = await getDocs(collection(db, 'empleados'));
        const objetivo = normalizar(usuario.nombre);
        const ids = snap.docs
          .filter((d) => normalizar(nombreDeEmpleado(d.data())) === objetivo)
          .map((d) => d.id);
        if (activo) setIdsOperador(ids);
      } catch (e) {
        console.error('No se pudo vincular el colaborador:', e);
        if (activo) setIdsOperador([]);
      }
    };
    vincular();
    return () => { activo = false; };
  }, [usuario?.nombre, usuario?.colaboradorId]);

  // [2] Catálogo de status ordenado (para saber cuál sigue).
  useEffect(() => {
    let activo = true;
    getDocs(collection(db, 'catalogo_status_servicio'))
      .then((snap) => {
        if (!activo) return;
        const lista = snap.docs
          .map((d) => ({ id: d.id, nombre: String((d.data() as { nombre?: string }).nombre || '') }))
          .sort((a, b) => prefijoNumerico(a.nombre) - prefijoNumerico(b.nombre));
        setStatuses(lista);
      })
      .catch((e) => console.error('No se pudo cargar el catálogo de status:', e));
    return () => { activo = false; };
  }, []);

  // [3] Operaciones ACTIVAS asignadas al operador, en tiempo real.
  useEffect(() => {
    if (!idsOperador || idsOperador.length === 0) { setOperaciones([]); return; }
    const q = query(collection(db, 'operaciones'), where('operador', 'in', idsOperador.slice(0, 10)));
    const unsubscribe = onSnapshot(q, (snap) => {
      const lista: OperacionAsignada[] = snap.docs
        .map((d) => {
          const data = d.data() as OperacionAsignada;
          return { ...data, id: d.id, _docId: d.id };
        })
        .filter((op) => !IDS_STATUS_EXCLUIDOS.includes(String(op.status || '')))
        .sort((a, b) => String(a.fechaServicio || '').localeCompare(String(b.fechaServicio || '')));
      setOperaciones(lista);
      // Mantener sincronizada la operación abierta (o cerrarla si ya no está activa).
      setOpAbierta((prev) => (prev ? lista.find((o) => o.id === prev.id) || null : prev));
    });
    return () => unsubscribe();
  }, [idsOperador]);

  // [4] Horarios ya marcados de la operación abierta.
  useEffect(() => {
    if (!opAbierta) { setHorariosOp([]); return; }
    let activo = true;
    getDocs(query(collection(db, 'horarios'), where('operacionId', '==', opAbierta.id)))
      .then((snap) => {
        if (!activo) return;
        const lista = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<HorarioMarcado, 'id'>) }))
          .sort((a, b) => String(a.registradoEn || '').localeCompare(String(b.registradoEn || '')));
        setHorariosOp(lista);
      })
      .catch(() => { /* sin horarios aún */ });
    return () => { activo = false; };
  }, [opAbierta?.id, opAbierta]);

  const mapaStatus = useMemo(() => {
    const porId: Record<string, StatusCatalogo> = {};
    statuses.forEach((s) => { porId[s.id] = s; });
    return porId;
  }, [statuses]);

  const nombreStatusOp = (op: OperacionAsignada): string =>
    mapaStatus[String(op.status || '')]?.nombre || String(op.statusNombre || op.status || 'Sin status');

  const siguienteStatus = (op: OperacionAsignada): StatusCatalogo | null => {
    if (statuses.length === 0) return null;
    const idx = statuses.findIndex((s) => s.id === String(op.status || ''));
    if (idx === -1) {
      // Status no catalogado: ofrecer el primero no excluido como arranque.
      return statuses.find((s) => !IDS_STATUS_EXCLUIDOS.includes(s.id)) || null;
    }
    return statuses[idx + 1] || null;
  };

  const esFinal = (s: StatusCatalogo | null): boolean =>
    !!s && (IDS_STATUS_EXCLUIDOS.includes(s.id) || /completad/i.test(s.nombre));

  const mostrarAviso = (texto: string) => {
    setAviso(texto);
    window.setTimeout(() => setAviso(''), 4000);
  };

  // [5] ⭐ EL TAP: marca el siguiente status con fecha/hora (mecanismo oficial:
  //     doc en `horarios` + update del status de la operación, en un batch).
  const marcarSiguiente = async () => {
    if (!opAbierta || marcando || !usuario) return;
    const siguiente = siguienteStatus(opAbierta);
    if (!siguiente) { mostrarAviso('Esta operación ya no tiene un status siguiente.'); return; }

    setMarcando(true);
    if (navigator.vibrate) navigator.vibrate(60);

    const horarioRef = doc(collection(db, 'horarios'));
    const registradoEn = new Date().toISOString();
    const datosHorario = {
      operacionId: opAbierta.id,
      status: siguiente.id,
      statusNombre: siguiente.nombre,
      fechaHora: horaLocalCorta(),
      registradoEn,
      registradoPor: usuario.nombre || usuario.email || usuario.id,
      origen: 'operador-movil',
    };
    const batch = writeBatch(db);
    batch.set(horarioRef, datosHorario);
    batch.update(doc(db, 'operaciones', String(opAbierta._docId || opAbierta.id)), {
      status: siguiente.id,
      statusNombre: siguiente.nombre,
    });

    const marca: UltimaMarca = {
      horarioId: horarioRef.id,
      opId: opAbierta.id,
      statusAnteriorId: String(opAbierta.status || ''),
      statusAnteriorNombre: nombreStatusOp(opAbierta),
      statusMarcadoNombre: siguiente.nombre,
      ts: Date.now(),
    };

    try {
      if (!enLinea) {
        // Sin internet: la escritura queda encolada y sincroniza sola.
        batch.commit().catch((e) => console.error('Marca offline no sincronizada:', e));
        setHorariosOp((prev) => [...prev, { id: horarioRef.id, ...datosHorario }]);
        setUltimaMarca(marca);
        mostrarAviso(`${siguiente.nombre} — guardado en el dispositivo (sin conexión)`);
      } else {
        await batch.commit();
        setHorariosOp((prev) => [...prev, { id: horarioRef.id, ...datosHorario }]);
        setUltimaMarca(marca);
        registrarLog('Mis Operaciones', 'Horario', `${usuario.nombre} marcó "${siguiente.nombre}" en ${opAbierta.ref || opAbierta.id}`).catch(() => {});
        mostrarAviso(`Marcado: ${siguiente.nombre}`);
      }
    } catch (e) {
      console.error('No se pudo marcar el horario:', e);
      mostrarAviso('No se pudo marcar. Intenta de nuevo.');
    }
    setMarcando(false);
  };

  // [6] Deshacer la ÚLTIMA marca propia (ventana de 5 minutos).
  //   El botón se retira solo al vencer la ventana (timer), y la ventana se
  //   valida también dentro del handler (regla de pureza del render).
  useEffect(() => {
    if (!ultimaMarca) return;
    const timer = window.setTimeout(() => setUltimaMarca(null), 5 * 60 * 1000);
    return () => window.clearTimeout(timer);
  }, [ultimaMarca]);

  const puedeDeshacer = !!ultimaMarca && !!opAbierta && ultimaMarca.opId === opAbierta.id;

  const deshacerUltima = async () => {
    if (!ultimaMarca || !opAbierta || marcando) return;
    if (Date.now() - ultimaMarca.ts > 5 * 60 * 1000) { setUltimaMarca(null); return; }
    setMarcando(true);
    try {
      await deleteDoc(doc(db, 'horarios', ultimaMarca.horarioId));
      await updateDoc(doc(db, 'operaciones', String(opAbierta._docId || opAbierta.id)), {
        status: ultimaMarca.statusAnteriorId,
        statusNombre: ultimaMarca.statusAnteriorNombre,
      });
      setHorariosOp((prev) => prev.filter((h) => h.id !== ultimaMarca.horarioId));
      registrarLog('Mis Operaciones', 'Horario', `${usuario?.nombre} DESHIZO "${ultimaMarca.statusMarcadoNombre}" en ${opAbierta.ref || opAbierta.id}`).catch(() => {});
      setUltimaMarca(null);
      mostrarAviso('Última marca deshecha.');
    } catch (e) {
      console.error('No se pudo deshacer:', e);
      mostrarAviso('No se pudo deshacer. Avisa a tráfico.');
    }
    setMarcando(false);
  };

  // ────────────────────────────── RENDER ──────────────────────────────

  if (idsOperador === null) {
    return <div className="mo-contenedor"><p className="mo-estado">Cargando tus operaciones…</p></div>;
  }

  if (idsOperador.length === 0) {
    return (
      <div className="mo-contenedor">
        <h1 className="mo-titulo">Mis Operaciones</h1>
        <div className="mo-vacio">
          <p><strong>Tu usuario no está vinculado a un Colaborador.</strong></p>
          <p>Pide a administración que en el módulo Usuarios te conecten con tu registro usando el campo "Conectar con colaborador".</p>
        </div>
      </div>
    );
  }

  // Vista DETALLE con el botón gigante de marcado
  if (opAbierta) {
    const siguiente = siguienteStatus(opAbierta);
    return (
      <div className="mo-contenedor mo-detalle">
        <button className="mo-volver" onClick={() => setOpAbierta(null)}>
          <ChevronLeft size={20} /> Mis operaciones
        </button>

        <div className="mo-detalle-info">
          <span className="mo-ref">{opAbierta.ref || opAbierta.id}</span>
          <span className="mo-cliente">{String(opAbierta.clientePagaNombre || opAbierta.clienteNombre || '')}</span>
          <span className="mo-ruta">
            <MapPin size={14} /> {String(opAbierta.origenNombre || '¿?')} → {String(opAbierta.destinoNombre || '¿?')}
          </span>
          {(opAbierta.unidadNombre || opAbierta.remolqueNombre) ? (
            <span className="mo-equipo"><Truck size={14} /> {String(opAbierta.unidadNombre || '')} {String(opAbierta.remolqueNombre || '')}</span>
          ) : null}
          <span className="mo-status-actual">Status actual: <strong>{nombreStatusOp(opAbierta)}</strong></span>
        </div>

        {horariosOp.length > 0 && (
          <ul className="mo-timeline">
            {horariosOp.map((h) => (
              <li key={h.id}>
                <CheckCircle2 size={14} />
                <span className="mo-timeline-status">{h.statusNombre}</span>
                <span className="mo-timeline-hora"><Clock size={12} /> {String(h.fechaHora || '').replace('T', ' ')}</span>
              </li>
            ))}
          </ul>
        )}

        {aviso && <div className="mo-toast">{aviso}</div>}

        {siguiente ? (
          <button
            className={`mo-boton-gigante${esFinal(siguiente) ? ' final' : ''}`}
            onClick={marcarSiguiente}
            disabled={marcando}
          >
            <span className="mo-boton-accion">{marcando ? 'Marcando…' : 'MARCAR'}</span>
            <span className="mo-boton-status">{siguiente.nombre}</span>
            <span className="mo-boton-pista">{esFinal(siguiente) ? 'Esto finaliza el servicio' : 'Un solo toque · sella la hora'}</span>
          </button>
        ) : (
          <div className="mo-vacio">No hay un status siguiente para esta operación.</div>
        )}

        {puedeDeshacer && (
          <button className="mo-deshacer" onClick={deshacerUltima} disabled={marcando}>
            Deshacer "{ultimaMarca?.statusMarcadoNombre}"
          </button>
        )}
      </div>
    );
  }

  // Vista LISTA de operaciones asignadas
  return (
    <div className="mo-contenedor">
      <h1 className="mo-titulo">Mis Operaciones</h1>
      <p className="mo-subtitulo">{operaciones.length} {operaciones.length === 1 ? 'operación activa asignada' : 'operaciones activas asignadas'}</p>

      {aviso && <div className="mo-toast">{aviso}</div>}

      {operaciones.length === 0 ? (
        <div className="mo-vacio">No tienes operaciones activas asignadas por ahora.</div>
      ) : (
        <div className="mo-lista">
          {operaciones.map((op) => (
            <button key={op.id} className="mo-card" onClick={() => setOpAbierta(op)}>
              <div className="mo-card-fila">
                <span className="mo-ref">{op.ref || op.id}</span>
                <span className="mo-pill">{nombreStatusOp(op)}</span>
              </div>
              <span className="mo-cliente">{String(op.clientePagaNombre || op.clienteNombre || '')}</span>
              <span className="mo-ruta"><MapPin size={13} /> {String(op.origenNombre || '¿?')} → {String(op.destinoNombre || '¿?')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default MisOperacionesDashboard;
