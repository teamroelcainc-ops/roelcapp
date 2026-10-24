// src/features/facturacion/services/corregirFacturasDatos.ts
// ---------------------------------------------------------------------------
// ✅ V00482 — lecturas y escrituras de "Corregir monedas y montos".
//   · Revisión: lee las operaciones de las facturas por lotes de 30 (porIds); cero escrituras.
//   · Corrección (una factura a la vez, como manda CLAUDE.md para el dinero):
//       sin la bandera dineroPorServidor → transacción que RELEE la factura y sus operaciones;
//       con la bandera → la moneda (no es campo de dinero) desde la web y el total con la
//       callable recalcularFactura de siempre (la misma regla).
// ---------------------------------------------------------------------------
import { doc, getDoc, runTransaction, updateDoc } from 'firebase/firestore';
import { auth, db } from '../../../config/firebase';
import { idReal } from '../../../shared/data/coleccionesVivas';
import { porIds } from '../../../shared/data/consultas';
import type { Lado } from '../../../shared/dominio/dinero';
import { LADOS } from '../../../shared/dominio/facturacion';
import type { DocLeido } from '../../../shared/dominio/facturacion';
import { idMoneda } from '../../../shared/dominio/moneda';
import type { Moneda } from '../../../shared/dominio/moneda';
import { llamarDinero } from './dineroServidor';
import { idsDeOperaciones, motivoParaSaltar, revisarFactura } from './corregirFacturas';
import type { RevisionFactura } from './corregirFacturas';

export const usuarioCorrige = (): string => auth.currentUser?.displayName || auth.currentUser?.email || 'Usuario';

const LOTE_LECTURA = 600; // 20 consultas de 30 a la vez, para poder mostrar el avance

/** Lee las operaciones (por id de documento) mostrando el avance; las que no existen no vienen. */
export const leerOperaciones = async (ids: readonly string[], onAvance: (leidas: number, total: number) => void): Promise<Map<string, DocLeido>> => {
  const unicos = Array.from(new Set(ids));
  const mapa = new Map<string, DocLeido>();
  for (let i = 0; i < unicos.length; i += LOTE_LECTURA) {
    const docs = await porIds('operaciones', unicos.slice(i, i + LOTE_LECTURA));
    docs.forEach((d) => { const id = idReal(d); mapa.set(id, { id, datos: d }); });
    onAvance(Math.min(i + LOTE_LECTURA, unicos.length), unicos.length);
  }
  return mapa;
};

/** Qué pasó al corregir una factura. */
export type ResultadoCorreccion =
  | { tipo: 'corregida'; datos: Record<string, unknown> }
  | { tipo: 'saltada'; motivo: string };

/**
 * Corrige UNA factura con datos frescos. Si al releerla ya no cumple (se le aplicó un pago, se
 * canceló o ya quedó bien) se salta con su motivo.
 */
export const corregirFactura = async (
  lado: Lado, revision: RevisionFactura, monedaEmpresa: Moneda, conServidor: boolean, empresa: string,
): Promise<ResultadoCorreccion> => {
  const c = LADOS[lado];
  const ref = doc(db, c.coleccion, revision.id);
  const usuario = usuarioCorrige();
  if (conServidor) {
    const snap = await getDoc(ref);
    if (!snap.exists()) return { tipo: 'saltada', motivo: 'La factura ya no existe' };
    // El servidor relee la factura y sus operaciones; aquí solo los filtros (cancelada, pagos…) con la factura fresca.
    const saltar = motivoParaSaltar(snap.data(), monedaEmpresa);
    if (saltar) return { tipo: 'saltada', motivo: saltar };
    const moneda = { [c.campoMoneda]: monedaEmpresa, monedaId: idMoneda(monedaEmpresa) };
    await updateDoc(ref, moneda);
    const r = await llamarDinero('recalcularFactura', { lado, facturaId: revision.id });
    return { tipo: 'corregida', datos: { ...moneda, ...(r.facturas[revision.id] ?? {}) } };
  }
  return runTransaction(db, async (tx): Promise<ResultadoCorreccion> => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return { tipo: 'saltada', motivo: 'La factura ya no existe' };
    const datos = snap.data();
    const opsSnaps = await Promise.all(idsDeOperaciones(datos).slice(0, 449).map((id) => tx.get(doc(db, 'operaciones', id))));
    const ops = opsSnaps.filter((s) => s.exists()).map((s) => ({ id: s.id, datos: s.data() }));
    const fresca = revisarFactura(lado, { id: snap.id, datos }, ops, monedaEmpresa, empresa, new Date().toISOString(), usuario);
    if (fresca.estado !== 'corregir' || !fresca.datos) {
      return { tipo: 'saltada', motivo: fresca.estado === 'bien' ? 'Ya estaba correcta' : fresca.motivo };
    }
    tx.set(ref, fresca.datos, { merge: true });
    return { tipo: 'corregida', datos: fresca.datos };
  });
};
