// src/services/employeeService.ts
import { collection, doc, getDocs, limit, orderBy, query, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import type { Employee } from '../types/empleado';

const COLLECTION_NAME = 'empleados';
// ✅ V00284: el contador _contadores ya no se usa (el consecutivo sale del último registro).

/**
 * Guarda un empleado garantizando un ID secuencial único mediante una Transacción Atómica.
 */
export const guardarEmpleadoConTransaccion = async (empleadoData: Employee): Promise<string> => {
  // ✅ V00284: GUARDADO ROBUSTO —
  //   1) Firestore RECHAZA valores `undefined`: se limpian SIEMPRE (antes, un
  //      solo campo undefined tiraba el guardado completo y el registro "no se
  //      guardaba").
  //   2) Ya no depende de la colección `_contadores` (si las reglas no la
  //      permiten, la transacción fallaba SIEMPRE al crear): el consecutivo se
  //      toma del formulario o del último empleado registrado.
  const limpiar = (obj: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

  const dataToSave = limpiar({ ...empleadoData } as Record<string, unknown>);
  delete dataToSave.id;

  try {
    // Actualización: el documento ya existe.
    if (empleadoData.id) {
      await updateDoc(doc(db, COLLECTION_NAME, empleadoData.id), dataToSave);
      await sincronizarFirmaEmpleado(empleadoData.id, dataToSave); // ✅ V00287
      return empleadoData.id;
    }

    // Creación: consecutivo del formulario (Col-###) o derivado del último.
    let employeeId = String(dataToSave.employeeId || '').trim();
    if (!employeeId) {
      const snap = await getDocs(query(collection(db, COLLECTION_NAME), orderBy('employeeId', 'desc'), limit(1)));
      let n = 1;
      let prefijo = 'Col';
      if (!snap.empty) {
        const ultimo = String(snap.docs[0].data().employeeId || '');
        const mUlt = ultimo.match(/^([A-Za-z]+)-(\d+)/);
        if (mUlt) { prefijo = mUlt[1]; n = parseInt(mUlt[2], 10) + 1; }
      }
      employeeId = `${prefijo}-${String(n).padStart(3, '0')}`;
    }
    dataToSave.employeeId = employeeId;
    const nuevoRef = doc(collection(db, COLLECTION_NAME));
    await setDoc(nuevoRef, dataToSave);
    await sincronizarFirmaEmpleado(nuevoRef.id, dataToSave); // ✅ V00287
    return nuevoRef.id;
  } catch (error) {
    console.error('Fallo al guardar empleado:', error);
    throw error; // Propagamos el error para que la UI muestre el motivo real
  }
};

// ✅ V00287: la FIRMA capturada en la pestaña Firmas del empleado se refleja
//   también en el directorio de firmas (firmas_colaboradores) — un doc por
//   empleado (id = id del empleado). Mejor esfuerzo: nunca rompe el guardado.
const sincronizarFirmaEmpleado = async (empleadoId: string, d: Record<string, unknown>): Promise<void> => {
  try {
    const nombre = String(d.firmaNombre || '').trim();
    const correo = String(d.firmaCorreo || '').trim();
    const cargo = String(d.firmaCargo || '').trim();
    if (!nombre && !correo && !cargo) return;
    await setDoc(doc(db, 'firmas_colaboradores', empleadoId), {
      nombre, correo, cargoDepartamento: cargo,
      empleadoId,
      actualizadoEl: new Date().toISOString(),
    }, { merge: true });
  } catch (e) { console.warn('No se pudo sincronizar la firma del empleado:', e); }
};
