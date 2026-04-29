// src/features/operaciones/services/operacionesService.ts
import { doc, runTransaction, collection } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { generarReferencia } from '../../../utils/generarReferencia';

export const guardarOperacionSegura = async (operacionData: any) => {
  const counterRef = doc(db, 'counters', 'operaciones');
  const nuevaOperacionRef = doc(collection(db, 'operaciones'));

  try {
    await runTransaction(db, async (transaction) => {
      // ==========================================
      // FASE 1: TODAS LAS LECTURAS PRIMERO (READS)
      // ==========================================
      const counterDoc = await transaction.get(counterRef);
      
      let tipoSnap = null;
      if (operacionData.tipoOperacionId) {
        const tipoRef = doc(db, 'catalogo_tipo_operacion', operacionData.tipoOperacionId);
        tipoSnap = await transaction.get(tipoRef);
      }

      // ==========================================
      // FASE 2: PROCESAMIENTO EN MEMORIA
      // ==========================================
      let nuevoCorrelativo = 1;
      if (counterDoc.exists()) {
        nuevoCorrelativo = counterDoc.data().count + 1;
      }

      let prefijoOperacion = "OP"; // Fallback por defecto
      
      if (tipoSnap && tipoSnap.exists()) {
        const dataTipo = tipoSnap.data();
        prefijoOperacion = dataTipo.clave || dataTipo.acronimo || dataTipo.tipo_operacion || "OP";
      } else if (operacionData.tipoOperacion) {
        prefijoOperacion = operacionData.tipoOperacion;
      }

      // Generamos el ID único
      const referenciaFinal = generarReferencia(prefijoOperacion as any, nuevoCorrelativo);

      // ==========================================
      // FASE 3: TODAS LAS ESCRITURAS AL FINAL (WRITES)
      // ==========================================
      if (!counterDoc.exists()) {
        transaction.set(counterRef, { count: 1 });
      } else {
        transaction.update(counterRef, { count: nuevoCorrelativo });
      }

      transaction.set(nuevaOperacionRef, {
        ...operacionData,
        ref: referenciaFinal,
        createdAt: new Date().toISOString()
      });
    });

    return true;
  } catch (error) {
    console.error("Transacción fallida: ", error);
    throw error; 
  }
};