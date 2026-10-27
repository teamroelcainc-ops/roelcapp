// src/features/facturacion/services/gruposFactura.ts
// ---------------------------------------------------------------------------
// ✅ V00502 — GRUPOS DE FACTURA: Facturación muestra en UNA fila (y en una ficha) los documentos
// con el mismo invoice y la misma empresa. Antes este armado vivía copiado dentro del Historial
// de Clientes y del de Proveedores (solo cambiaba clienteId / proveedorId); ahora lo usan los dos y
// la apertura desde el buscador global, así la ficha abierta por búsqueda es la misma que la de la
// tabla. Misma lógica de siempre (V00451: los archivos de todos los documentos cuentan).
// ---------------------------------------------------------------------------
import { camposDocsDeGrupo } from './documentosFactura';

type Fila = Record<string, unknown>;
export type CampoEntidadFactura = 'clienteId' | 'proveedorId';

const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const rangoStatus = (s: unknown): number => {
  const t = txt(s).toLowerCase();
  if (t.includes('cancel')) return 3;
  if (t.includes('no')) return 2;
  return 1;
};

/** Llave del grupo: invoice (o id) en minúsculas + la empresa. */
export const claveGrupoFactura = (f: Fila, campoEntidad: CampoEntidadFactura): string =>
  `${txt(f.invoice || f.id).trim().toLowerCase()}__${txt(f[campoEntidad] || '')}`;

/** Une las facturas de cada grupo (en el orden en que llegan): ids, operaciones, remolques, subtotal, fecha, status y archivos. */
export const agruparFacturas = <T extends Fila>(facturas: readonly T[], campoEntidad: CampoEntidadFactura): T[] => {
  const grupos = new Map<string, Fila & { __groupIds: unknown[]; __groupDocs: Fila[] }>();
  for (const f of facturas) {
    const key = claveGrupoFactura(f, campoEntidad);
    const g = grupos.get(key);
    if (!g) {
      grupos.set(key, {
        ...f,
        operacionesIds: [...lista(f.operacionesIds)],
        operacionesGuardadas: [...lista(f.operacionesGuardadas)],
        remolques: [...lista(f.remolques)],
        subtotalFactura: Number(f.subtotalFactura) || 0,
        __groupIds: [f.id],
        __groupDocs: [f],
      });
      continue;
    }
    g.__groupIds.push(f.id);
    g.__groupDocs.push(f);
    g.operacionesIds = Array.from(new Set([...lista(g.operacionesIds).map(String), ...lista(f.operacionesIds).map(String)]));
    const porId = new Map<string, unknown>();
    [...lista(g.operacionesGuardadas), ...lista(f.operacionesGuardadas)].forEach((o) => {
      const id = (o as { id?: unknown } | null)?.id;
      if (id) porId.set(String(id), o);
    });
    g.operacionesGuardadas = Array.from(porId.values());
    g.remolques = Array.from(new Set([...lista(g.remolques), ...lista(f.remolques)].map((r) => txt(r || '')).filter(Boolean)));
    g.subtotalFactura = Number(g.subtotalFactura || 0) + (Number(f.subtotalFactura) || 0);
    if (txt(f.fecha || '') > txt(g.fecha || '')) g.fecha = f.fecha;
    if (!g.createdAt || (f.createdAt && txt(f.createdAt) < txt(g.createdAt))) g.createdAt = f.createdAt || g.createdAt;
    if (rangoStatus(f.statusFactura) > rangoStatus(g.statusFactura)) g.statusFactura = f.statusFactura;
    Object.assign(g, camposDocsDeGrupo(g, f));
  }
  return Array.from(grupos.values()) as unknown as T[];
};

/** El grupo completo (como la fila del Historial) de la factura con id `id`; null si no está. */
export const grupoDeFactura = <T extends Fila>(facturas: readonly T[], id: string, campoEntidad: CampoEntidadFactura): T | null => {
  const f = facturas.find((x) => txt(x.id) === id);
  if (!f) return null;
  const clave = claveGrupoFactura(f, campoEntidad);
  return agruparFacturas(facturas.filter((x) => claveGrupoFactura(x, campoEntidad) === clave), campoEntidad)[0] ?? null;
};
