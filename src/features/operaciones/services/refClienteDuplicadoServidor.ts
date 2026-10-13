// src/features/operaciones/services/refClienteDuplicadoServidor.ts
// ---------------------------------------------------------------------------
// ✅ V00450 — REF CLIENTE DUPLICADA: lo que toca Firestore.
//   · verificarRefsEnServidor: busca en TODA la colección `operaciones` (activas,
//     completadas, facturadas) otras operaciones con la misma Ref Cliente. Las
//     pantallas solo tienen cargada una parte (Activas trae 50 por página), por
//     eso no basta comparar en memoria. `where('refCliente', 'in', …)` en lotes de
//     30 valores con las variantes de escritura; cada Ref se consulta una vez cada
//     5 minutos por sesión (no en cada render ni en cada pantalla).
//   · marcarNoDuplicado: guarda `refClienteRevisado` en todas las del grupo.
// Un pequeño almacén en memoria avisa a los hooks cuando llega una respuesta.
// ---------------------------------------------------------------------------
import { collection, doc, getDocs, query, updateDoc, where } from 'firebase/firestore';
import { auth, db } from '../../../config/firebase';
import { registrarLog } from '../../../utils/logger';
import { suscribirOperacionGuardada } from '../../../utils/operacionesBus';
import { claveRefCliente, cuentaParaDuplicado, describirOp, resumenOp, variantesConsulta } from './refClienteDuplicado';
import type { OpRefResumen } from './refClienteDuplicado';

const VIGENCIA_MS = 5 * 60_000;
const REINTENTO_MS = 60_000;
const VALORES_POR_CONSULTA = 30; // tope de Firestore para `in`
const CONSULTAS_EN_PARALELO = 4;

const porClave = new Map<string, OpRefResumen[]>();
const consultadaEn = new Map<string, number>();
const enVuelo = new Set<string>();
/** Promesa de la consulta en curso (o en cola) de cada clave: quien pide una Ref que ya viene en
 *  camino la espera en vez de quedarse sin respuesta. */
const promesas = new Map<string, Promise<void>>();
/** Escrituras de cada clave vistas en la sesión: cada consulta las incluye todas (≤30). */
const variantesConocidas = new Map<string, (string | number)[]>();
/** Marcadas "No es duplicado" en esta sesión (por ID y por `ref:` consecutivo) → clave. Así las
 *  demás pantallas abiertas las sacan de Revisión sin volver a leer su lista. */
const marcadas = new Map<string, string>();
let version = 0;
const oyentes = new Set<() => void>();
const avisar = (): void => {
  version += 1;
  oyentes.forEach((f) => f());
};

export const suscribirRefCliente = (f: () => void): (() => void) => {
  oyentes.add(f);
  return () => { oyentes.delete(f); };
};
export const versionRefCliente = (): number => version;
export const resultadosRefCliente = (): ReadonlyMap<string, readonly OpRefResumen[]> => porClave;
export const claveEnConsulta = (clave: string): boolean => enVuelo.has(clave);
/** Clave con la que se marcó "No es duplicado" en esta sesión ('' si no se marcó). */
export const marcaEnSesion = (r: Pick<OpRefResumen, 'id' | 'ref'>): string =>
  marcadas.get(r.id) ?? (r.ref ? marcadas.get(`ref:${r.ref}`) : undefined) ?? '';

/** Para pruebas y para "Actualizar": olvida lo consultado. */
export const olvidarRefsConsultadas = (): void => {
  porClave.clear();
  consultadaEn.clear();
  marcadas.clear();
  avisar();
};

const sacarDeGrupos = (id: string): boolean => {
  let cambio = false;
  for (const [c, lista] of porClave) {
    const sin = lista.filter((r) => r.id !== id);
    if (sin.length !== lista.length) { porClave.set(c, sin); cambio = true; }
  }
  return cambio;
};

/** Saca una operación de lo consultado (se borró). */
export const quitarOperacionDeRefs = (id: string): void => {
  if (sacarDeGrupos(id)) avisar();
};

