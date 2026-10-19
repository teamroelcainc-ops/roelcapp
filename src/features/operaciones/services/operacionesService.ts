// src/features/operaciones/services/operacionesService.ts
//
// Guarda una operación delegando la asignación del CONSECUTIVO a una Cloud
// Function (`crearOperacion`), que lo genera de forma ATÓMICA en el backend.
// Esto elimina de raíz los duplicados/brincos que ocurrían al calcularlo en el
// cliente (condición de carrera + contador desincronizado).
//
// Este archivo SOLO calcula, con tus utilidades de siempre:
//   · el PREFIJO (TR/LO/FL/OP) del tipo de operación, y
//   · la clave de fecha DDMMYY a partir de la FECHA DE SERVICIO,
// y se los pasa a la función. El número, el formato final de la referencia y la
// escritura del documento ocurren en el backend (ver functions/src/index.ts).
//
// Formato de referencia (idéntico al anterior): <PREFIJO>-<DDMMYY>-<NNN>
//   ej. TR-270626-001

import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getApp } from 'firebase/app';
import { db } from '../../../config/firebase';
import { fechaDDMMYY, prefijoTipoOperacion } from '../../../utils/generarReferencia';
import { PREFIJO_PRUEBA } from '../../../utils/operacionPrueba';
import { registrarLog } from '../../../utils/logger';
import { codigoCallable, conReintentos, ErrorTrasReintentos, esFalloDeConexion } from './reintentosCallable';

// La región DEBE coincidir con la del deploy de la función (us-central1).
const functions = getFunctions(getApp(), 'us-central1');

// Caché de sesión del tipo de operación (evita releer el catálogo en cada guardado).
const tipoOperacionCache = new Map<string, { clave?: string; acronimo?: string; tipo_operacion?: string }>();

// Detecta si el error es por cuota de Firestore agotada (mensaje claro al usuario).
const esErrorDeCuota = (error: any): boolean => {
  const msg = String(error?.message || error?.code || error || '').toLowerCase();
  return msg.includes('resource-exhausted')
      || msg.includes('quota')
      || msg.includes('429')
      || msg.includes('too many requests');
};

// ──────────────────────────────────────────────────────────────────────
// Convierte la FECHA DE SERVICIO a DDMMYY para la referencia.
// El formulario entrega la fecha como ISO `YYYY-MM-DD` (input type="date"),
// pero también se aceptan respaldos como `DD/MM/YYYY` o `MM/DD/YYYY`. Devuelve
// null si no se puede parsear (en ese caso se usará la fecha de hoy).
// ──────────────────────────────────────────────────────────────────────
const ddmmyyDeFechaServicio = (fechaServicio: any): string | null => {
  const raw = String(fechaServicio || '').trim();
  if (!raw) return null;

  let y = '', m = '', d = '';

  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    y = iso[1]; m = iso[2]; d = iso[3];
  } else {
    const partes = raw.split(/[\/\-.]/).map((s) => s.trim()).filter(Boolean);
    if (partes.length >= 3) {
      if (partes[0].length === 4) {
        y = partes[0]; m = partes[1]; d = partes[2];
      } else {
        d = partes[0]; m = partes[1]; y = partes[2];
      }
    }
  }

  if (!y || !m || !d) return null;

  const dd = String(d).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  const yy = String(y).slice(-2).padStart(2, '0');

  const nd = Number(dd), nm = Number(mm);
  if (!Number.isFinite(nd) || !Number.isFinite(nm) || nd < 1 || nd > 31 || nm < 1 || nm > 12) {
    return null;
  }

  return `${dd}${mm}${yy}`;
};

