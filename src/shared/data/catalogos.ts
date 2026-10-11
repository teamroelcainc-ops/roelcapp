// src/shared/data/catalogos.ts
// ---------------------------------------------------------------------------
// ✅ V00439 (Fase 3.4) — CATÁLOGOS: UN listener por colección para toda la app.
//
// Antes cada módulo bajaba sus catálogos por su cuenta (getDocs y onSnapshot
// repetidos: Operaciones 17 colecciones, el formulario 9 getDocs + 6 listeners,
// Completados 16 listeners…) y los copiaba a localStorage (cat_v1__/cat_v2__,
// roelca_catalogos_v2) con TTLs que otros módulos borraban. Ahora:
//   · Un solo onSnapshot por colección, compartido por todas las vistas.
//   · Con la caché persistente de Firestore (IndexedDB) los datos se pintan al
//     instante desde el disco y el servidor solo cobra lo que cambió si el
//     listener se reabre antes de 30 min.
//   · ✅ V00446: el listener de un catálogo queda abierto TODA la sesión (se cierra al
//     cerrar sesión). Abierto solo cobra lo que cambia; cerrarlo a los 15 min obligaba
//     a volver a bajar la colección completa (y a esperarla) al reabrirlo.
//   · Los avisos a React van agrupados y un módulo oculto no se repinta (ver
//     coleccionesVivas.ts).
//   · Siempre en vivo: no hay caché que invalidar después de escribir.
// Por eso NO se usa el documento de versiones de catálogos del plan (3.5): con
// listeners vivos no hay nada que invalidar (decisión en code-notes.md).
//
// Uso en componentes:
//   const { datos: empresas } = useCatalogo('empresas');
//   const { datos } = useCatalogos({ empresas: 'empresas', monedas: 'catalogo_moneda' });
// Fuera de React (servicios): await obtenerCatalogo('catalogo_tipos_gastos')
// ---------------------------------------------------------------------------
import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import { collection } from 'firebase/firestore';
import { auth, db } from '../../config/firebase';
import { useModuloVivoActivo } from '../../utils/moduloVivoContexto';
import {
  entradaViva, estadoVivo, idReal, obtenerVivo, pedirVivo, reiniciarVivas, soltarVivo, MINUTOS_PERMANENCIA,
} from './coleccionesVivas';
import type { DocVivo, EstadoVivo } from './coleccionesVivas';

/** Colecciones que se manejan como catálogo (pocas filas, cambian poco, las leen muchos módulos). */
export const COLECCIONES_CATALOGO = [
  'catalogo_status_servicio', 'catalogo_tipo_operacion', 'catalogo_tipo_servicio', 'catalogo_embalaje',
  'catalogo_moneda', 'catalogo_tarifas_referencia', 'catalogo_tipos_gastos', 'catalogo_carga_vacia',
  'catalogo_aduanas', 'catalogo_trafico', 'catalogo_tipo_empresa', 'catalogo_tipo_archivo', 'catalogo_formas_pago',
  'catalogo_tipo_remolque', 'catalogo_tipo_cargo', 'catalogo_regimen_fiscal', 'catalogo_paises', 'catalogo_estados',
  'catalogo_municipios', 'catalogo_departamentos', 'catalogo_bancos', 'catalogo_tipo_factura', 'catalogo_tipos_tarifarios',
  'empresas', 'empleados', 'unidades', 'remolques', 'unidades_proveedor', 'proveedores_unidad', 'direcciones',
  'convenios_clientes', 'convenios_clientes_detalles', 'convenios_proveedores', 'convenios_proveedores_detalles',
  'tarifario_clientes', 'tarifario_proveedores', 'tarifas_gastos_incluidos', 'tarifas_rendimiento',
  'tipo_cambio', 'config_flujos_operacion', 'roles',
] as const;

export type ColeccionCatalogo = (typeof COLECCIONES_CATALOGO)[number];

/** Documento de catálogo tal como lo guardan los módulos: { id, ...datos }. */
export type DocCatalogo = DocVivo;
export type EstadoCatalogo = EstadoVivo;
export { MINUTOS_PERMANENCIA, idReal };

const claveDe = (col: ColeccionCatalogo): string => `catalogo:${col}`;
const consultaDe = (col: ColeccionCatalogo) => () => collection(db, col);
const pedir = (col: ColeccionCatalogo): void => pedirVivo(claveDe(col), consultaDe(col), { permanente: true });
const soltar = (col: ColeccionCatalogo): void => soltarVivo(claveDe(col));

/** Estado actual de un catálogo (sin suscribirse). */
export const estadoCatalogo = (col: ColeccionCatalogo): EstadoCatalogo => estadoVivo(claveDe(col));

/**
 * Catálogo para servicios fuera de React. Abre (o reutiliza) el listener compartido
 * (queda abierto toda la sesión: las llamadas siguientes son inmediatas).
 * · Por omisión devuelve en cuanto hay datos (caché local o servidor).
 * · `fresco: true` espera la confirmación del SERVIDOR (máx. `esperaMs`; sin red, la
 *   caché): para los servicios que ESCRIBEN decidiendo con el catálogo (integridad de
 *   convenios, sincronizar nombres, mantenimiento de Catálogos).
 */
export const obtenerCatalogo = (col: ColeccionCatalogo, opciones: { fresco?: boolean; esperaMs?: number } = {}): Promise<DocCatalogo[]> =>
  obtenerVivo(claveDe(col), consultaDe(col), opciones.esperaMs ?? 6000, { fresco: opciones.fresco, permanente: true });

