// src/features/operaciones/services/operacionesService.ts
//
// Guarda una operación de forma SEGURA generando una referencia única.
//
// CAMBIO CLAVE (solicitado): el consecutivo ahora es IRREPETIBLE POR DÍA y
// ADEMÁS SEPARADO POR TIPO DE OPERACIÓN (Transfer / Logística / Fletes / …).
//
//   · Antes: un único contador por día `counters/operaciones_<DDMMYY>`. Como
//     mezclaba TODOS los tipos, al capturar una Transfer y luego una Logística,
//     la Logística arrancaba en 2 (heredaba el conteo de la Transfer). Por eso
//     "empezaba en 2" y no reiniciaba por tipo.
//   · Ahora: un contador POR TIPO Y POR DÍA:
//        counters/operaciones_TR_<DDMMYY>   (Transfer)
//        counters/operaciones_LO_<DDMMYY>   (Logística)
//        counters/operaciones_FL_<DDMMYY>   (Fletes)
//     Así cada tipo lleva su propio conteo y SIEMPRE empieza en 001.
//
// ✅ CAMBIO NUEVO (solicitado): el DDMMYY de la referencia se toma de la
//    FECHA DE SERVICIO de la operación, NO de la fecha en que se guarda.
//    Ej.: si fechaServicio = 27/06/2026  →  la ref es  TR-270626-###.
//    El consecutivo ### queda agrupado por (tipo, fecha de servicio), de modo
//    que cada fecha de servicio lleva su propio 001, 002, 003… sin saltos ni
//    repetidos (lo garantiza la transacción atómica del contador). Si por
//    alguna razón la operación no trae fecha de servicio, se usa la fecha de
//    hoy como respaldo.
//
// UNICIDAD (sin saltos ni repetidos, incluso con varias personas capturando a
// la vez): el incremento del contador y la escritura de la operación ocurren
// DENTRO DE LA MISMA `runTransaction`. La transacción de Firestore es atómica
// y reintenta automáticamente si dos personas chocan en el mismo contador, de
// modo que cada quien obtiene un número distinto, consecutivo, sin huecos.
//
// Formato de referencia: <PREFIJO>-<DDMMYY>-<NNN>  (ej. TR-270626-001)

import { doc, getDoc, runTransaction, collection } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { generarReferencia, fechaDDMMYY, prefijoTipoOperacion } from '../../../utils/generarReferencia';

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
// ✅ NUEVO: convierte la FECHA DE SERVICIO a DDMMYY para la referencia.
// El formulario entrega la fecha como ISO `YYYY-MM-DD` (input type="date"),
// pero también se aceptan respaldos como `DD/MM/YYYY` o `MM/DD/YYYY` por si
// algún registro llega con otro formato. Devuelve null si no se puede parsear
// (en ese caso el guardado usará la fecha de hoy como respaldo).
// ──────────────────────────────────────────────────────────────────────
const ddmmyyDeFechaServicio = (fechaServicio: any): string | null => {
  const raw = String(fechaServicio || '').trim();
  if (!raw) return null;

  let y = '', m = '', d = '';

  // Caso principal: ISO `YYYY-MM-DD` (lo que manda el input type="date").
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    y = iso[1]; m = iso[2]; d = iso[3];
  } else {
    // Respaldo: separadores / - . — decidimos el orden por el primer bloque.
    const partes = raw.split(/[\/\-.]/).map((s) => s.trim()).filter(Boolean);
    if (partes.length >= 3) {
      if (partes[0].length === 4) {
        // YYYY/MM/DD
        y = partes[0]; m = partes[1]; d = partes[2];
      } else {
        // DD/MM/YYYY (formato latino, el que se usa en Roelca)
        d = partes[0]; m = partes[1]; y = partes[2];
      }
    }
  }

  if (!y || !m || !d) return null;

  const dd = String(d).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  const yy = String(y).slice(-2).padStart(2, '0');

  // Validación mínima para no generar referencias con fechas imposibles.
  const nd = Number(dd), nm = Number(mm);
  if (!Number.isFinite(nd) || !Number.isFinite(nm) || nd < 1 || nd > 31 || nm < 1 || nm > 12) {
    return null;
  }

  return `${dd}${mm}${yy}`;
};

