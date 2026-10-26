// src/features/operaciones/services/corregirMonedaConvenioDatos.ts
// ---------------------------------------------------------------------------
// ✅ V00487 — lecturas y escrituras de "Corregir monedas" (antes "Corregir monedas de convenio") (la regla está en
// corregirMonedaConvenio.ts). La revisión recorre TODAS las operaciones por páginas de 500
// sin escribir nada y solo guarda lo que hay que corregir; la corrección va una operación a la
// vez en transacción (relee la operación y vuelve a revisarla con sus datos de ese momento).
// Al guardar la moneda, el servidor (operacionEscrita) actualiza solo los renglones de las
// facturas que incluyen la operación.
// ---------------------------------------------------------------------------
import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { obtenerCatalogo } from '../../../shared/data/catalogos';
import { contarOperaciones, paginaOperacionesPorId } from '../../../shared/data/consultas';
import type { Cursor } from '../../../shared/data/consultas';
import { idReal } from '../../../shared/data/coleccionesVivas';
import { esOperacionPrueba } from '../../../utils/operacionPrueba';
import type { Moneda } from '../../../shared/dominio/moneda';
import type { Lado } from '../../../shared/dominio/dinero';
import { monedaDeEmpresa } from '../../facturacion/services/reglasFactura';
import { indexarConvenios, revisarOperacion } from './corregirMonedaConvenio';
import type { CatalogoConvenios, RevisionOperacion } from './corregirMonedaConvenio';

const PAGINA = 500;

/**
 * ✅ V00490: moneda de cada empresa en Empresas, por id, con la misma lectura que Facturación
 * (monedaDeEmpresa: `moneda`, `monedaId`, `monedaNombre`, `monedaRef` y el campo de su lado).
 */
const indexarMonedasEmpresas = (empresas: readonly Record<string, unknown>[], nombreDeId: (id: string) => unknown, campoLado: string): Map<string, Moneda> => {
  const mapa = new Map<string, Moneda>();
  empresas.forEach((e) => {
    const m = monedaDeEmpresa(e, campoLado, nombreDeId);
    if (!m) return;
    [e._docId, e.id].map((v) => String(v ?? '').trim()).filter(Boolean).forEach((id) => { if (!mapa.has(id)) mapa.set(id, m); });
  });
  return mapa;
};

/** Convenios de clientes y proveedores (detalles y maestros) y monedas de las empresas, confirmados por el servidor. */
export const leerConvenios = async (): Promise<CatalogoConvenios> => {
  const [detCli, maeCli, detProv, maeProv, empresas, monedas] = await Promise.all([
    obtenerCatalogo('convenios_clientes_detalles', { fresco: true }),
    obtenerCatalogo('convenios_clientes', { fresco: true }),
    obtenerCatalogo('convenios_proveedores_detalles', { fresco: true }),
    obtenerCatalogo('convenios_proveedores', { fresco: true }),
    obtenerCatalogo('empresas', { fresco: true }),
    obtenerCatalogo('catalogo_moneda', { fresco: true }),
  ]);
  const nombres = new Map(monedas.map((m) => [idReal(m), String(m.moneda ?? '')]));
  const nombreDeId = (id: string): unknown => nombres.get(id) ?? '';
  return {
    cliente: indexarConvenios(detCli, maeCli, indexarMonedasEmpresas(empresas, nombreDeId, 'monedaFacturacion')),
    proveedor: indexarConvenios(detProv, maeProv, indexarMonedasEmpresas(empresas, nombreDeId, 'monedaProveedor')),
  };
};

export interface AvanceRevision { leidas: number; total: number }

/**
 * Recorre todas las operaciones (sin las de prueba) y devuelve las que hay que corregir, revisar
 * o que no tienen datos, y cuántas se leyeron. `sigue()` en false corta el recorrido.
 */
export const revisarTodas = async (
  cat: CatalogoConvenios, alAvanzar: (a: AvanceRevision) => void, sigue: () => boolean,
): Promise<{ revisiones: RevisionOperacion[]; leidas: number }> => {
  const total = await contarOperaciones();
  const revisiones: RevisionOperacion[] = [];
  let leidas = 0;
  let cursor: Cursor = null;
  alAvanzar({ leidas, total });
  while (sigue()) {
    const p = await paginaOperacionesPorId(PAGINA, cursor);
    p.docs.forEach((op) => {
      if (esOperacionPrueba(op)) return;
      const r = revisarOperacion(idReal(op), op, cat);
      if (r) revisiones.push(r);
    });
    leidas += p.docs.length;
    alAvanzar({ leidas, total: Math.max(total, leidas) });
    if (!p.hayMas) break;
    cursor = p.cursor;
  }
  return { revisiones, leidas };
};

export type ResultadoCorreccion =
  | { tipo: 'corregida'; datos: Record<string, unknown> }
  | { tipo: 'saltada'; motivo: string };

/** Corrige una operación con sus datos de este momento (si alguien ya la cambió, se vuelve a revisar). */
export const corregirOperacion = (id: string, cat: CatalogoConvenios, lados?: readonly Lado[]): Promise<ResultadoCorreccion> =>
  runTransaction(db, async (tx): Promise<ResultadoCorreccion> => {
    const ref = doc(db, 'operaciones', id);
    const snap = await tx.get(ref);
    if (!snap.exists()) return { tipo: 'saltada', motivo: 'La operación ya no existe.' };
    const r = revisarOperacion(id, snap.data(), cat, lados);
    if (!r || r.estado !== 'corregir' || !r.datos) {
      return { tipo: 'saltada', motivo: r?.avisos[0]?.motivo ?? 'Ya está bien (alguien la corrigió antes).' };
    }
    tx.update(ref, r.datos);
    return { tipo: 'corregida', datos: r.datos };
  });
