// src/features/operaciones/services/regresoStatusDatos.ts
// ---------------------------------------------------------------------------
// ✅ V00476 — REGRESAR EL ESTATUS (escritura). Hace lo mismo que marcar ese estatus en
// Operaciones Activas → Registrar movimiento:
//   · un horario nuevo en la bitácora (marcado `regreso`, con el estatus del que salió);
//   · status/statusNombre de la operación y el sueldo de Falso (mitad al entrar, completo al salir);
//   · si el estatus cobra el puente y aún no se cobró, el cobro (con la bandera
//     cobroPuenteEnServidor lo escribe el servidor) y la ventana "Esta unidad cruzó el puente…".
// Va en TRANSACCIÓN: relee la operación, no escribe si alguien ya le cambió el estatus y calcula
// el sueldo con el dato actual (no con la copia de la lista).
// ---------------------------------------------------------------------------
import { collection, doc, getDocs, query, runTransaction, where } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { obtenerFlags } from '../../../shared/data/flags';
import { puenteYaCobrado } from '../../../shared/dominio/cobroPuente';
import { notificarOperacionGuardada } from '../../../utils/operacionesBus';
import { registrarLog } from '../../../utils/logger';
import { ajusteOperadorPorStatus } from '../../../utils/sueldoFalso'; // ✅ V00511: sueldo y diesel de Falso
import { ajusteConvenioPorStatus } from './convenioFalso'; // ✅ V00511
import { avisarAjusteConvenio } from './convenioFalsoDatos'; // ✅ V00509
import type { AjusteConvenio } from './convenioFalso';
import { esStatusVerde, registrarVerdeAutomatico } from '../../../utils/historialCalculadoPuentes';
import { avisarCrucePuente, cobroPuenteDelPaso } from '../../puentes/services/crucePuente';
import { limpiarUndefined } from './formatosOperacion';
import { ORIGEN_REGRESO_STATUS } from './regresoStatus';
import type { HorarioResumen, StatusResuelto } from './regresoStatus';

type Datos = Record<string, unknown>;

/** Error con un mensaje para el usuario (la operación cambió o ya no existe). */
export class ErrorRegreso extends Error {}

/** id del DOCUMENTO de la operación (las listas pueden traer un campo `id` guardado). */
export const idDocOperacion = (op: Datos): string => String(op._docId || op.id || '').trim();
/** id con el que la bitácora guarda sus horarios (el mismo que usan Activas y Completados). */
const idBitacora = (op: Datos): string => String(op.id || op._docId || '').trim();

export const leerBitacora = async (op: Datos): Promise<HorarioResumen[]> => {
  const snap = await getDocs(query(collection(db, 'horarios'), where('operacionId', '==', idBitacora(op))));
  return snap.docs.map((d) => d.data() as HorarioResumen);
};

export interface ResultadoRegreso {
  /** Campos escritos en la operación. */
  cambios: Datos;
}

/**
 * Regresa la operación al estatus `destino` con la fecha y hora del movimiento (AAAA-MM-DDTHH:mm, hora local).
 * Lanza ErrorRegreso si la operación ya no existe o su estatus cambió desde que se abrió.
 */
export const regresarStatusOperacion = async (op: Datos, destino: StatusResuelto, fechaHora: string, modulo: string): Promise<ResultadoRegreso> => {
  const idDoc = idDocOperacion(op);
  if (!idDoc || !destino.id) throw new ErrorRegreso('No se pudo identificar la operación o el estatus.');
  let cobroCalculado: Datos = {};
  try { cobroCalculado = await cobroPuenteDelPaso(op, destino.id, destino.nombre, fechaHora); }
  catch (e) { console.warn('[regresoStatus] cobro del puente:', e); }
  const cobroEnServidor = (await obtenerFlags()).cobroPuenteEnServidor;
  const opRef = doc(db, 'operaciones', idDoc);

  const { cambios, cobro, anterior, convFalso } = await runTransaction(db, async (tx) => {
    const snap = await tx.get(opRef);
    if (!snap.exists()) throw new ErrorRegreso('La operación ya no existe (pudo eliminarse).');
    const actual = snap.data() as Datos;
    if (String(actual.status ?? '') !== String(op.status ?? '')) {
      throw new ErrorRegreso(`La operación cambió a "${String(actual.statusNombre || actual.status || 'otro estatus')}" mientras la veías. Ciérrala y vuelve a abrirla.`);
    }
    const cobroVigente = puenteYaCobrado(actual) ? {} : cobroCalculado;
    // ✅ V00509 · V00511: con el dato actual (no la copia de la lista): al entrar a Falso, cliente y
    //   proveedor al 50%; al salir, regresan al 100%.
    const ajusteConv: AjusteConvenio = ajusteConvenioPorStatus(actual, destino.nombre, String(actual.statusNombre ?? ''));
    const campos = limpiarUndefined({
      status: destino.id,
      statusNombre: destino.nombre,
      ...(cobroEnServidor ? {} : cobroVigente),
      ...ajusteOperadorPorStatus(actual, destino.nombre),
      ...ajusteConv.cambios,
    }) as Datos;
    tx.set(doc(collection(db, 'horarios')), limpiarUndefined({
      operacionId: idBitacora(op),
      status: destino.id,
      statusNombre: destino.nombre,
      fechaHora,
      registradoEn: new Date().toISOString(),
      regreso: true,
      statusAnterior: String(actual.status ?? ''),
      statusAnteriorNombre: String(actual.statusNombre ?? ''),
    }));
    tx.update(opRef, campos);
    return { cambios: campos, cobro: cobroVigente, anterior: String(actual.statusNombre || actual.status || '(sin estatus)'), convFalso: ajusteConv };
  });
  avisarAjusteConvenio(convFalso);

  const ref = String(op.ref || idDoc);
  registrarLog(modulo, 'Edición', `Regresó la operación ${ref} de "${anterior}" a "${destino.nombre}" (fecha del movimiento: ${fechaHora})`).catch(() => {});
  notificarOperacionGuardada(idDoc, { ...op, ...cambios, _docId: idDoc }, ORIGEN_REGRESO_STATUS, Object.keys(cambios));
  avisarCrucePuente(op, cobro);
  if (esStatusVerde(destino.nombre)) void registrarVerdeAutomatico({ ...op, ...cambios }, destino.nombre, fechaHora);
  return { cambios };
};
