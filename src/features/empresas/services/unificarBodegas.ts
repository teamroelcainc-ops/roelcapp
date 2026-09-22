// src/features/empresas/services/unificarBodegas.ts
// ---------------------------------------------------------------------------
// ✅ V00336: UNIFICAR TIPOS "Origen / Destino" + "Bodega" → "Bódega".
//
//   El tipo "Origen / Destino" (id 6e7af5ab) SE CONSERVA y se renombra a
//   "Bódega": FormularioOperacion filtra los orígenes/destinos por ESE id, así
//   que la operación sigue funcionando sin cambios. Los tipos "Bodega" /
//   "Bódega" duplicados se absorben en él y se dan de baja del catálogo.
//
//   En cada empresa se reescriben:
//     · tiposEmpresa        → los ids absorbidos pasan al id conservado (sin duplicar)
//     · direccionesPorTipo  → tipoId / tipoNombre al tipo conservado
//
//   Dos pasos: planUnificarBodegas() solo LEE y cuenta (para confirmar antes);
//   aplicarUnificarBodegas() escribe por lotes de 400. Es IDEMPOTENTE: correrla
//   de nuevo no cambia nada.
// ---------------------------------------------------------------------------
import { collection, doc, getDocs, writeBatch } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { limpiarCachesPorPrefijo } from '../../../utils/cacheMemoria';
import { limpiarCacheCatalogos } from '../../../hooks/useCatalogoCache';
import { invalidarCatalogosParaFormulario } from '../../operaciones/services/catalogosOperacion';

/** Id del tipo que se conserva (antes "Origen / Destino"). */
export const TIPO_BODEGA_ID = '6e7af5ab';
export const TIPO_BODEGA_NOMBRE = 'Bódega';

const norm = (v: unknown): string =>
  String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Nombres (normalizados) que se unifican en Bódega. */
const NOMBRES_UNIFICABLES = new Set(['origen / destino', 'origen/destino', 'origen - destino', 'origen destino', 'bodega']);

interface DireccionPorTipo {
  tipoId?: string;
  tipoNombre?: string;
  direccionId?: string;
  direccionNombre?: string;
}

interface CambioEmpresa {
  id: string;
  nombre: string;
  tiposEmpresa: string[];
  direccionesPorTipo?: DireccionPorTipo[];
}

export interface PlanUnificacion {
  /** Id del tipo conservado y su nombre actual. */
  tipoConservado: { id: string; nombreActual: string };
  /** Tipos del catálogo que se absorben y se darán de baja. */
  tiposAbsorbidos: { id: string; nombre: string }[];
  /** Empresas que cambian. */
  empresas: CambioEmpresa[];
  /** true si el catálogo aún no dice "Bódega" o hay algo que absorber/reescribir. */
  hayCambios: boolean;
}

