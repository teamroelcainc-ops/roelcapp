// src/features/operaciones/hooks/useRefClienteDuplicados.ts
// ---------------------------------------------------------------------------
// ✅ V00450 — REF CLIENTE DUPLICADA en una lista de operaciones (Operaciones
// Activas, Facturación de Clientes). Compara la lista en memoria y, para las
// operaciones que pueden ir a Revisión (`candidata`), consulta el servidor (toda
// la colección) una vez cada 5 minutos por Ref. Publica el conteo para la campana
// y el aviso flotante (src/shared/data/avisos.ts).
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useEffectEvent, useMemo, useSyncExternalStore } from 'react';
import { claveRefCliente, cuentaParaDuplicado, describirOp, detectarDuplicados, resumenOp } from '../services/refClienteDuplicado';
import type { InfoDuplicado, OpRefResumen } from '../services/refClienteDuplicado';
import {
  claveEnConsulta, marcaEnSesion, resultadosRefCliente, suscribirRefCliente, verificarRefsEnServidor, versionRefCliente,
} from '../services/refClienteDuplicadoServidor';
import { publicarRevision } from '../../../shared/data/avisos';
import type { ModuloRevision } from '../../../shared/data/avisos';
import { aFechaISO } from '../../../shared/dominio/fechas';

type Datos = Record<string, unknown>;

/** ID con el que la lista identifica a la operación (`_docId` = ID real cuando existe). */
export const idDeLista = (op: Datos): string => String(op._docId ?? op.id ?? '');

export interface DuplicadosRefCliente {
  /** Por ID de la lista: las operaciones (candidatas o no) que tienen otra con la misma Ref. */
  porOp: Map<string, InfoDuplicado>;
  /** IDs de las candidatas con Ref duplicada SIN revisar: van a la pestaña Revisión. Mismo
   *  objeto mientras no cambie su contenido (las pantallas filtran miles de filas con él). */
  enRevision: Set<string>;
  /** Todavía se está consultando el servidor por alguna Ref de las candidatas. */
  verificando: boolean;
  /** La Ref de esta operación todavía no se termina de revisar (lista cargando o consulta en
   *  camino): no se debe facturar todavía. */
  pendienteDeVerificar: (op: Datos) => boolean;
}

interface Opciones {
  modulo: ModuloRevision;
  /** false = no consulta, no avisa y no marca nada (p. ej. mientras la lista se descarga). */
  activo: boolean;
  /** Qué operaciones de la lista pueden ir a Revisión (por omisión, todas). */
  candidata?: (op: Datos) => boolean;
  /** Tope de Ref que se consultan en el servidor (las de fecha de servicio más reciente). Las
   *  demás se comparan solo contra la lista cargada. Acota las lecturas si hay miles pendientes. */
  maxServidor?: number;
}

const MAX_SERVIDOR = 400;
/** Se vuelven a consultar (solo las que están en Revisión) al vencer su vigencia de 5 min. */
const REVISAR_CADA_MS = 5 * 60_000 + 5_000;
const SEP = '\u0001';
const fechaOrden = (op: Datos): string =>
  String(op.fechaServicioISO ?? '') || aFechaISO(op.fechaServicio) || aFechaISO(op.createdAt) || '';

