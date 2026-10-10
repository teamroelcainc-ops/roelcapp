// ⚠ ARCHIVO GENERADO por scripts/sincronizar-dominio.mjs — NO EDITAR.
// Fuente: src/shared/dominio (se edita allá y se vuelve a copiar).
// src/shared/dominio/usos.ts
// ---------------------------------------------------------------------------
// ✅ V00442 (Fase 6.5) — CONTADORES DE USO de empresas y convenios.
// Cuántas operaciones (sin pruebas) usan cada empresa / convenio y la fecha de
// servicio más reciente. Los mantiene operacionEscrita con increment() en
// documentos APARTE (usos/{tipo}_{id}) — no en la empresa ni en el convenio: esos
// documentos los escuchan todas las pantallas (catálogos en vivo) y un contador
// que cambia en cada operación haría que cada navegador los volviera a leer.
// La Fase 7 (Empresas y Uso de convenios) los lee en lugar de contar operaciones.
// ---------------------------------------------------------------------------
import { aFechaServicioISO } from './fechas.js';
import { esOperacionPrueba, ROLES_EMPRESA } from './operacionCanonica.js';
import { pareceId } from './texto.js';

type Datos = Record<string, unknown>;

export const COL_USOS = 'usos';
export type TipoUso = 'empresa' | 'convenioCliente' | 'convenioProveedor';

/** Documento usos/{tipo}_{id}. */
export interface UsoDoc { tipo: TipoUso; refId: string; usoOps: number; ultimoUsoISO?: string }

const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

/** Id del documento de uso (sin "/"). */
export const idUso = (tipo: TipoUso, refId: string): string => `${tipo}_${refId}`.replace(/\//g, '-');

/** Separa una llave "tipo|id" en sus partes. */
export const partesUso = (llave: string): { tipo: TipoUso; refId: string } => {
  const i = llave.indexOf('|');
  return { tipo: llave.slice(0, i) as TipoUso, refId: llave.slice(i + 1) };
};

/** Fecha de servicio de la operación para "último uso" (AAAA-MM-DD o ''). */
export const fechaDeUso = (op: Datos | undefined): string =>
  (op ? (txt(op.fechaServicioISO) || aFechaServicioISO(op.fechaServicio) || '') : '');

/**
 * Llaves "tipo|id" que una operación cuenta. Usa los campos canónicos si ya
 * existen y, si no, los de siempre (solo valores con forma de ID: los nombres de
 * AppSheet no se cuentan). Las operaciones de prueba no cuentan.
 */
export const usosDeOperacion = (op: Datos | undefined): Set<string> => {
  const s = new Set<string>();
  if (!op || esOperacionPrueba(op)) return s;
  const agregar = (tipo: TipoUso, v: unknown) => { const id = txt(v); if (id && !id.includes('/') && pareceId(id)) s.add(`${tipo}|${id}`); };
  // Los convenios (detalles) usan su consecutivo como ID ("054", "CONV-054"): basta que no sea un texto con espacios.
  const agregarConvenio = (tipo: TipoUso, v: unknown) => { const id = txt(v); if (id && id.length <= 100 && !/[\s/]/.test(id)) s.add(`${tipo}|${id}`); };
  agregarConvenio('convenioCliente', op.convenioClienteId || op.convenio);
  agregarConvenio('convenioProveedor', op.convenioProveedorId || op.convenioProveedor);
  const canonicas = Array.isArray(op.empresasIds) ? (op.empresasIds as unknown[]) : null;
  if (canonicas && canonicas.length > 0) canonicas.forEach((e) => agregar('empresa', e));
  else for (const [legado, canonico] of ROLES_EMPRESA) agregar('empresa', op[canonico] || op[legado]);
  return s;
};

/** Qué contadores suben y bajan cuando una operación pasa de `antes` a `despues` (crear: antes undefined; borrar: despues undefined). */
export const diferenciaUsos = (antes: Datos | undefined, despues: Datos | undefined): { sumar: string[]; restar: string[] } => {
  const a = usosDeOperacion(antes);
  const d = usosDeOperacion(despues);
  return { sumar: Array.from(d).filter((k) => !a.has(k)), restar: Array.from(a).filter((k) => !d.has(k)) };
};

/** Conteo completo desde cero (script de recuento). */
export const contarUsos = (ops: readonly Datos[]): Map<string, { usoOps: number; ultimoUsoISO: string }> => {
  const m = new Map<string, { usoOps: number; ultimoUsoISO: string }>();
  for (const op of ops) {
    const fecha = fechaDeUso(op);
    usosDeOperacion(op).forEach((k) => {
      const x = m.get(k) ?? { usoOps: 0, ultimoUsoISO: '' };
      x.usoOps += 1;
      if (fecha > x.ultimoUsoISO) x.ultimoUsoISO = fecha;
      m.set(k, x);
    });
  }
  return m;
};
