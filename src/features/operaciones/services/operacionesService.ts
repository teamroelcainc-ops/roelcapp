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
// UNICIDAD (sin saltos ni repetidos, incluso con varias personas capturando a
// la vez): el incremento del contador y la escritura de la operación ocurren
// DENTRO DE LA MISMA `runTransaction`. La transacción de Firestore es atómica
// y reintenta automáticamente si dos personas chocan en el mismo contador, de
// modo que cada quien obtiene un número distinto, consecutivo, sin huecos.
//
// Formato de referencia: <PREFIJO>-<DDMMYY>-<NNN>  (ej. TR-260626-001)

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
  // Fecha del día (DDMMYY) para la llave del contador y para la referencia.
  const ddmmyy = fechaDDMMYY();

  // Prefijo del tipo (TR/LO/FL/OP) resuelto ANTES de la transacción.
  const prefijoCorto = await resolverPrefijoCorto(operacionData);

  // ✅ Contador POR TIPO Y POR DÍA: cada tipo arranca su propio 001.
  //    Ej.: operaciones_TR_260626, operaciones_LO_260626, operaciones_FL_260626.
  const counterRef = doc(db, 'counters', `operaciones_${prefijoCorto}_${ddmmyy}`);
  const nuevaOperacionRef = doc(collection(db, 'operaciones'));

  try {
    let referenciaFinal = '';

    await runTransaction(db, async (transaction) => {
      // ===== LECTURA: solo el contador de este tipo/día =====
      const counterDoc = await transaction.get(counterRef);

      // Faltante = 0  →  el primero del día SIEMPRE es 1 (arregla "empieza en 2").
      const actual = counterDoc.exists() ? (Number(counterDoc.data().count) || 0) : 0;
      const nuevoCorrelativo = actual + 1;

      // Referencia con prefijo del tipo, fecha del día y consecutivo del tipo.
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