// ──────────────────────────────────────────────────────────────────────
// Resuelve el PREFIJO corto (TR / LO / FL / OP) del tipo de operación ANTES de
// la transacción. Necesitamos el prefijo para construir la llave del contador
// específica de ese tipo. El orden de resolución es:
//   1) Caché de sesión.
//   2) Catálogo `catalogo_tipo_operacion` (lectura normal, fuera de la tx).
//   3) Nombre desnormalizado que ya viene en la propia operación.
// En todos los casos se normaliza con prefijoTipoOperacion() para terminar en
// TR / LO / FL / OP.
// ──────────────────────────────────────────────────────────────────────
const resolverPrefijoCorto = async (operacionData: any): Promise<string> => {
  const tipoId = operacionData.tipoOperacionId;

  // 1) Caché
  const cacheado = tipoId ? tipoOperacionCache.get(tipoId) : null;
  if (cacheado) {
    return prefijoTipoOperacion(
      cacheado.clave || cacheado.acronimo || cacheado.tipo_operacion || 'OP'
    );
  }

  // 2) Catálogo (fuera de la transacción: es solo dato de referencia, no afecta
  //    la unicidad, que la garantiza la transacción del contador).
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
      // Si falla la lectura del catálogo, caemos al respaldo por nombre.
      console.warn('No se pudo leer catalogo_tipo_operacion; uso respaldo por nombre.', e);
    }
  }

  // 3) Respaldo: nombre desnormalizado que ya trae la operación.
  if (operacionData.tipoOperacionNombre) return prefijoTipoOperacion(operacionData.tipoOperacionNombre);
  if (operacionData.tipoOperacion)       return prefijoTipoOperacion(operacionData.tipoOperacion);

  return 'OP';
};

export const guardarOperacionSegura = async (operacionData: any) => {
  // ✅ DDMMYY tomado de la FECHA DE SERVICIO de la operación (con respaldo a hoy).
  //    Esto hace que la referencia cambie según la fecha de servicio capturada.
  const ddmmyy = ddmmyyDeFechaServicio(operacionData.fechaServicio) || fechaDDMMYY();

  // Prefijo del tipo (TR/LO/FL/OP) resuelto ANTES de la transacción.
  const prefijoCorto = await resolverPrefijoCorto(operacionData);

  // ✅ Contador POR TIPO Y POR FECHA DE SERVICIO: cada (tipo, fecha) arranca en 001.
  //    Ej.: operaciones_TR_270626, operaciones_LO_270626, operaciones_FL_270626.
  const counterRef = doc(db, 'counters', `operaciones_${prefijoCorto}_${ddmmyy}`);
  const nuevaOperacionRef = doc(collection(db, 'operaciones'));

  try {
    let referenciaFinal = '';

    await runTransaction(db, async (transaction) => {
      // ===== LECTURA: solo el contador de este tipo/fecha de servicio =====
      const counterDoc = await transaction.get(counterRef);

      // Faltante = 0  →  el primero de la fecha SIEMPRE es 1 (sin saltos ni repetidos).
      const actual = counterDoc.exists() ? (Number(counterDoc.data().count) || 0) : 0;
      const nuevoCorrelativo = actual + 1;

      // Referencia con prefijo del tipo, DDMMYY de la fecha de servicio y consecutivo.
      referenciaFinal = generarReferencia(prefijoCorto, nuevoCorrelativo, ddmmyy);

      // ===== ESCRITURAS (misma transacción → sin saltos ni duplicados) =====
      // merge:true funciona exista o no el doc; siempre deja el valor exacto.
      transaction.set(
        counterRef,
        { count: nuevoCorrelativo, prefijo: prefijoCorto, fecha: ddmmyy },
        { merge: true }
      );

      transaction.set(nuevaOperacionRef, {
        ...operacionData,
        ref: referenciaFinal,
        createdAt: new Date().toISOString(),
      });
    });

    return {
      success: true,
      id: nuevaOperacionRef.id,
      ref: referenciaFinal,
    };
  } catch (error: any) {
    console.error('Transacción fallida: ', error);

    if (esErrorDeCuota(error)) {
      const horaActual = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
      throw new Error(
        `⚠️ CUOTA DE FIRESTORE AGOTADA (${horaActual})\n\n` +
        `Tu proyecto superó el límite gratuito diario de lecturas/escrituras.\n\n` +
        `Soluciones:\n` +
        `  • La cuota se reinicia automáticamente cada día a las 2 AM (hora México)\n` +
        `  • Activa el plan Blaze en Firebase Console (sigue siendo gratis hasta cierto uso)\n\n` +
        `Por ahora no se puede guardar la operación. Intenta más tarde.`
      );
    }

    throw error;
  }
};

// Limpia la caché de tipos de operación (p. ej. al cerrar sesión o editar el catálogo).
export const limpiarCacheTipoOperacion = () => tipoOperacionCache.clear();