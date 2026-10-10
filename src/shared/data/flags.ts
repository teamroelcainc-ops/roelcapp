// src/shared/data/flags.ts
// ---------------------------------------------------------------------------
// ✅ V00437 — BANDERAS de la refactorización (documento configuracion/flags).
//
// Todo cambio que depende de algo desplegado en el servidor (callables nuevas,
// campos migrados) va detrás de una bandera APAGADA por defecto: la app sigue
// por el camino viejo hasta que Omaf despliega y enciende la bandera en la
// consola de Firestore (o con el editor de banderas). Si el documento no existe
// o no se puede leer, todas quedan apagadas.
//
// Se lee UNA vez por sesión (1 lectura) y luego queda en vivo con un listener
// sobre ese único documento, para poder apagar una bandera sin recargar.
// La tabla de cuándo encender cada una está en PLAN-REFACTOR.md.
// ---------------------------------------------------------------------------
import { useSyncExternalStore } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { COL, DOC_FLAGS } from '../dominio/constantes';

export interface Flags {
  /** Fase 1.3 — alta/baja de usuarios por la callable gestionarUsuario. */
  usuariosPorServidor: boolean;
  /** Fase 1.6 — eliminarRegistro usa la callable eliminarConPapelera. */
  eliminarPorServidor: boolean;
  /** Fase 4.4 — el servidor escribe y mantiene los campos canónicos de las operaciones
   *  (crearOperacion + trigger operacionEscrita). Solo la leen las Cloud Functions. */
  canonicosEnServidor: boolean;
  /** Fase 5 — pagos y facturación por callables con transacción. */
  dineroPorServidor: boolean;
  /** Fase 5.7 — el peaje del puente lo cobra el servidor (trigger), no el navegador. */
  cobroPuenteEnServidor: boolean;
  /** Fase 5.6 — la tarjeta "Saldo Diesel" lee el saldo corriente del servidor (saldos_corrientes). */
  saldosCorrientes: boolean;
  /** Fase 6.2 — los nombres los propaga el servidor; se ocultan los botones de reparación. */
  propagacionEnServidor: boolean;
  /** Fase 7 — consultas por campos canónicos (requiere la migración de la Fase 4). */
  consultasCanonicas: boolean;
}

export const FLAGS_APAGADAS: Flags = {
  usuariosPorServidor: false,
  eliminarPorServidor: false,
  canonicosEnServidor: false,
  dineroPorServidor: false,
  cobroPuenteEnServidor: false,
  saldosCorrientes: false,
  propagacionEnServidor: false,
  consultasCanonicas: false,
};

let actuales: Flags = FLAGS_APAGADAS;
let escuchando = false;
let cancelar: (() => void) | null = null;
let cargadas = false;
const suscriptores = new Set<() => void>();
let resolverPrimeraCarga: (() => void) | null = null;
const primeraCarga = new Promise<void>((r) => { resolverPrimeraCarga = r; });

const normalizar = (datos: Record<string, unknown> | undefined): Flags => {
  const f = { ...FLAGS_APAGADAS };
  if (!datos) return f;
  (Object.keys(f) as (keyof Flags)[]).forEach((k) => { f[k] = datos[k] === true; });
  return f;
};

const marcarCargadas = (): void => {
  cargadas = true;
  resolverPrimeraCarga?.();
  resolverPrimeraCarga = null;
};

/** Empieza a escuchar configuracion/flags (idempotente). Lo llama App al iniciar sesión. */
export const iniciarFlags = (): void => {
  if (escuchando) return;
  escuchando = true;
  // ✅ V00443: como obtenerFlags, a los 3 s sin respuesta (sin red y sin caché) se da por
  //   "todas apagadas" para que useFlagsCargadas no deje pantallas esperando para siempre.
  setTimeout(() => {
    if (cargadas) return;
    marcarCargadas();
    suscriptores.forEach((fn) => fn());
  }, 3000);
  cancelar = onSnapshot(
    doc(db, COL.configuracion, DOC_FLAGS),
    (snap) => {
      actuales = normalizar(snap.exists() ? (snap.data() as Record<string, unknown>) : undefined);
      marcarCargadas();
      suscriptores.forEach((fn) => fn());
    },
    (err) => {
      console.error('[flags] No se pudo leer configuracion/flags; todas apagadas.', err);
      actuales = FLAGS_APAGADAS;
      escuchando = false; // permite reintentar (p. ej. al terminar de iniciar sesión)
      cancelar = null;
      marcarCargadas();
      suscriptores.forEach((fn) => fn());
    },
  );
};

/** Deja de escuchar (al cerrar sesión). */
export const detenerFlags = (): void => {
  cancelar?.();
  cancelar = null;
  escuchando = false;
  actuales = FLAGS_APAGADAS;
  suscriptores.forEach((fn) => fn());
};

/** Valor actual (para servicios fuera de React). Espera la primera lectura (máx. 3 s). */
export const obtenerFlags = async (): Promise<Flags> => {
  iniciarFlags();
  if (!cargadas) await Promise.race([primeraCarga, new Promise((r) => setTimeout(r, 3000))]);
  return actuales;
};

/** Valor actual sin esperar (puede ser el de "todas apagadas" antes de la primera lectura). */
export const flagsAhora = (): Flags => actuales;

const suscribir = (fn: () => void): (() => void) => {
  suscriptores.add(fn);
  return () => { suscriptores.delete(fn); };
};

/** Hook: banderas en vivo. */
export function useFlags(): Flags {
  return useSyncExternalStore(suscribir, flagsAhora, flagsAhora);
}

const cargadasAhora = (): boolean => cargadas;
/** ✅ V00443: true cuando ya llegó la primera lectura de las banderas (o falló). Para efectos que al
 *  montar eligen entre el camino viejo y el nuevo: sin esperar, empezarían por el viejo. */
export function useFlagsCargadas(): boolean {
  return useSyncExternalStore(suscribir, cargadasAhora, cargadasAhora);
}
