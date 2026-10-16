// src/features/operaciones/services/pestanaCompletadas.ts
// ✅ V00456: la tarjeta "Operaciones del día" (Resumen del día, en App.tsx) pide al
//   tablero de Operaciones Activas que abra la pestaña "Completadas hoy". Cada
//   pedido sube un contador; el tablero reacciona cuando cambia.
import { useSyncExternalStore } from 'react';

let pedidos = 0;
const oyentes = new Set<() => void>();

export const pedirCompletadasHoy = (): void => {
  pedidos += 1;
  oyentes.forEach((o) => o());
};

const suscribir = (o: () => void) => { oyentes.add(o); return () => { oyentes.delete(o); }; };
const leer = () => pedidos;

/** Número de veces que se pidió la pestaña (0 = nunca). */
export function usePedidosCompletadasHoy(): number {
  return useSyncExternalStore(suscribir, leer, leer);
}
