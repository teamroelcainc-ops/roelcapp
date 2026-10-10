// src/utils/operacionPrueba.ts
// ✅ V00380: OPERACIONES DE PRUEBA.
//   Una operación de prueba se crea desde el formulario con el botón "🧪 Prueba":
//   lleva `esPrueba: true` y su referencia usa el prefijo `PR.` delante de la
//   línea (PR.TR-270926-001, PR.FL-…), con su PROPIO contador — no consume
//   consecutivos reales.
//   Vive en Operaciones Activas / Completados / Cancelados como cualquier otra
//   (para probar flujos, estatus, documentos, peaje…), pero NO entra a
//   Facturación, Pagos, Estadísticas, Reportes, Panel de Control, Nóminas,
//   Saldos de Puentes ni auditorías.
// ✅ V00440 (Fase 4): la regla vive en src/shared/dominio/operacionCanonica.ts
//   (la misma que usa el servidor para el campo canónico `esPrueba`).
import { esOperacionPrueba } from '../shared/dominio/operacionCanonica';

export { esOperacionPrueba, PREFIJO_PRUEBA } from '../shared/dominio/operacionCanonica';

/** Quita las operaciones de prueba de una lista de objetos. */
export const sinPruebas = <T,>(lista: T[]): T[] =>
  (Array.isArray(lista) ? lista : []).filter((o) => !esOperacionPrueba(o));

/** Quita las operaciones de prueba de una lista de documentos de Firestore. */
export const docsSinPruebas = <D extends { data: () => unknown }>(docs: D[]): D[] =>
  (Array.isArray(docs) ? docs : []).filter((d) => !esOperacionPrueba(d.data()));
