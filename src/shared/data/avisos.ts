// src/shared/data/avisos.ts
// ---------------------------------------------------------------------------
// ✅ V00450 — AVISOS de la app (sin Firestore): notificaciones flotantes
// (esquina inferior derecha) y conteos de "Revisión" que muestra la campana.
//   · avisar(...)            → notificación flotante (se quita sola).
//   · publicarRevision(...)  → cuántas operaciones hay en Revisión en un módulo;
//                              avisa solo por las que son NUEVAS en la sesión.
//   · irARevision(modulo)    → abre el módulo en su pestaña Revisión.
// Se leen con useAvisos() / usePestanaPedida() (useSyncExternalStore).
// ---------------------------------------------------------------------------
import { useSyncExternalStore } from 'react';

export type ModuloRevision = 'operaciones' | 'facturacionClientes';

export const NOMBRE_MODULO_REVISION: Record<ModuloRevision, string> = {
  operaciones: 'Operaciones Activas',
  facturacionClientes: 'Facturación de Clientes',
};

export interface AvisoFlotante {
  id: number;
  titulo: string;
  texto: string;
  tipo: 'alerta' | 'info';
  /** Si viene, el aviso lleva el botón "Ver" que abre la pestaña Revisión de ese módulo. */
  modulo?: ModuloRevision;
}

export interface Revision {
  n: number;
  /** Hasta 5 referencias para el texto de la campana. */
  muestra: string[];
}

interface Estado {
  flotantes: AvisoFlotante[];
  revisiones: Record<ModuloRevision, Revision>;
  pestanaPedida: ModuloRevision | null;
}

const DURACION_MS = 10_000;
const MAX_FLOTANTES = 4;

let estado: Estado = {
  flotantes: [],
  revisiones: { operaciones: { n: 0, muestra: [] }, facturacionClientes: { n: 0, muestra: [] } },
  pestanaPedida: null,
};
const oyentes = new Set<() => void>();
const cambiar = (parcial: Partial<Estado>): void => {
  estado = { ...estado, ...parcial };
  oyentes.forEach((f) => f());
};
const suscribir = (f: () => void): (() => void) => {
  oyentes.add(f);
  return () => { oyentes.delete(f); };
};
const leer = (): Estado => estado;

let siguienteId = 1;
const temporizadores = new Map<number, ReturnType<typeof setTimeout>>();

export const quitarAviso = (id: number): void => {
  const t = temporizadores.get(id);
  if (t) clearTimeout(t);
  temporizadores.delete(id);
  if (estado.flotantes.some((a) => a.id === id)) cambiar({ flotantes: estado.flotantes.filter((a) => a.id !== id) });
};

/** Muestra una notificación flotante. Devuelve su id. */
export const avisar = (aviso: Omit<AvisoFlotante, 'id'>): number => {
  const id = siguienteId++;
  const flotantes = [...estado.flotantes, { ...aviso, id }];
  // Las más viejas se van si hay demasiadas.
  while (flotantes.length > MAX_FLOTANTES) {
    const viejo = flotantes.shift();
    if (viejo) { const t = temporizadores.get(viejo.id); if (t) clearTimeout(t); temporizadores.delete(viejo.id); }
  }
  cambiar({ flotantes });
  temporizadores.set(id, setTimeout(() => quitarAviso(id), DURACION_MS));
  return id;
};

/** IDs ya avisados en esta sesión (por módulo): no se repite el aviso al volver a entrar. */
const avisadas: Record<ModuloRevision, Set<string>> = { operaciones: new Set(), facturacionClientes: new Set() };

/**
 * Publica cuántas operaciones hay en Revisión en un módulo. Si entró alguna que no se había
 * avisado en la sesión, muestra la notificación.
 * @param ids IDs de las operaciones en Revisión.
 * @param describir texto corto de cada una (para el aviso y la campana).
 */
export const publicarRevision = (modulo: ModuloRevision, ids: readonly string[], describir: (id: string) => string): void => {
  const nuevas = ids.filter((id) => !avisadas[modulo].has(id));
  nuevas.forEach((id) => avisadas[modulo].add(id));
  const muestra = ids.slice(0, 5).map(describir);
  const previa = estado.revisiones[modulo];
  if (previa.n !== ids.length || previa.muestra.join('|') !== muestra.join('|')) {
    cambiar({ revisiones: { ...estado.revisiones, [modulo]: { n: ids.length, muestra } } });
  }
  if (nuevas.length === 0) return;
  const lista = nuevas.slice(0, 3).map(describir).join(', ') + (nuevas.length > 3 ? ` y ${nuevas.length - 3} más` : '');
  avisar({
    tipo: 'alerta',
    titulo: 'REF Cliente duplicada',
    texto: nuevas.length === 1
      ? `${lista} tiene una Ref Cliente que ya existe en otra operación. Pasó a la pestaña Revisión de ${NOMBRE_MODULO_REVISION[modulo]}.`
      : `${nuevas.length} operaciones tienen una Ref Cliente que ya existe en otra operación (${lista}). Pasaron a la pestaña Revisión de ${NOMBRE_MODULO_REVISION[modulo]}.`,
    modulo,
  });
};

/** Abre el módulo en su pestaña Revisión (desde la campana o desde un aviso). */
export const irARevision = (modulo: ModuloRevision): void => {
  cambiar({ pestanaPedida: modulo });
  window.dispatchEvent(new CustomEvent('roelca:navegar', { detail: { modulo } }));
};

/** El módulo ya abrió su pestaña Revisión. */
export const pestanaAtendida = (modulo: ModuloRevision): void => {
  if (estado.pestanaPedida === modulo) cambiar({ pestanaPedida: null });
};

export function useAvisos(): Estado {
  return useSyncExternalStore(suscribir, leer, leer);
}

/** true cuando alguien pidió abrir la pestaña Revisión de este módulo. */
export function usePestanaPedida(modulo: ModuloRevision): boolean {
  return useSyncExternalStore(suscribir, () => estado.pestanaPedida === modulo, () => false);
}

/** Solo pruebas. */
export const reiniciarAvisos = (): void => {
  temporizadores.forEach((t) => clearTimeout(t));
  temporizadores.clear();
  avisadas.operaciones.clear();
  avisadas.facturacionClientes.clear();
  estado = {
    flotantes: [],
    revisiones: { operaciones: { n: 0, muestra: [] }, facturacionClientes: { n: 0, muestra: [] } },
    pestanaPedida: null,
  };
  oyentes.forEach((f) => f());
};
