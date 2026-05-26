// src/features/operaciones/services/operacionesService.ts
import { doc, runTransaction, collection } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { generarReferencia } from '../../../utils/generarReferencia';

// ✅ Caché en memoria del tipo de operación durante la sesión.
// Como el tipo_operacion casi nunca cambia, no tiene sentido leerlo en cada guardado.
// Esto reduce 1 lectura por cada operación guardada después de la primera del mismo tipo.
const tipoOperacionCache = new Map<string, { clave?: string; acronimo?: string; tipo_operacion?: string }>();

// ✅ Helper: detectar si el error es por cuota agotada y dar mensaje claro al usuario.
const esErrorDeCuota = (error: any): boolean => {
  const msg = String(error?.message || error?.code || error || '').toLowerCase();
  return msg.includes('resource-exhausted')
      || msg.includes('quota')
      || msg.includes('429')
      || msg.includes('too many requests');
};

export const guardarOperacionSegura = async (operacionData: any) => {
  const counterRef = doc(db, 'counters', 'operaciones');
  const nuevaOperacionRef = doc(collection(db, 'operaciones'));

  // ✅ Si ya tenemos el tipo de operación en caché, lo usamos sin tocar Firestore.
  // Esto evita la lectura del catálogo_tipo_operacion en la transacción cuando sea posible.
  const tipoIdEnOperacion = operacionData.tipoOperacionId;
  const tipoCacheado = tipoIdEnOperacion ? tipoOperacionCache.get(tipoIdEnOperacion) : null;

  try {
    let referenciaFinal: string = '';

    await runTransaction(db, async (transaction) => {
      // ==========================================
      // FASE 1: LECTURAS (lo menos posible)
      // ==========================================
      const counterDoc = await transaction.get(counterRef);

      // Solo leemos el catálogo si no está en caché Y tenemos un id de tipo
      let tipoSnap = null;
      if (tipoIdEnOperacion && !tipoCacheado) {
        const tipoRef = doc(db, 'catalogo_tipo_operacion', tipoIdEnOperacion);
        tipoSnap = await transaction.get(tipoRef);
      }

      // ==========================================
      // FASE 2: PROCESAMIENTO EN MEMORIA
      // ==========================================
      let nuevoCorrelativo = 1;
      if (counterDoc.exists()) {
        nuevoCorrelativo = (counterDoc.data().count || 0) + 1;
      }

      let prefijoOperacion = "OP"; // Fallback por defecto

      if (tipoCacheado) {
        // Caché hit: usamos la versión guardada en memoria
        prefijoOperacion = tipoCacheado.clave || tipoCacheado.acronimo || tipoCacheado.tipo_operacion || "OP";
      } else if (tipoSnap && tipoSnap.exists()) {
        const dataTipo = tipoSnap.data();
        prefijoOperacion = dataTipo.clave || dataTipo.acronimo || dataTipo.tipo_operacion || "OP";
        // Guardamos en caché para los siguientes guardados de la sesión
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

      // Generamos el ID único
      referenciaFinal = generarReferencia(prefijoOperacion as any, nuevoCorrelativo);

      // ==========================================
      // FASE 3: ESCRITURAS
      // ==========================================
      if (!counterDoc.exists()) {
        transaction.set(counterRef, { count: 1 });
      } else {
        transaction.update(counterRef, { count: nuevoCorrelativo });
      }

      transaction.set(nuevaOperacionRef, {
        ...operacionData,
        ref: referenciaFinal,
        createdAt: new Date().toISOString(),
      });
    });

    // ✅ Devolvemos info útil del guardado (no solo true) por si el caller la quiere
    return {
      success: true,
      id: nuevaOperacionRef.id,
      ref: referenciaFinal,
    };
  } catch (error: any) {
    console.error("Transacción fallida: ", error);

    // ✅ Si el error es por cuota, lanzamos un mensaje específico y entendible
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

    // Otros errores: los relanzamos tal cual
    throw error;
  }
};

// ✅ Helper exportado para limpiar el caché si hace falta (por ejemplo al cerrar sesión
// o si el usuario edita el catálogo de tipos de operación).
export const limpiarCacheTiposOperacion = () => {
  tipoOperacionCache.clear();
};