/**
 * Se guardó una operación en esta sesión (formulario, status, cancelar…): lo consultado se
 * corrige al momento, sin esperar 5 minutos. Avisos parciales (sin `refCliente` ni status) no
 * cambian nada.
 */
export const operacionGuardadaEnRefs = (id: string, datos: Record<string, unknown>): void => {
  const traeRef = Object.prototype.hasOwnProperty.call(datos, 'refCliente');
  const traeStatus = 'status' in datos || 'statusNombre' in datos;
  if (!traeRef && !traeStatus) return;
  const cuenta = cuentaParaDuplicado(datos);
  if (!traeRef && cuenta) return; // cambio de status que no la saca: sigue igual
  let cambio = sacarDeGrupos(id);
  if (traeRef && cuenta) {
    const r = resumenOp(datos, id);
    const lista = r.clave ? porClave.get(r.clave) : undefined;
    if (lista) { porClave.set(r.clave, [...lista, r]); cambio = true; }
  }
  if (cambio) avisar();
};
if (typeof window !== 'undefined') suscribirOperacionGuardada(({ id, data }) => operacionGuardadaEnRefs(id, data));

// Cola con tope de consultas simultáneas; `primero` (formulario) se adelanta a la cola.
let activas = 0;
const cola: (() => void)[] = [];
const conTope = (fn: () => Promise<void>, primero: boolean): Promise<void> => new Promise<void>((ok) => {
  const correr = (): void => {
    activas += 1;
    void fn().finally(() => {
      activas -= 1;
      ok();
      const sig = cola.shift();
      if (sig) sig();
    });
  };
  if (activas < CONSULTAS_EN_PARALELO) correr();
  else if (primero) cola.unshift(correr);
  else cola.push(correr);
});

/** Arma lotes de ≤30 valores sin partir las variantes de una clave entre dos lotes. */
export const armarLotes = (variantes: ReadonlyMap<string, readonly (string | number)[]>): { claves: string[]; valores: (string | number)[] }[] => {
  const lotes: { claves: string[]; valores: (string | number)[] }[] = [];
  let actual: { claves: string[]; valores: (string | number)[] } = { claves: [], valores: [] };
  for (const [clave, vs] of variantes) {
    const valores = vs.slice(0, VALORES_POR_CONSULTA);
    if (actual.valores.length + valores.length > VALORES_POR_CONSULTA && actual.claves.length) {
      lotes.push(actual);
      actual = { claves: [], valores: [] };
    }
    actual.claves.push(clave);
    actual.valores.push(...valores);
  }
  if (actual.claves.length) lotes.push(actual);
  return lotes;
};

const consultarLote = async (lote: { claves: string[]; valores: (string | number)[] }): Promise<void> => {
  const encontrados = new Map<string, OpRefResumen[]>(lote.claves.map((c) => [c, []]));
  try {
    const snap = await getDocs(query(collection(db, 'operaciones'), where('refCliente', 'in', lote.valores)));
    snap.docs.forEach((d) => {
      const datos = d.data();
      if (!cuentaParaDuplicado(datos)) return;
      const r = resumenOp(datos, d.id);
      const lista = encontrados.get(r.clave);
      if (lista && !lista.some((x) => x.id === r.id)) lista.push(r);
    });
    const ahora = Date.now();
    for (const [c, lista] of encontrados) {
      porClave.set(c, lista);
      consultadaEn.set(c, ahora);
    }
  } catch (e) {
    console.warn('[REF Cliente] No se pudo verificar en el servidor (se reintenta en 1 min):', e);
    const reintento = Date.now() - VIGENCIA_MS + REINTENTO_MS;
    lote.claves.forEach((c) => consultadaEn.set(c, reintento));
  } finally {
    lote.claves.forEach((c) => enVuelo.delete(c));
    avisar();
  }
};

/**
 * Consulta en el servidor las Ref Cliente que no se hayan consultado en los últimos 5 minutos.
 * Recibe los valores tal cual están capturados (para buscar también esa escritura exacta).
 */
