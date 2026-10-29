// src/features/operaciones/services/convenioFalsoDatos.ts
// ---------------------------------------------------------------------------
// ✅ V00509 · V00511 — LECTURA para el cobro de Falso (la regla está en convenioFalso.ts). Lo usan
// todos los lugares que cambian el estatus de una operación (los mismos que aplican el sueldo de
// Falso): Operaciones Activas, Canceladas, el formulario y Mis Operaciones. Regresar estatus lo
// calcula dentro de su transacción (regresoStatusDatos.ts).
//   · Relee la operación (no la copia de la lista): decide montos.
//   · Nunca detiene el cambio de estatus: si algo falla, devuelve un aviso y no cambia los montos.
// V00511: el Falso ya no busca el convenio Falso del cliente (se cobra al 50% el mismo convenio),
// así que ya no lee catálogos.
// ---------------------------------------------------------------------------
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { avisar } from '../../../shared/data/avisos';
import { ajusteConvenioPorStatus, cambiaFalso, SIN_AJUSTE } from './convenioFalso';
import type { AjusteConvenio } from './convenioFalso';

type Datos = Record<string, unknown>;

const FALLO: AjusteConvenio = {
  cambios: {}, tipo: 'alerta',
  mensaje: 'No se pudo leer la operación: el cobro de Falso al 50% no se aplicó. Ajusta los montos en Editar.',
};

/**
 * Para los cambios de estatus que escriben con un batch: relee la operación `idDoc` y calcula el
 * ajuste. `pendientes` = lo que la misma escritura va a cambiar (el formulario: sus montos) y se
 * toma en cuenta para decidir.
 */
export const ajusteConvenioAlCambiarStatus = async (idDoc: string, statusNuevo: string, pendientes: Datos = {}): Promise<AjusteConvenio> => {
  try {
    const snap = await getDoc(doc(db, 'operaciones', idDoc));
    if (!snap.exists()) return SIN_AJUSTE;
    const guardada = snap.data() as Datos;
    const anterior = String(guardada.statusNombre ?? '');
    if (!cambiaFalso(anterior, statusNuevo)) return SIN_AJUSTE;
    return ajusteConvenioPorStatus({ ...guardada, ...pendientes }, statusNuevo, anterior);
  } catch (e) {
    console.error('[convenioFalso] No se pudo calcular el cobro de Falso:', e);
    return FALLO;
  }
};

/** Aviso flotante (y en la campana) con lo que pasó con los montos. */
export const avisarAjusteConvenio = (a: AjusteConvenio): void => {
  if (!a.tipo || !a.mensaje) return;
  avisar({ tipo: a.tipo, titulo: a.tipo === 'info' ? 'Falso al 50%' : 'Revisa los montos de Falso', texto: a.mensaje });
};