/** Lee catálogo y empresas y calcula los cambios SIN escribir nada. */
export async function planUnificarBodegas(): Promise<PlanUnificacion> {
  const snapTipos = await getDocs(collection(db, 'catalogo_tipo_empresa'));
  const tipos = snapTipos.docs.map((d) => ({ id: d.id, nombre: String((d.data() as { nombre?: string }).nombre ?? '') }));

  const conservado =
    tipos.find((t) => t.id === TIPO_BODEGA_ID) ??
    tipos.find((t) => ['origen / destino', 'origen/destino'].includes(norm(t.nombre))) ??
    null;
  if (!conservado) {
    throw new Error('No se encontró el tipo "Origen / Destino" en el catálogo de tipos de empresa.');
  }

  const absorbidos = tipos.filter((t) => t.id !== conservado.id && NOMBRES_UNIFICABLES.has(norm(t.nombre)));
  const idsAbsorbidos = new Set(absorbidos.map((t) => t.id));

  /** Un valor de tiposEmpresa (id o nombre legado) que debe pasar a Bódega. */
  const esUnificable = (v: string): boolean =>
    v === conservado.id || idsAbsorbidos.has(v) || NOMBRES_UNIFICABLES.has(norm(v)) || norm(v) === norm(TIPO_BODEGA_NOMBRE);

  const snapEmp = await getDocs(collection(db, 'empresas'));
  const empresas: CambioEmpresa[] = [];

  for (const d of snapEmp.docs) {
    const data = d.data() as { nombre?: string; tiposEmpresa?: unknown; direccionesPorTipo?: DireccionPorTipo[] };
    const originales: string[] = Array.isArray(data.tiposEmpresa)
      ? data.tiposEmpresa.map((x) => String(x))
      : data.tiposEmpresa
        ? [String(data.tiposEmpresa)]
        : [];

    // tiposEmpresa: unificables → id conservado, sin duplicar, respetando el orden.
    const nuevos: string[] = [];
    for (const v of originales) {
      const final = esUnificable(v) ? conservado.id : v;
      if (!nuevos.includes(final)) nuevos.push(final);
    }
    const cambiaTipos = JSON.stringify(nuevos) !== JSON.stringify(originales);

    // direccionesPorTipo: las de Origen/Destino o Bodega pasan a Bódega.
    let cambiaDirs = false;
    let dirsNuevas: DireccionPorTipo[] | undefined;
    if (Array.isArray(data.direccionesPorTipo) && data.direccionesPorTipo.length > 0) {
      const vistos = new Set<string>();
      dirsNuevas = [];
      for (const dt of data.direccionesPorTipo) {
        const unificable = esUnificable(String(dt.tipoId ?? '')) || esUnificable(String(dt.tipoNombre ?? ''));
        const final: DireccionPorTipo = unificable ? { ...dt, tipoId: conservado.id, tipoNombre: TIPO_BODEGA_NOMBRE } : dt;
        if (unificable && (dt.tipoId !== final.tipoId || dt.tipoNombre !== final.tipoNombre)) cambiaDirs = true;
        const clave = `${final.tipoId ?? final.tipoNombre}|${final.direccionId}`;
        if (vistos.has(clave)) { cambiaDirs = true; continue; } // duplicado tras unificar
        vistos.add(clave);
        dirsNuevas.push(final);
      }
    }

    if (cambiaTipos || cambiaDirs) {
      empresas.push({
        id: d.id,
        nombre: String(data.nombre ?? d.id),
        tiposEmpresa: nuevos,
        ...(cambiaDirs && dirsNuevas ? { direccionesPorTipo: dirsNuevas } : {}),
      });
    }
  }

  const hayCambios = conservado.nombre !== TIPO_BODEGA_NOMBRE || absorbidos.length > 0 || empresas.length > 0;
  return {
    tipoConservado: { id: conservado.id, nombreActual: conservado.nombre },
    tiposAbsorbidos: absorbidos,
    empresas,
    hayCambios,
  };
}

/** Aplica el plan: empresas por lotes, renombra el tipo y da de baja los absorbidos. */
export async function aplicarUnificarBodegas(plan: PlanUnificacion): Promise<{ empresas: number; tiposBaja: number }> {
  // 1) Empresas por lotes de 400 (límite de writeBatch: 500).
  for (let i = 0; i < plan.empresas.length; i += 400) {
    const lote = writeBatch(db);
    for (const e of plan.empresas.slice(i, i + 400)) {
      lote.update(doc(db, 'empresas', e.id), {
        tiposEmpresa: e.tiposEmpresa,
        ...(e.direccionesPorTipo ? { direccionesPorTipo: e.direccionesPorTipo } : {}),
      });
    }
    await lote.commit();
  }

  // 2) Catálogo: el tipo conservado se llama "Bódega"; los absorbidos se dan de baja.
  const loteCat = writeBatch(db);
  loteCat.update(doc(db, 'catalogo_tipo_empresa', plan.tipoConservado.id), { nombre: TIPO_BODEGA_NOMBRE });
  for (const t of plan.tiposAbsorbidos) loteCat.delete(doc(db, 'catalogo_tipo_empresa', t.id));
  await loteCat.commit();

  // 3) Cachés: que ningún módulo siga mostrando "Origen / Destino" o "Bodega".
  limpiarCachesPorPrefijo('roelca_');
  limpiarCachesPorPrefijo('cat_v2__');
  limpiarCacheCatalogos();
  invalidarCatalogosParaFormulario();
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('cat_v2__') || k.startsWith('roelca_'))
      .forEach((k) => localStorage.removeItem(k));
  } catch { /* sin localStorage: las capas en memoria ya quedaron limpias */ }

  return { empresas: plan.empresas.length, tiposBaja: plan.tiposAbsorbidos.length };
}
