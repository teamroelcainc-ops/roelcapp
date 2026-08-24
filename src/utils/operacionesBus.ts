// src/utils/operacionesBus.ts
// ✅ V00126: BUS DE CAMBIOS DE OPERACIONES.
//   Cualquier módulo que escriba en la colección `operaciones` avisa aquí;
//   Facturación (clientes/proveedores) y Pagos escuchan y actualizan su vista
//   al instante, además de invalidar sus cachés de sesión para que la próxima
//   carga vuelva a leer de Firestore.
import { almacenSesion } from './cacheMemoria';

export const EVENTO_OPERACION_GUARDADA = 'roelca:operacion-guardada';

// Claves de caché de sesión que dependen de `operaciones`.
const CACHES_DEPENDIENTES_DE_OPERACIONES = [
  'roelca_ops_completadas_v2',        // Facturación Clientes
  'roelca_ops_prov_completadas_v2',   // Facturación Proveedores
];

export interface OperacionGuardadaDetalle {
  id: string;
  data: Record<string, unknown>;
  origen?: string;
}

export const notificarOperacionGuardada = (id: string, data: Record<string, unknown>, origen = 'operaciones') => {
  CACHES_DEPENDIENTES_DE_OPERACIONES.forEach((k) => { try { almacenSesion.removeItem(k); } catch { /* noop */ } });
  try {
    window.dispatchEvent(new CustomEvent<OperacionGuardadaDetalle>(EVENTO_OPERACION_GUARDADA, { detail: { id: String(id), data, origen } }));
  } catch { /* SSR / entorno sin window */ }
};

export const suscribirOperacionGuardada = (cb: (d: OperacionGuardadaDetalle) => void): (() => void) => {
  const handler = (e: Event) => { const d = (e as CustomEvent<OperacionGuardadaDetalle>).detail; if (d && d.id) cb(d); };
  window.addEventListener(EVENTO_OPERACION_GUARDADA, handler);
  return () => window.removeEventListener(EVENTO_OPERACION_GUARDADA, handler);
};