export const verificarRefsEnServidor = async (refs: readonly unknown[], primero = false): Promise<void> => {
  const ahora = Date.now();
  const variantes = new Map<string, (string | number)[]>();
  const enCamino = new Set<Promise<void>>();
  for (const r of refs) {
    const c = claveRefCliente(r);
    if (!c) continue;
    const conocidas = variantesConocidas.get(c) ?? [];
    for (const v of variantesConsulta(r)) if (!conocidas.includes(v)) conocidas.push(v);
    variantesConocidas.set(c, conocidas);
    const pendiente = promesas.get(c);
    if (pendiente) { enCamino.add(pendiente); continue; }
    const t = consultadaEn.get(c);
    if (t !== undefined && ahora - t < VIGENCIA_MS) continue;
    variantes.set(c, conocidas);
  }
  if (variantes.size > 0) {
    variantes.forEach((_, c) => enVuelo.add(c));
    avisar();
    for (const lote of armarLotes(variantes)) {
      const p: Promise<void> = conTope(() => consultarLote(lote), primero).finally(() => {
        // Solo si sigue siendo la suya (no una consulta posterior de la misma clave).
        lote.claves.forEach((c) => { if (promesas.get(c) === p) promesas.delete(c); });
      });
      lote.claves.forEach((c) => promesas.set(c, p));
      enCamino.add(p);
    }
  }
  await Promise.all(enCamino);
};

/**
 * Busca UNA Ref al momento (formulario): devuelve las operaciones con esa Ref, sin la que se
 * está editando. Usa lo ya consultado si es reciente.
 */
export const buscarRefCliente = async (valor: unknown, excluir: { id?: string; ref?: string }): Promise<OpRefResumen[]> => {
  const c = claveRefCliente(valor);
  if (!c) return [];
  await verificarRefsEnServidor([valor], true);
  const lista = porClave.get(c) ?? [];
  // La operación que se edita: por ID; por consecutivo solo si su ID no volvió y UNA sola lo tiene.
  if (excluir.id && lista.some((r) => r.id === excluir.id)) return lista.filter((r) => r.id !== excluir.id);
  const mismoFolio = excluir.ref ? lista.filter((r) => r.ref === excluir.ref) : [];
  return mismoFolio.length === 1 ? lista.filter((r) => r !== mismoFolio[0]) : [...lista];
};

/**
 * "No es duplicado": marca TODAS las del grupo (las que aún no lo estén) con la clave actual.
 * Devuelve las que se marcaron y las que no; lanza si no se pudo marcar ninguna.
 */
export const marcarNoDuplicado = async (
  clave: string, grupo: readonly OpRefResumen[], modulo: string,
): Promise<{ hechas: OpRefResumen[]; fallidas: OpRefResumen[] }> => {
  const porMarcar = grupo.filter((r) => !r.revisada && r.clave === clave);
  if (porMarcar.length === 0) return { hechas: [], fallidas: [] };
  const datos = {
    refClienteRevisado: clave,
    refClienteRevisadoPor: auth.currentUser?.email || '',
    refClienteRevisadoEn: new Date().toISOString(),
  };
  const res = await Promise.allSettled(porMarcar.map((r) => updateDoc(doc(db, 'operaciones', r.id), datos)));
  const hechas = porMarcar.filter((_, i) => res[i].status === 'fulfilled');
  const fallidas = porMarcar.filter((_, i) => res[i].status === 'rejected');
  if (hechas.length === 0) {
    const err = res.find((x) => x.status === 'rejected');
    throw (err && err.status === 'rejected' ? err.reason : new Error('No se pudo marcar'));
  }
  const ids = new Set(hechas.map((r) => r.id));
  hechas.forEach((r) => {
    marcadas.set(r.id, clave);
    if (r.ref) marcadas.set(`ref:${r.ref}`, clave);
  });
  const lista = porClave.get(clave);
  if (lista) porClave.set(clave, lista.map((r) => (ids.has(r.id) ? { ...r, revisada: true } : r)));
  avisar();
  void registrarLog(modulo, 'Edición', `Marcó la Ref Cliente "${clave}" como NO duplicada en ${hechas.length} operación(es): ${hechas.map(describirOp).join(', ')}.`);
  return { hechas, fallidas };
};