export function useRefClienteDuplicados(ops: readonly Datos[], { modulo, activo, candidata, maxServidor = MAX_SERVIDOR }: Opciones): DuplicadosRefCliente {
  const version = useSyncExternalStore(suscribirRefCliente, versionRefCliente, versionRefCliente);

  // TODA la lista entra (las que no cuentan, con clave ''): así su copia vieja del servidor no
  // sigue contando si se canceló, quedó sin Ref o cambió de Ref.
  const { locales, candidatas, refsCandidatas } = useMemo(() => {
    const ls: OpRefResumen[] = [];
    const cs = new Set<string>();
    const paraServidor: Datos[] = [];
    for (const op of ops) {
      const r = resumenOp(op, idDeLista(op));
      if (!cuentaParaDuplicado(op)) { ls.push({ ...r, clave: '' }); continue; }
      ls.push(r);
      if (!r.clave) continue;
      if (!candidata || candidata(op)) {
        cs.add(r.id);
        paraServidor.push(op);
      }
    }
    // Las más recientes primero; el resto solo se compara en memoria.
    if (paraServidor.length > maxServidor) paraServidor.sort((a, b) => fechaOrden(b).localeCompare(fechaOrden(a)));
    const refs = paraServidor.slice(0, maxServidor).map((op) => op.refCliente);
    return { locales: ls, candidatas: cs, refsCandidatas: refs };
  }, [ops, candidata, maxServidor]);

  // Firma de las Ref a consultar: el efecto solo corre cuando cambian.
  const firma = useMemo(() => [...new Set(refsCandidatas.map((r) => String(r)))].sort().join(SEP), [refsCandidatas]);
  const verificar = useEffectEvent(() => { void verificarRefsEnServidor(refsCandidatas); });
  useEffect(() => {
    if (!activo || !firma) return undefined;
    const t = setTimeout(verificar, 400);
    return () => clearTimeout(t);
  }, [activo, firma]);

  const calculado = useMemo(() => {
    void version; // se recalcula cuando llega una respuesta del servidor o se marca una
    // Mientras la lista se (re)descarga no se decide nada: evita sacar y regresar filas.
    if (!activo) return { porOp: new Map<string, InfoDuplicado>(), firmaRevision: '', verificando: false };
    // Marcadas "No es duplicado" desde otra pantalla en esta sesión: ya no van a Revisión.
    const conMarcas = locales.map((l) => (l.clave && !l.revisada && marcaEnSesion(l) === l.clave ? { ...l, revisada: true } : l));
    const porOp = detectarDuplicados(conMarcas, resultadosRefCliente());
    const ids: string[] = [];
    porOp.forEach((info, id) => { if (candidatas.has(id) && !info.revisada) ids.push(id); });
    const verificando = locales.some((l) => l.clave !== '' && candidatas.has(l.id) && claveEnConsulta(l.clave));
    return { porOp, firmaRevision: ids.sort().join(SEP), verificando };
  }, [locales, candidatas, version, activo]);

  const { porOp, firmaRevision, verificando } = calculado;
  const enRevision = useMemo(() => new Set(firmaRevision ? firmaRevision.split(SEP) : []), [firmaRevision]);

  const pendienteDeVerificar = useCallback((op: Datos): boolean => {
    void version;
    if (!activo) return true;
    const c = claveRefCliente(op.refCliente);
    return !!c && claveEnConsulta(c);
  }, [activo, version]);

  // Las que están en Revisión se vuelven a consultar al vencer: si la otra operación se corrigió
  // en otra pantalla o la canceló otra persona, salen solas.
  const refsEnRevision = useMemo(
    () => ops.filter((op) => enRevision.has(idDeLista(op))).map((op) => op.refCliente),
    [ops, enRevision],
  );
  const revisarDeNuevo = useEffectEvent(() => { void verificarRefsEnServidor(refsEnRevision); });
  useEffect(() => {
    if (!activo || !firmaRevision) return undefined;
    const t = setInterval(revisarDeNuevo, REVISAR_CADA_MS);
    return () => clearInterval(t);
  }, [activo, firmaRevision]);

  // Campana + aviso flotante (solo las nuevas de la sesión).
  const publicar = useEffectEvent(() => {
    const porId = new Map(locales.map((l) => [l.id, l]));
    publicarRevision(modulo, [...enRevision], (id) => {
      const l = porId.get(id);
      return l ? describirOp(l) : id;
    });
  });
  // Con un respiro: lo que llega junto (páginas, respuestas del servidor) sale en UN aviso.
  useEffect(() => {
    if (!activo) return undefined;
    const t = setTimeout(publicar, 1200);
    return () => clearTimeout(t);
  }, [activo, firmaRevision]);

  return useMemo(
    () => ({ porOp, enRevision, verificando, pendienteDeVerificar }),
    [porOp, enRevision, verificando, pendienteDeVerificar],
  );
}
