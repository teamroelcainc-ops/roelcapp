// src/shared/hooks/useSnapshotSoloVisible.ts
// ---------------------------------------------------------------------------
// ✅ V00438 (Fase 2.7) — onSnapshot que se CIERRA mientras el módulo está oculto.
//
// Con MantenerVivo (src/utils/mantenerVivo.tsx) los módulos pesados no se
// desmontan al navegar: antes sus listeners seguían abiertos (y cobrando cada
// cambio de la base) aunque nadie los viera. Este hook escucha solo cuando el
// módulo está visible; al volver se re-suscribe y, con la caché persistente,
// Firestore entrega primero lo que ya tenía y solo cobra lo que cambió (si se
// vuelve antes de 30 min). Los datos ya pintados se quedan en el estado del
// módulo mientras está oculto: al regresar se ven al instante.
//
// Uso:
//   useSnapshotSoloVisible(
//     `pagos:${tipo}`,                                   // clave: si cambia, se re-suscribe
//     () => query(collection(db, 'pagos'), where('tipo', '==', tipo)),
//     (snap) => setPagos(snap.docs.map(...)),
//   );
// `crear` puede devolver null para no escuchar (p. ej. faltan filtros).
// Para efectos existentes basta el patrón mínimo equivalente:
//   const visible = useModuloEscuchando(); // ✅ V00446: visible o ocultado hace poco
//   useEffect(() => { if (!visible) return; const unsub = onSnapshot(...); return unsub; }, [visible, ...]);
// ---------------------------------------------------------------------------
import { useEffect, useEffectEvent } from 'react';
import { onSnapshot } from 'firebase/firestore';
import type {
  DocumentData, DocumentReference, DocumentSnapshot, FirestoreError, Query, QuerySnapshot,
} from 'firebase/firestore';
import { useModuloEscuchando } from '../../utils/moduloVivoContexto';

type Objetivo<A, D extends DocumentData> = Query<A, D> | DocumentReference<A, D>;
type SnapDe<A, D extends DocumentData, O> = O extends DocumentReference<A, D> ? DocumentSnapshot<A, D> : QuerySnapshot<A, D>;

export function useSnapshotSoloVisible<A, D extends DocumentData, O extends Objetivo<A, D>>(
  clave: string | null,
  crear: () => O | null,
  alCambiar: (snap: SnapDe<A, D, O>) => void,
  alError?: (error: FirestoreError) => void,
): void {
  const visible = useModuloEscuchando(); // ✅ V00446: sigue escuchando unos minutos oculto
  const crearEv = useEffectEvent(crear);
  const cambioEv = useEffectEvent(alCambiar);
  const errorEv = useEffectEvent((e: FirestoreError) => {
    if (alError) alError(e);
    else console.error(`[snapshot] ${clave}:`, e);
  });

  useEffect(() => {
    if (!visible || clave === null) return;
    const objetivo = crearEv();
    if (!objetivo) return;
    const suscribir = onSnapshot as unknown as (
      o: O, next: (s: SnapDe<A, D, O>) => void, error: (e: FirestoreError) => void,
    ) => () => void;
    return suscribir(objetivo, (s) => cambioEv(s), (e) => errorEv(e));
  }, [visible, clave]);
}
