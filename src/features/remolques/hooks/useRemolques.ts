// src/features/remolques/hooks/useRemolques.ts
// ---------------------------------------------------------------------------
// Lógica de DATOS del módulo Remolques, extraída del componente (código
// limpio: la vista solo pinta). Patrón TanStack Query + Firestore realtime:
//
//   · useQuery hidrata desde el caché de Query (o de IndexedDB de Firestore)
//     → pintado instantáneo al volver al módulo, sin useEffect+useState.
//   · Un onSnapshot alimenta el MISMO caché con setQueryData → tiempo real
//     sin descargas duplicadas (solo se facturan los docs que cambian).
//   · Las mutaciones (eliminar) invalidan/actualizan el caché centralizado.
// ---------------------------------------------------------------------------
import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { collection, getDocs, onSnapshot } from 'firebase/firestore';
import { db, eliminarRegistro } from '../../../config/firebase';
import type { RemolqueRecord } from '../../../types/remolque';

export const REMOLQUES_QUERY_KEY = ['remolques'] as const;

const ordenar = (data: RemolqueRecord[]): RemolqueRecord[] =>
  [...data].sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')));

const mapearSnapshot = (docs: Array<{ id: string; data: () => unknown }>): RemolqueRecord[] =>
  ordenar(docs.map((d) => ({ id: d.id, ...(d.data() as Omit<RemolqueRecord, 'id'>) })));

export function useRemolques() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: REMOLQUES_QUERY_KEY,
    queryFn: async (): Promise<RemolqueRecord[]> => {
      const snap = await getDocs(collection(db, 'remolques'));
      return mapearSnapshot(snap.docs);
    },
    // El snapshot en tiempo real (abajo) mantiene el dato fresco: no caduca.
    staleTime: Infinity,
  });

  // Tiempo real: el snapshot escribe DIRECTO al caché de Query.
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'remolques'), (snapshot) => {
      queryClient.setQueryData<RemolqueRecord[]>(REMOLQUES_QUERY_KEY, mapearSnapshot(snapshot.docs));
    });
    return () => unsubscribe();
  }, [queryClient]);

  const eliminar = useMutation({
    mutationFn: (id: string) => eliminarRegistro('remolques', id),
    // Optimista: la fila desaparece al instante; el snapshot confirma después.
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: REMOLQUES_QUERY_KEY });
      const previos = queryClient.getQueryData<RemolqueRecord[]>(REMOLQUES_QUERY_KEY);
      queryClient.setQueryData<RemolqueRecord[]>(REMOLQUES_QUERY_KEY, (actual) =>
        (actual || []).filter((r) => r.id !== id)
      );
      return { previos };
    },
    onError: (_err, _id, contexto) => {
      if (contexto?.previos) queryClient.setQueryData(REMOLQUES_QUERY_KEY, contexto.previos);
    },
  });

  return {
    remolques: query.data ?? [],
    cargando: query.isLoading,
    error: query.error,
    eliminarRemolque: eliminar.mutateAsync,
  };
}
