// src/features/operaciones/services/tipoCambioPorFecha.ts
// ✅ V00438 (Fase 2.9): respaldo del tipo de cambio del formulario de operación.
//   Antes se probaban ~10 nombres de colección y se descargaba la colección COMPLETA
//   (una vez por sesión) solo para encontrar el T.C. de una fecha. Ahora es UNA
//   consulta a `tipo_cambio` por `fecha` con limit(1).
//   `fecha` se guarda como 'AAAA-MM-DD' (FormularioTipoCambio y la captura rápida de
//   App.tsx). Un registro viejo con otro formato (d/m/aaaa, Timestamp) no lo encuentra
//   esta consulta; lo sigue encontrando la búsqueda tolerante sobre el catálogo en
//   memoria (catalogosCacheados), que el formulario hace ANTES de llamar aquí.
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { COL } from '../../../shared/dominio/constantes';

export type FilaTipoCambio = Record<string, unknown>;

// Solo se guardan los aciertos: si la fecha aún no tiene T.C., se vuelve a
// consultar la próxima vez (puede registrarse mientras el formulario está abierto).
const filasPorFecha = new Map<string, FilaTipoCambio>();

export async function obtenerFilaTipoCambioDeFecha(fechaISO: string): Promise<FilaTipoCambio | null> {
  if (!fechaISO) return null;
  const enCache = filasPorFecha.get(fechaISO);
  if (enCache) return enCache;

  const snap = await getDocs(query(collection(db, COL.tipoCambio), where('fecha', '==', fechaISO), limit(1)));
  if (snap.empty) return null;
  const d = snap.docs[0];
  // Mismo orden de llaves que antes ({ id, ...datos }): extraerRateDeFilaTC recorre las llaves en orden.
  const fila: FilaTipoCambio = { id: d.id, ...(d.data() as Record<string, unknown>) };
  filasPorFecha.set(fechaISO, fila);
  return fila;
}
