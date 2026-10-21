// src/features/operaciones/services/camposAjenos.ts
// ---------------------------------------------------------------------------
// ✅ V00451 — Campos de la operación que escriben OTROS módulos (Facturación,
// Nómina, Diésel, Puentes, Revisión de Ref Cliente, cambio de sueldo con motivo; ✅ V00469: el cobro del puente).
// El formulario de operación trae una COPIA del documento (la de la lista desde
// la que se abrió, que pudo cargarse horas antes). Si los guardara, desharía lo
// que otro módulo hizo mientras tanto: p. ej. regresar a "Pendiente" una
// operación que Facturación ya facturó (factura LO-081026-004).
// ---------------------------------------------------------------------------

export const CAMPOS_AJENOS_AL_FORMULARIO: readonly string[] = [
  // Facturación de clientes y de proveedores
  'facturaClienteId', 'facturaClienteInvoice', 'facturado',
  'facturaProveedorId', 'facturaProveedorFolio', 'facturadoProveedor',
  'confirmacionTarifa', 'confirmacionTarifaLog',
  // Nómina, diésel y puentes
  'referenciaNominaId', 'referenciaNominaConsecutivo',
  'referenciaDieselId', 'referenciaDieselConsecutivo',
  'referenciaPuentesId', 'referenciaPuentesConsecutivo',
  // Revisión de Ref Cliente (V00450) y bitácora de sueldo (V00433, se agrega con arrayUnion)
  'refClienteRevisado', 'refClienteRevisadoPor', 'refClienteRevisadoEn',
  'cambiosSueldo',
  // ✅ V00469: el COBRO del puente (caseta y piso de Colombia). Lo escriben el servidor, Operaciones
  //   Activas y Referencias de Puentes; la copia del formulario pudo quedar vieja (o venir de otra
  //   operación en un formulario minimizado). El cobro que calcula el formulario se agrega aparte.
  'saldoPuente', 'saldoPuentePuente', 'saldoPuenteMoneda', 'saldoPuenteFecha', 'saldoPuenteEvento', 'saldoPuenteManual',
  'saldoPuentePiso', 'saldoPuentePisoPuente', 'saldoPuentePisoMoneda', 'saldoPuentePisoFecha', 'saldoPuentePisoEvento',
  'puenteCobradoEn', 'puenteCobradoPor',
  // Identidad del documento: nunca se escribe como campo
  'id', '_docId',
];

/** Quita del payload del formulario los campos que no le corresponden (en el mismo objeto). */
export const quitarCamposAjenos = (datos: Record<string, unknown>): Record<string, unknown> => {
  for (const campo of CAMPOS_AJENOS_AL_FORMULARIO) delete datos[campo];
  return datos;
};
