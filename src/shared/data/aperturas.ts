// src/shared/data/aperturas.ts
// ---------------------------------------------------------------------------
// ✅ V00502 — ABRIR UN REGISTRO DESDE OTRO LADO (buscador global; "Ver pago" de Facturación).
//   `abrirRegistro(modulo, id)` deja un PEDIDO y lleva al módulo (roelca:navegar). El módulo lo
//   atiende con `useAtenderApertura` en cuanto se ve: sirve si ya estaba montado (MantenerVivo lo
//   deja vivo y oculto) y si se monta en ese momento. Antes cada módulo leía su pedido solo al
//   montarse (localStorage `roelca_abrir_registro`, pagoPedido): si ya estaba abierto, no pasaba
//   nada. Un pedido vale 2 minutos; uno viejo se descarta (no se abre solo más tarde).
// ---------------------------------------------------------------------------
import { useEffect, useEffectEvent, useSyncExternalStore } from 'react';
import { useModuloVivoActivo } from '../../utils/moduloVivoContexto';
import { avisar } from './avisos';

export interface PedidoApertura {
  /** Clave del módulo que lo atiende (la de `moduloActivo` en App.tsx). */
  modulo: string;
  /** Id del registro, como lo identifica ese módulo. */
  id: string;
  /** Dato extra que necesite el módulo (p. ej. la pestaña de Pagos). */
  tipo?: string;
  seq: number;
  ts: number;
}

export const VIGENCIA_APERTURA_MS = 2 * 60 * 1000;

// ✅ V00540: se quitó TIPO_APERTURA_EDITAR ('editar', V00538): Solucionar de la Revisión de datos ya no va al
//   módulo, abre el formulario encima de la ventana (EditorOperacionEmbebido / EditarFacturaClienteEmbebida).
/** ✅ V00539: `tipo` que pide dejar una operación lista para facturar (Facturación Clientes, Asignar operaciones). */
export const TIPO_APERTURA_FACTURAR = 'facturar';

let pedido: PedidoApertura | null = null;
let seq = 0;
const oyentes = new Set<() => void>();
const notificar = (): void => { oyentes.forEach((f) => { try { f(); } catch { /* oyente caído */ } }); };

/** Pide abrir el registro `id` en `modulo` y lleva a ese módulo. */
export const abrirRegistro = (modulo: string, id: string, tipo?: string): void => {
  seq += 1;
  pedido = { modulo, id, ...(tipo ? { tipo } : {}), seq, ts: Date.now() };
  notificar();
  window.dispatchEvent(new CustomEvent('roelca:navegar', { detail: { modulo } }));
};

/** El pedido pendiente para `modulo` (sin borrarlo), o null. */
export const pedidoAperturaDe = (modulo: string): PedidoApertura | null => (pedido && pedido.modulo === modulo ? pedido : null);

/** El módulo ya atendió (o descartó) ese pedido. */
export const aperturaAtendida = (p: PedidoApertura): void => {
  if (pedido?.seq !== p.seq) return;
  pedido = null;
  notificar();
};

const suscribir = (f: () => void): (() => void) => { oyentes.add(f); return () => { oyentes.delete(f); }; };

/** El pedido pendiente para `modulo`, en vivo. */
export const usePedidoApertura = (modulo: string): PedidoApertura | null =>
  useSyncExternalStore(suscribir, () => pedidoAperturaDe(modulo), () => null);

/**
 * En el módulo: atiende los pedidos dirigidos a él mientras se ve. `abrir` devuelve true si lo
 * atendió; false = todavía no puede (sus datos no han llegado): se vuelve a intentar cuando cambie
 * `listo`. Un pedido vencido se descarta sin abrir.
 */
export function useAtenderApertura(modulo: string, abrir: (p: PedidoApertura) => boolean, listo = true): void {
  const p = usePedidoApertura(modulo);
  const visible = useModuloVivoActivo();
  const intentar = useEffectEvent((ped: PedidoApertura): void => {
    if (Date.now() - ped.ts > VIGENCIA_APERTURA_MS) { aperturaAtendida(ped); return; }
    if (abrir(ped)) aperturaAtendida(ped);
  });
  useEffect(() => {
    if (p && visible && listo) intentar(p);
  }, [p, visible, listo]);
}

/** Aviso para cuando el registro pedido ya no está (se eliminó o cambió de id). */
export const avisarNoEncontrado = (que: string): void => {
  avisar({ titulo: `${que} no encontrado`, texto: 'El registro ya no existe (pudo eliminarse).', tipo: 'alerta' });
};