/**
 * ✅ V00447: abre en SEGUNDO PLANO, de uno en uno y cuando el navegador está libre, catálogos
 * que se van a necesitar pronto (los del formulario de operación), para que la primera vez
 * que se abra esa pantalla ya estén listos y no espere "Cargando catálogos…". Quedan abiertos
 * toda la sesión, como cualquier catálogo: son las mismas lecturas que haría abrir la pantalla.
 */
const enPrecalentado = new Set<ColeccionCatalogo>();
export const precalentarCatalogos = (cols: readonly ColeccionCatalogo[]): void => {
  const pendientes = Array.from(new Set(cols)).filter((c) => !estadoCatalogo(c).listo && !enPrecalentado.has(c));
  pendientes.forEach((c) => enPrecalentado.add(c));
  const cuandoLibre = (f: () => void) => {
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') window.requestIdleCallback(() => f(), { timeout: 4000 });
    else setTimeout(f, 200);
  };
  const siguiente = (i: number): void => {
    if (i >= pendientes.length) return;
    cuandoLibre(() => {
      const c = pendientes[i];
      if (!auth.currentUser) { pendientes.slice(i).forEach((x) => enPrecalentado.delete(x)); return; } // cerró sesión
      void obtenerCatalogo(c).finally(() => { enPrecalentado.delete(c); siguiente(i + 1); });
    });
  };
  siguiente(0);
};

/** Cierra todos los listeners (catálogos y consultas en vivo) y borra los datos (al cerrar sesión). */
export const reiniciarCatalogos = (): void => reiniciarVivas();

/**
 * Hook: un catálogo en vivo. Por defecto solo escucha mientras el módulo está a
 * la vista (MantenerVivo); oculto, conserva los últimos datos.
 * `activo: false` lee lo que haya sin pedir el listener (carga bajo demanda).
 */
export function useCatalogo(col: ColeccionCatalogo, opciones: { activo?: boolean } = {}): EstadoCatalogo {
  const visible = useModuloVivoActivo();
  const activo = (opciones.activo ?? true) && visible;
  // ✅ V00446: oculto no recibe avisos (no se repinta en segundo plano); al volver a
  //   verse se vuelve a suscribir y React toma el estado más reciente.
  const suscribir = useCallback((aviso: () => void) => {
    const e = entradaViva(claveDe(col));
    if (visible) e.oyentes.add(aviso);
    if (activo) pedir(col);
    return () => {
      e.oyentes.delete(aviso);
      if (activo) soltar(col);
    };
  }, [col, activo, visible]);
  const leer = useCallback(() => estadoCatalogo(col), [col]);
  return useSyncExternalStore(suscribir, leer, leer);
}

type MapaCatalogos = Record<string, ColeccionCatalogo>;
export interface EstadoCatalogos<M extends MapaCatalogos> {
  datos: { [K in keyof M]: DocCatalogo[] };
  /** Todos los catálogos pedidos tienen al menos un snapshot. */
  listo: boolean;
  errores: string[];
}

/**
 * Hook: varios catálogos con alias (para módulos que arman un objeto
 * `catalogosGlobales` por alias): { empresas: 'empresas', statusServicio: 'catalogo_status_servicio' }.
 */
export function useCatalogos<M extends MapaCatalogos>(mapa: M, opciones: { activo?: boolean } = {}): EstadoCatalogos<M> {
  const visible = useModuloVivoActivo();
  const activo = (opciones.activo ?? true) && visible;
  // El mapa puede llegar como objeto nuevo en cada render: todo se deriva de su
  // contenido (clave), no de su identidad.
  const clave = Object.entries(mapa).map(([a, c]) => `${a}:${c}`).sort().join('|');
  const mapaEstable = useMemo(
    () => Object.fromEntries(clave.split('|').filter(Boolean).map((par) => par.split(':'))) as M,
    [clave],
  );
  const colecciones = useMemo(() => Array.from(new Set(Object.values(mapaEstable))) as ColeccionCatalogo[], [mapaEstable]);

  const suscribir = useCallback((aviso: () => void) => {
    colecciones.forEach((c) => { if (visible) entradaViva(claveDe(c)).oyentes.add(aviso); if (activo) pedir(c); });
    return () => {
      colecciones.forEach((c) => { entradaViva(claveDe(c)).oyentes.delete(aviso); if (activo) soltar(c); });
    };
  }, [colecciones, activo, visible]);

  // getSnapshot debe devolver el MISMO objeto mientras nada cambie: cada
  // actualización reemplaza el objeto de estado de su colección, así que basta
  // comparar por identidad los estados de las colecciones pedidas.
  const cache = useRef<{ clave: string; estados: EstadoCatalogo[]; valor: EstadoCatalogos<M> } | null>(null);
  const leer = useCallback((): EstadoCatalogos<M> => {
    const estados = colecciones.map((c) => estadoCatalogo(c));
    const previo = cache.current;
    if (previo && previo.clave === clave && previo.estados.every((s, i) => s === estados[i])) return previo.valor;
    const datos = {} as { [K in keyof M]: DocCatalogo[] };
    (Object.keys(mapaEstable) as (keyof M)[]).forEach((alias) => { datos[alias] = estadoCatalogo(mapaEstable[alias]).datos; });
    const valor: EstadoCatalogos<M> = {
      datos,
      listo: estados.every((s) => s.listo),
      errores: estados.map((s) => s.error).filter((x): x is string => !!x),
    };
    cache.current = { clave, estados, valor };
    return valor;
  }, [colecciones, clave, mapaEstable]);

  return useSyncExternalStore(suscribir, leer, leer);
}
