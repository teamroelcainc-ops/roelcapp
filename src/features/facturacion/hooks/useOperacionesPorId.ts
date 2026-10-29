// src/features/facturacion/hooks/useOperacionesPorId.ts
// ---------------------------------------------------------------------------
// ✅ V00523 — Lee (una sola vez cada una) las operaciones que se piden por id, en lotes de 30
// (`porIds`). Lo usa la pestaña Corregir para mostrar lo que cobra HOY cada referencia de las
// facturas que se ven en pantalla (no de todas: solo las filas visibles).
// ---------------------------------------------------------------------------
import { useEffect, useRef, useState } from 'react';
import { idReal } from '../../../shared/data/coleccionesVivas';
import { porIds } from '../../../shared/data/consultas';

type Datos = Record<string, unknown>;

export interface OperacionesPorId {
  /** id → la operación; null = no existe. Un id que todavía no llega no está en el mapa. */
  ops: ReadonlyMap<string, Datos | null>;
  /** Faltan por llegar algunas de las pedidas. */
  cargando: boolean;
  error: string;
}

export function useOperacionesPorId(ids: readonly string[]): OperacionesPorId {
  const clave = Array.from(new Set(ids.filter(Boolean))).sort().join('|');
  const [ops, setOps] = useState<ReadonlyMap<string, Datos | null>>(new Map());
  const [error, setError] = useState('');
  const pedidas = useRef(new Set<string>());

  useEffect(() => {
    const faltan = clave ? clave.split('|').filter((id) => !pedidas.current.has(id)) : [];
    if (faltan.length === 0) return;
    faltan.forEach((id) => pedidas.current.add(id));
    porIds('operaciones', faltan)
      .then((docs) => {
        setOps((prev) => {
          const m = new Map(prev);
          faltan.forEach((id) => { if (!m.has(id)) m.set(id, null); });
          docs.forEach((d) => m.set(idReal(d), d));
          return m;
        });
      })
      .catch((e: unknown) => {
        console.error('[Facturación] No se pudieron leer las operaciones de las facturas:', e);
        faltan.forEach((id) => pedidas.current.delete(id)); // se vuelven a pedir con Revisar de nuevo o al cambiar la lista
        setError('No se pudo leer lo que cobran hoy algunas operaciones. Presiona Revisar de nuevo.');
      });
  }, [clave]);

  const cargando = !!clave && clave.split('|').some((id) => !ops.has(id));
  return { ops, cargando, error };
}
