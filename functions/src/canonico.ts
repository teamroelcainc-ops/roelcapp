/**
 * ✅ V00440 (Fase 4.4) — CAMPOS CANÓNICOS de las operaciones en el servidor.
 * ------------------------------------------------------------------------------
 * La regla vive en dominio/operacionCanonica.ts (copia de src/shared/dominio):
 * aquí solo se arma el contexto (catálogos pequeños en memoria 5 min) y se
 * decide qué escribir. La usan:
 *   · operacionEscrita (relacional.ts): cada operación guardada — por la web, la
 *     app móvil o una importación — queda con sus campos canónicos al día.
 *   · crearOperacion (index.ts): la operación nace ya canónica.
 * Todo detrás de la bandera `canonicosEnServidor` (configuracion/flags).
 *
 * Costo: el contexto son 3 catálogos chicos (status, Carga/Vacía, aduanas) que
 * se releen cada 5 min por contenedor. Empresas, empleados y unidades NO se
 * cargan: el trigger acepta el ID tal cual y la resolución de nombres viejos la
 * hace la migración una sola vez (functions/scripts/migrarEsquemaV2.ts).
 * ------------------------------------------------------------------------------
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  camposCanonicos, crearIndice, diferenciasCanonicas, empresasDeRoles, estadoYFacturacion, FUENTES_CANONICAS, fuentesReales,
} from './dominio/operacionCanonica.js';
import type { CamposCanonicos, CatalogoNombres, ContextoCanonico, IndiceIds } from './dominio/operacionCanonica.js';
import { normalizarTexto } from './dominio/texto.js';

if (getApps().length === 0) initializeApp();

type Datos = Record<string, unknown>;

export interface CatalogoServidor extends CatalogoNombres {
  indice: IndiceIds;
}

const TTL_MS = 5 * 60 * 1000;
// Se guarda la PROMESA: dos invocaciones simultáneas en un contenedor frío
// comparten una sola lectura (y una lectura fallida no se queda en caché).
const cache = new Map<string, { datos: Promise<CatalogoServidor>; ts: number }>();

/**
 * Catálogo pequeño por nombre (id → nombre, nombre normalizado → nombre, índice
 * para resolver IDs). El nombre es el primer campo no vacío de `campos`.
 */
export const catalogoServidor = (coleccion: string, campos: string[]): Promise<CatalogoServidor> => {
  const hit = cache.get(coleccion);
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.datos;
  const datos = leerCatalogo(coleccion, campos);
  cache.set(coleccion, { datos, ts: Date.now() });
  datos.catch(() => { if (cache.get(coleccion)?.datos === datos) cache.delete(coleccion); });
  return datos;
};

const leerCatalogo = async (coleccion: string, campos: string[]): Promise<CatalogoServidor> => {
  const snap = await getFirestore().collection(coleccion).select(...campos).get();
  const porId = new Map<string, string>();
  const porNorm = new Map<string, string>();
  const docs: { id: string; nombres: string[] }[] = [];
  snap.docs.forEach((d) => {
    const x = d.data() as Datos;
    let nombre = '';
    for (const c of campos) { const v = String(x[c] ?? '').trim(); if (v) { nombre = v; break; } }
    docs.push({ id: d.id, nombres: nombre ? [nombre] : [] });
    if (!nombre) return;
    porId.set(d.id, nombre);
    porNorm.set(normalizarTexto(nombre), nombre);
  });
  return { porId, porNorm, indice: crearIndice(docs) };
};

/** Olvida un catálogo (lo llaman los triggers de renombre). */
export const invalidarCatalogoServidor = (coleccion: string): void => { cache.delete(coleccion); };

export const CATALOGO_CV: [string, string[]] = ['catalogo_carga_vacia', ['nombre', 'estado_carga']];
export const CATALOGO_ADUANAS: [string, string[]] = ['catalogo_aduanas', ['aduana', 'nombre']];
export const CATALOGO_STATUS: [string, string[]] = ['catalogo_status_servicio', ['nombre', 'descripcion']];

/** Contexto del trigger: status, Carga/Vacía y aduanas. */
export const contextoServidor = async (): Promise<ContextoCanonico> => {
  const [status, cv, adu] = await Promise.all([
    catalogoServidor(...CATALOGO_STATUS), catalogoServidor(...CATALOGO_CV), catalogoServidor(...CATALOGO_ADUANAS),
  ]);
  return { status: status.indice, nombreStatus: (id) => status.porId.get(id), cargas: cv.indice, aduanas: adu.indice };
};

const mismoValor = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Campos canónicos que hay que escribir en `despues` (vacío = nada).
 * `antes` = el documento como estaba ANTES del cambio que se procesa (undefined
 * en un documento nuevo). Para cada relación:
 *   · se resolvió → ese ID.
 *   · no se pudo resolver (nombre viejo sin índice) o quedó vacía, pero el
 *     documento ya trae valor en el campo canónico y el dato del usuario NO cambió
 *     (o el documento es nuevo: restaurado de la papelera o importado con esas
 *     columnas) → se conserva.
 *   · el dato del usuario cambió a algo que no se puede resolver → null.
 * Igual con fechaServicioISO. Al final se recalculan empresasIds y el estado con
 * los valores que quedan (para coincidir con la migración).
 */
export const cambiosCanonicos = (antes: Datos | undefined, despues: Datos, ctx: ContextoCanonico): Partial<CamposCanonicos> => {
  const { campos, pendientes } = camposCanonicos(despues, ctx);
  const salida = campos as Record<string, unknown>;
  const pendientesPorCampo = new Set(pendientes.map((p) => p.campo));
  const cambioElDato = (fuentes: readonly string[]): boolean => !!antes && fuentes.some((f) => !mismoValor(antes[f], despues[f]));
  const tieneValor = (v: unknown): boolean => v !== null && v !== undefined && String(v).trim() !== '';
  for (const campo of Object.keys(FUENTES_CANONICAS)) {
    if (!(campo in salida) && !pendientesPorCampo.has(campo)) continue; // no se calculó (p. ej. sin catálogo)
    if (typeof salida[campo] === 'string') continue;
    if (tieneValor(despues[campo]) && !cambioElDato(fuentesReales(campo))) delete salida[campo];
    else salida[campo] = null;
  }
  // Fecha: si el usuario borró o dejó ilegible la fecha de servicio, el día viejo ya no vale.
  if (!('fechaServicioISO' in salida) && cambioElDato(['fechaServicio'])) salida.fechaServicioISO = null;
  const final: Datos = { ...despues, ...campos };
  campos.empresasIds = empresasDeRoles(final);
  const texto = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
  Object.assign(campos, estadoYFacturacion(final, texto(final.statusId) || texto(final.status), ctx));
  return diferenciasCanonicas(despues, campos);
};
