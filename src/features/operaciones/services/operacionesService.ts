// src/features/operaciones/services/operacionesService.ts
//
// Guarda una operación de forma SEGURA generando una referencia única.
//
// CAMBIO CLAVE (solicitado): el consecutivo ahora es IRREPETIBLE POR DÍA.
//   · Antes: un único contador global `counters/operaciones` (el número no
//     reiniciaba por día).
//   · Ahora: un contador por día `counters/operaciones_<DDMMYY>`. La
//     `runTransaction` de Firestore es atómica y reintenta si hay conflicto,
//     así que aunque varias personas guarden EXACTAMENTE al mismo tiempo,
//     cada una obtiene un número distinto. Nunca se repite.
//
// Formato de referencia: <PREFIJO>-<DDMMYY>-<NNN>  (ej. TR-160626-001)

import { doc, runTransaction, collection } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { generarReferencia, fechaDDMMYY } from '../../../utils/generarReferencia';

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

export const guardarOperacionSegura = async (operacionData: any) => {
  // ✅ Contador POR DÍA: la llave incluye la fecha (DDMMYY) del momento de guardar.
  const ddmmyy = fechaDDMMYY();
  const counterRef = doc(db, 'counters', `operaciones_${ddmmyy}`);
  const nuevaOperacionRef = doc(collection(db, 'operaciones'));

  // Si ya tenemos el tipo de operación en caché, evitamos leer el catálogo.
  const tipoIdEnOperacion = operacionData.tipoOperacionId;
  const tipoCacheado = tipoIdEnOperacion ? tipoOperacionCache.get(tipoIdEnOperacion) : null;

  try {
    let referenciaFinal = '';

    await runTransaction(db, async (transaction) => {
      // ===== FASE 1: LECTURAS =====
      const counterDoc = await transaction.get(counterRef);

      let tipoSnap = null;
      if (tipoIdEnOperacion && !tipoCacheado) {
        const tipoRef = doc(db, 'catalogo_tipo_operacion', tipoIdEnOperacion);
        tipoSnap = await transaction.get(tipoRef);
      }

      // ===== FASE 2: PROCESAMIENTO EN MEMORIA =====
      // Consecutivo del día: si el doc del día no existe, empieza en 1.
      let nuevoCorrelativo = 1;
      if (counterDoc.exists()) {
        nuevoCorrelativo = (counterDoc.data().count || 0) + 1;
      }

      let prefijoOperacion = 'OP'; // Fallback
      if (tipoCacheado) {
        prefijoOperacion = tipoCacheado.clave || tipoCacheado.acronimo || tipoCacheado.tipo_operacion || 'OP';
      } else if (tipoSnap && tipoSnap.exists()) {
        const dataTipo = tipoSnap.data();
        prefijoOperacion = dataTipo.clave || dataTipo.acronimo || dataTipo.tipo_operacion || 'OP';
        if (tipoIdEnOperacion) {
          tipoOperacionCache.set(tipoIdEnOperacion, {
            clave: dataTipo.clave,
            acronimo: dataTipo.acronimo,
            tipo_operacion: dataTipo.tipo_operacion,
          });
        }
      } else if (operacionData.tipoOperacion) {
        prefijoOperacion = operacionData.tipoOperacion;
      } else if (operacionData.tipoOperacionNombre) {
        prefijoOperacion = operacionData.tipoOperacionNombre;
      }

      // Referencia con fecha del día y consecutivo del día.
      referenciaFinal = generarReferencia(prefijoOperacion as any, nuevoCorrelativo, ddmmyy);

      // ===== FASE 3: ESCRITURAS =====
      if (!counterDoc.exists()) {
        transaction.set(counterRef, { count: 1, fecha: ddmmyy });
      } else {
        transaction.update(counterRef, { count: nuevoCorrelativo });
      }

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