// ──────────────────────────────────────────────────────────────────────
// Resuelve el PREFIJO corto (TR / LO / FL / OP) del tipo de operación.
// ──────────────────────────────────────────────────────────────────────
const resolverPrefijoCorto = async (operacionData: any): Promise<string> => {
  const tipoId = operacionData.tipoOperacionId;

  const cacheado = tipoId ? tipoOperacionCache.get(tipoId) : null;
  if (cacheado) {
    return prefijoTipoOperacion(
      cacheado.clave || cacheado.acronimo || cacheado.tipo_operacion || 'OP'
    );
  }

  if (tipoId) {
    try {
      const tipoSnap = await getDoc(doc(db, 'catalogo_tipo_operacion', tipoId));
      if (tipoSnap.exists()) {
        const dataTipo = tipoSnap.data() as any;
        tipoOperacionCache.set(tipoId, {
          clave: dataTipo.clave,
          acronimo: dataTipo.acronimo,
          tipo_operacion: dataTipo.tipo_operacion,
        });
        return prefijoTipoOperacion(
          dataTipo.clave || dataTipo.acronimo || dataTipo.tipo_operacion || 'OP'
        );
      }
    } catch (e) {
      console.warn('No se pudo leer catalogo_tipo_operacion; uso respaldo por nombre.', e);
    }
  }

  if (operacionData.tipoOperacionNombre) return prefijoTipoOperacion(operacionData.tipoOperacionNombre);
  if (operacionData.tipoOperacion)       return prefijoTipoOperacion(operacionData.tipoOperacion);

  return 'OP';
};

/**
 * ✅ V00463: id de UN envío del formulario. El formulario lo conserva entre sus
 * "Guardar" hasta que la operación se guarda: si un intento sí llegó al servidor
 * pero la respuesta se perdió, el siguiente recibe esa misma operación (no duplica).
 */
