// src/features/operaciones/services/convenioFalsoDatos.ts
// ---------------------------------------------------------------------------
// ✅ V00509 — LECTURAS del convenio de Falso (la regla está en convenioFalso.ts). Lo usan todos los
// lugares que cambian el estatus de una operación (los mismos que aplican el sueldo de Falso):
// Operaciones Activas, Canceladas, Regresar estatus (Completadas), el formulario y Mis Operaciones.
//   · Solo lee algo si la operación ENTRA o SALE de Falso.
//   · Relee la operación (no la copia de la lista) y los convenios del cliente esperando al
//     servidor (`fresco`): decide un monto, no solo lo muestra.
//   · Nunca detiene el cambio de estatus: si algo falla, devuelve un aviso y no cambia el convenio.
// ---------------------------------------------------------------------------
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { obtenerCatalogo } from '../../../shared/data/catalogos';
import { avisar } from '../../../shared/data/avisos';
import { ajusteConvenioPorStatus, cambiaFalso, SIN_AJUSTE } from './convenioFalso';
import type { AjusteConvenio, CatalogosConvenio } from './convenioFalso';

type Datos = Record<string, unknown>;

const FALLO: AjusteConvenio = {
  cambios: {}, tipo: 'alerta',
  mensaje: 'No se pudieron leer los convenios del cliente: el convenio no se cambió por el de Falso. Cámbialo en Editar.',
};

export const cargarCatalogosConvenio = async (): Promise<CatalogosConvenio> => {
  const [maestros, detalles, tarifas, tarifarios] = await Promise.all([
    obtenerCatalogo('convenios_clientes', { fresco: true }),
    obtenerCatalogo('convenios_clientes_detalles', { fresco: true }),
    obtenerCatalogo('catalogo_tarifas_referencia', { fresco: true }),
    obtenerCatalogo('tarifario_clientes', { fresco: true }),
  ]);
  return { maestros, detalles, tarifas, tarifarios };
};

/**
 * Para los cambios de estatus que escriben con un batch: relee la operación `idDoc` y calcula el
 * ajuste del convenio. `pendientes` = lo que la misma escritura va a cambiar (el formulario: su
 * convenio) y se toma en cuenta para decidir.
 */
export const ajusteConvenioAlCambiarStatus = async (idDoc: string, statusNuevo: string, pendientes: Datos = {}): Promise<AjusteConvenio> => {
  try {
    const snap = await getDoc(doc(db, 'operaciones', idDoc));
    if (!snap.exists()) return SIN_AJUSTE;
    const guardada = snap.data() as Datos;
    const anterior = String(guardada.statusNombre ?? '');
    if (!cambiaFalso(anterior, statusNuevo)) return SIN_AJUSTE;
    return ajusteConvenioPorStatus({ ...guardada, ...pendientes }, statusNuevo, await cargarCatalogosConvenio(), anterior);
  } catch (e) {
    console.error('[convenioFalso] No se pudo calcular el convenio de Falso:', e);
    return FALLO;
  }
};

/** Para quien ya trae la operación fresca (dentro de una transacción): los catálogos solo si hacen falta. */
export const catalogosSiCambiaFalso = async (statusAnterior: unknown, statusNuevo: unknown): Promise<CatalogosConvenio | null | 'error'> => {
  if (!cambiaFalso(statusAnterior, statusNuevo)) return null;
  try { return await cargarCatalogosConvenio(); } catch (e) {
    console.error('[convenioFalso] No se pudieron leer los convenios:', e);
    return 'error';
  }
};
export const ajusteConCatalogos = (op: Datos, statusNuevo: unknown, cat: CatalogosConvenio | null | 'error', statusAnterior?: unknown): AjusteConvenio => {
  if (cat === null) return SIN_AJUSTE;
  if (cat === 'error') return cambiaFalso(statusAnterior ?? op.statusNombre, statusNuevo) ? FALLO : SIN_AJUSTE;
  return ajusteConvenioPorStatus(op, statusNuevo, cat, statusAnterior);
};

/** Aviso flotante (y en la campana) con lo que pasó con el convenio. */
export const avisarAjusteConvenio = (a: AjusteConvenio): void => {
  if (!a.tipo || !a.mensaje) return;
  avisar({ tipo: a.tipo, titulo: a.tipo === 'info' ? 'Convenio de Falso' : 'Convenio sin cambiar', texto: a.mensaje });
};
