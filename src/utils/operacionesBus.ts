// src/utils/operacionesBus.ts
// ✅ V00126: BUS DE CAMBIOS DE OPERACIONES.
//   Cualquier módulo que escriba en la colección `operaciones` avisa aquí;
//   Facturación (clientes/proveedores) y Pagos escuchan y actualizan su vista
//   al instante, además de invalidar sus cachés de sesión para que la próxima
//   carga vuelva a leer de Firestore.
import { almacenSesion } from './cacheMemoria';
import { esOperacionPrueba } from './operacionPrueba';

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
  /**
   * ✅ V00451: campos que CAMBIARON (si el que avisa lo sabe). `data` trae la operación completa
   * (para quien no la tiene en su lista), pero puede ser una copia vieja: quien ya la tiene aplica
   * solo estos campos y no pisa datos más nuevos.
   */
  campos?: readonly string[];
}

/** Lo que hay que aplicar a una operación que YA está en la lista: solo los campos que cambiaron, si se saben. */
export const datosAAplicar = ({ data, campos }: Pick<OperacionGuardadaDetalle, 'data' | 'campos'>): Record<string, unknown> =>
  campos ? Object.fromEntries(campos.filter((c) => c in data).map((c) => [c, data[c]])) : data;

export const notificarOperacionGuardada = (id: string, data: Record<string, unknown>, origen = 'operaciones', campos?: readonly string[]) => {
  CACHES_DEPENDIENTES_DE_OPERACIONES.forEach((k) => { try { almacenSesion.removeItem(k); } catch { /* noop */ } });
  try {
    window.dispatchEvent(new CustomEvent<OperacionGuardadaDetalle>(EVENTO_OPERACION_GUARDADA, { detail: { id: String(id), data, origen, ...(campos ? { campos } : {}) } }));
  } catch { /* SSR / entorno sin window */ }
};

export const suscribirOperacionGuardada = (cb: (d: OperacionGuardadaDetalle) => void): (() => void) => {
  // ✅ V00380: las operaciones de PRUEBA nunca llegan a Facturación/Pagos.
  const handler = (e: Event) => { const d = (e as CustomEvent<OperacionGuardadaDetalle>).detail; if (d && d.id && !esOperacionPrueba(d.data)) cb(d); };
  window.addEventListener(EVENTO_OPERACION_GUARDADA, handler);
  return () => window.removeEventListener(EVENTO_OPERACION_GUARDADA, handler);
};
