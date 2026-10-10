// src/features/remolques/hooks/useRemolques.ts
// ---------------------------------------------------------------------------
// Lógica de DATOS del módulo Remolques, extraída del componente (código
// limpio: la vista solo pinta).
//
// ✅ V00439 (Fase 3.x): envoltorio del catálogo compartido `remolques`. Antes
//   montaba un getDocs (useQuery) Y un onSnapshot a la vez: leía la colección
//   dos veces. Ahora un solo listener para toda la app; el borrado se refleja
//   solo cuando el listener recibe el cambio (sin caché que parchear).
// ---------------------------------------------------------------------------
import { useCallback, useMemo } from 'react';
import { eliminarRegistro } from '../../../config/firebase';
import { useCatalogo } from '../../../shared/data/catalogos';
import type { RemolqueRecord } from '../../../types/remolque';

const ordenar = (data: RemolqueRecord[]): RemolqueRecord[] =>
  [...data].sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')));

export function useRemolques() {
  const { datos, listo, error } = useCatalogo('remolques');
  const remolques = useMemo(() => ordenar(datos as unknown as RemolqueRecord[]), [datos]);
  const eliminarRemolque = useCallback((id: string) => eliminarRegistro('remolques', id), []);

  return {
    remolques,
    cargando: !listo,
    error,
    eliminarRemolque,
  };
}
