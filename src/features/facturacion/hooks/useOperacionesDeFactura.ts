// src/features/facturacion/hooks/useOperacionesDeFactura.ts
// ---------------------------------------------------------------------------
// ✅ V00520 — Las operaciones de la factura que se está editando (Editar factura de Clientes): se leen
// UNA vez al abrir (porIds, lotes de 30) y se vuelven a leer solas cuando se guarda una de ellas en la
// app (operacionesBus: el formulario abierto con ✎ avisa al guardar). Con eso Editar factura dice qué
// operación cambió de costo (opsDesfasadas) y el botón Actualizar pone la factura al día.
// ---------------------------------------------------------------------------
import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { idReal } from '../../../shared/data/coleccionesVivas';
import { porIds } from '../../../shared/data/consultas';
import { suscribirOperacionGuardada } from '../../../utils/operacionesBus';
import { opsDeFactura } from '../services/diferenciaEnCargos';
import type { OpDeFactura } from '../services/diferenciaEnCargos';

type Datos = Record<string, unknown>;

interface Leidas { clave: string; ops: ReadonlyMap<string, Datos>; error: string }

export interface OperacionesDeFactura {
  /** Los renglones de la factura con id real y lo que cobra cada uno EN LA FACTURA. */
  renglones: OpDeFactura[];
  /** Cada operación como está hoy (id → datos). */
  actuales: ReadonlyMap<string, Datos>;
  cargando: boolean;
  error: string;
}

const SIN_LEER: Leidas = { clave: '', ops: new Map(), error: '' };

export function useOperacionesDeFactura(fila: Datos | null, moneda: 'USD' | 'MXN' | ''): OperacionesDeFactura {
  const renglones = fila && moneda ? opsDeFactura(fila, moneda) : [];
  const clave = renglones.map((r) => r.opId).join('|');
  const [leidas, setLeidas] = useState<Leidas>(SIN_LEER);

  useEffect(() => {
    if (!clave) return undefined;
    const ids = clave.split('|');
    let vigente = true;
    porIds('operaciones', ids)
      .then((docs) => { if (vigente) setLeidas({ clave, ops: new Map(docs.map((d) => [idReal(d), d as Datos] as const)), error: '' }); })
      .catch((e: unknown) => {
        console.error('[Facturación] No se pudieron leer las operaciones de la factura:', e);
        if (vigente) setLeidas({ clave, ops: new Map(), error: 'No se pudieron leer las operaciones de la factura. Cierra y vuelve a abrir Editar factura.' });
      });
    // Una operación de esta factura se guardó en la app: se relee (1 lectura) para tener su costo de hoy.
    const baja = suscribirOperacionGuardada((d) => {
      if (!ids.includes(d.id)) return;
      void getDoc(doc(db, 'operaciones', d.id)).then((s) => {
        if (!vigente || !s.exists()) return;
        setLeidas((prev) => (prev.clave === clave ? { ...prev, ops: new Map(prev.ops).set(d.id, { id: s.id, ...(s.data() as Datos) }) } : prev));
      }).catch((e: unknown) => console.error('[Facturación] No se pudo releer la operación guardada:', e));
    });
    return () => { vigente = false; baja(); };
  }, [clave]);

  const listas = leidas.clave === clave;
  return { renglones, actuales: listas ? leidas.ops : new Map(), cargando: !!clave && !listas, error: listas ? leidas.error : '' };
}
