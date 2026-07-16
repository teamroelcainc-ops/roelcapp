import { doc, runTransaction, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../../../config/firebase';

// ✅ Extrae el consecutivo (última parte numérica) de un folio existente.
const consecutivoDe = (numeroGasto: any): number => {
  const parte = String(numeroGasto || '').split('-').pop() || '';
  const n = parseInt(parte.replace(/\D/g, ''), 10);
  return isNaN(n) ? 0 : n;
};

export const guardarMttoSeguro = async (mttoData: any) => {
  // Quitamos campos que no deben persistirse (id residual de ediciones previas)
  const { id: _idResidual, ...dataLimpia } = mttoData;

  // ✅ FECHA POR STRING (sin new Date('YYYY-MM-DD')): evita el desfase de zona
  //    horaria que en husos negativos (MX/US) regresaba el día ANTERIOR.
  //    Formato DDMMYY, idéntico al que muestra el formulario y el dashboard.
  const fechaStr = String(dataLimpia.fecha || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const [yyyy = '', mm = '01', dd = '01'] = fechaStr.split('-');
  const dateString = `${dd.padStart(2, '0')}${mm.padStart(2, '0')}${String(yyyy).slice(-2)}`;

  // ✅ PRE-CONSULTA DE AUTO-REPARACIÓN: máximo consecutivo ya usado para esa
  //    fecha (cubre folios legacy MTTO-MMDDAAAA-XXX y contadores desalineados).
  //    Así el contador nunca puede emitir un consecutivo repetido para el día.
  let maxExistente = 0;
  try {
    const snap = await getDocs(query(collection(db, 'gastos_mtto'), where('fecha', '==', fechaStr)));
    snap.forEach((d) => {
      const n = consecutivoDe(d.data()?.numeroGasto);
      if (n > maxExistente) maxExistente = n;
    });
  } catch (e) {
    console.warn('No se pudo pre-consultar consecutivos del día, se usará solo el contador:', e);
  }

  const counterRef = doc(db, 'counters', `mtto_${dateString}`);
  const nuevoMttoRef = doc(collection(db, 'gastos_mtto'));

  try {
    await runTransaction(db, async (transaction) => {
      const counterDoc = await transaction.get(counterRef);
      const contadorActual = counterDoc.exists() ? Number(counterDoc.data()?.count) || 0 : 0;

      // El nuevo consecutivo parte del mayor entre el contador y lo ya guardado
      const nuevoCorrelativo = Math.max(contadorActual, maxExistente) + 1;

      transaction.set(counterRef, { count: nuevoCorrelativo }, { merge: true });

      const paddedCorrelativo = String(nuevoCorrelativo).padStart(3, '0');
      const referenciaFinal = `MTTO-${dateString}-${paddedCorrelativo}`;

      transaction.set(nuevoMttoRef, {
        ...dataLimpia,
        numeroGasto: referenciaFinal,
        createdAt: new Date().toISOString()
      });
    });

    // Devolvemos el id real del documento creado
    return nuevoMttoRef.id;
  } catch (error) {
    console.error('Transacción fallida al guardar MTTO: ', error);
    throw new Error('No se pudo guardar el gasto MTTO.');
  }
};