export const nuevoIdEnvioOperacion = (): string =>
  (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Campos que solo pone el servidor al crear (no se reescriben al completar una operación que ya existía). */
const CAMPOS_DE_CONTROL = ['id', '_docId', 'ref', 'refPrefijo', 'refConsecutivo', 'creadoPor', 'createdAt'];

// ──────────────────────────────────────────────────────────────────────
// Guarda la operación: calcula prefijo + fecha y delega el número atómico
// a la Cloud Function `crearOperacion`. Devuelve { success, id, ref }.
// ✅ V00463: reintenta sola los fallos de conexión ("internal") con el MISMO
//   clienteOpId (la función no duplica) y, si aun así no se pudo, explica qué pasó.
// ──────────────────────────────────────────────────────────────────────
export const guardarOperacionSegura = async (operacionData: any, opciones: { clienteOpId?: string } = {}) => {
  // DDMMYY tomado de la FECHA DE SERVICIO (con respaldo a hoy) — igual que antes.
  const ddmmyy = ddmmyyDeFechaServicio(operacionData.fechaServicio) || fechaDDMMYY();

  // Prefijo del tipo (TR/LO/FL/OP) — igual que antes.
  const prefijoLinea = await resolverPrefijoCorto(operacionData);
  // ✅ V00380: operación de PRUEBA → PR.TR / PR.FL / PR.LO… con su propio contador
  //   (la Cloud Function acepta cualquier prefijo y cuenta por prefijo+fecha),
  //   así las pruebas NO consumen consecutivos reales.
  const prefijoCorto = operacionData?.esPrueba === true ? `${PREFIJO_PRUEBA}${prefijoLinea}` : prefijoLinea;

  // Id único por envío: si hay un reintento de red, la función NO duplica.
  const clienteOpId = opciones.clienteOpId || nuevoIdEnvioOperacion();

  try {
    // 30 s por intento (lo normal es 1–3 s; 10 s con la función "fría"). El SDK espera 70 s.
    const crearOperacion = httpsCallable(functions, 'crearOperacion', { timeout: 30000 });
    const { valor: res, intentos, ultimoCodigo } = await conReintentos(() => crearOperacion({
      operacion: operacionData,
      prefijo: prefijoCorto,
      ddmmyy,
      clienteOpId,
    }));

    const { id, ref, version, yaExistia } = (res?.data || {}) as { id: string; ref: string; version?: string; yaExistia?: boolean };
    // ✅ Diagnóstico del consecutivo: confirma qué versión de la Cloud Function
    //   respondió (v2.1 = la que corrige duplicados/saltos). Si esto no aparece
    //   o dice otra cosa, la función desplegada es VIEJA.
    console.info(`[consecutivo] ref=${ref} · función=${version || 'v1/desconocida (¡desplegar!)'}${yaExistia ? ' · reutilizada por idempotencia' : ''}`);
    if (!id) {
      throw new Error('La función no devolvió un id de operación válido.');
    }
    // ✅ V00463: ya existía desde un "Guardar" anterior cuya respuesta no llegó (el mismo envío
    //   del formulario): se le aplica lo capturado ahora, por si se cambió algo antes de reintentar.
    if (yaExistia && intentos === 1 && opciones.clienteOpId) {
      const datos: Record<string, unknown> = { ...operacionData };
      CAMPOS_DE_CONTROL.forEach((k) => { delete datos[k]; });
      Object.keys(datos).forEach((k) => { if (datos[k] === undefined) delete datos[k]; });
      await updateDoc(doc(db, 'operaciones', id), datos);
    }
    // Rastro para medir cuántas veces pasa (Historial de actividad).
    if (intentos > 1 || yaExistia) {
      registrarLog('Operaciones', 'Reintento', `Se guardó ${ref} ${yaExistia ? 'tras un envío anterior cuya respuesta no llegó' : `al intento ${intentos}`} (falló por: ${ultimoCodigo || 'conexión'}).`).catch(() => {});
    }
    return { success: true, id, ref };
  } catch (errorEnvuelto: unknown) {
    // ✅ V00463: el error original y cuántos intentos/segundos tomó.
    const tras = errorEnvuelto instanceof ErrorTrasReintentos ? errorEnvuelto : null;
    const error = (tras ? tras.causa : errorEnvuelto) as { message?: string; code?: string } | null;
    const intentos = tras?.intentos ?? 1;
    const segundos = tras?.segundos ?? 0;
    console.error('Guardado de operación fallido: ', error, { intentos, segundos, enLinea: typeof navigator !== 'undefined' ? navigator.onLine : null });

    // ✅ V00463: "internal" = no llegó respuesta del servidor (conexión cortada, espera agotada o
    //   rechazo antes de la función). Se explica en español y queda en el Historial de actividad.
    if (esFalloDeConexion(error)) {
      const codigo = codigoCallable(error) || 'internal';
      const sinInternet = typeof navigator !== 'undefined' && navigator.onLine === false;
      // "INTERNAL" en mayúsculas = la función sí contestó pero falló sin mensaje (queda en sus registros).
      const enLaFuncion = String(error?.message ?? '') === 'INTERNAL';
      const que = enLaFuncion ? 'error de la función crearOperacion' : 'sin respuesta del servidor';
      registrarLog('Operaciones', 'Error', `No se pudo guardar una operación nueva (${prefijoCorto}-${ddmmyy}): ${que} · ${codigo} · ${intentos} intento(s) en ${segundos} s${sinInternet ? ' · el equipo estaba sin internet' : ''}.`).catch(() => {});
      throw new Error(
        (enLaFuncion ? 'El servidor tuvo un error y no pudo guardar la operación ' : 'No se pudo comunicar con el servidor para guardar la operación ') +
        `(se intentó ${intentos} ${intentos === 1 ? 'vez' : 'veces'} en ${segundos} s${sinInternet ? '; el equipo está sin internet' : ''}).\n\n` +
        `Tus datos siguen en el formulario: revisa la conexión y presiona Guardar otra vez. ` +
        `No se duplica: si algún intento sí llegó, se usa esa misma operación.\n\n` +
        `Detalle técnico: ${enLaFuncion ? 'INTERNAL' : codigo}`,
      );
    }

    if (esErrorDeCuota(error)) {
      const horaActual = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
      throw new Error(
        `⚠️ CUOTA DE FIRESTORE AGOTADA (${horaActual})\n\n` +
        `Tu proyecto superó el límite gratuito diario de lecturas/escrituras.\n\n` +
        `Soluciones:\n` +
        `  • La cuota se reinicia automáticamente cada día a las 2 AM (hora México)\n` +
        `  • Revisa el uso en Firebase Console\n\n` +
        `Por ahora no se puede guardar la operación. Intenta más tarde.`
      );
    }

    // El mensaje de la Cloud Function (HttpsError) viene en error.message.
    throw new Error(error?.message || 'No se pudo guardar la operación.');
  }
};

// Limpia la caché de tipos de operación (p. ej. al cerrar sesión o editar el catálogo).
export const limpiarCacheTipoOperacion = () => tipoOperacionCache.clear();