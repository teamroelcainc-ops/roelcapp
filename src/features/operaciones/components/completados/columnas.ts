// src/features/operaciones/components/completados/columnas.ts
// ---------------------------------------------------------------------------
// ✅ V00444 (Fase 8.3) — columnas de la tabla de Servicios Completados y su
// configuración guardada (antes dentro de ServiciosCompletados.tsx).
// ---------------------------------------------------------------------------

export const COLUMNAS_BASE = [
  { id: 'ref', label: '# Referencia', visible: true },
  { id: 'fechaServicio', label: 'Fecha Servicio', visible: true },
  { id: 'fechaCita', label: 'Fecha Cita', visible: false },
  { id: 'tipoOperacion', label: 'Tipo de Operación', visible: true },
  { id: 'status', label: 'Status', visible: true },
  // ✅ NUEVO: conexiones con los demás módulos (vienen desnormalizadas en la operación)
  { id: 'refDiesel', label: 'Ref. Diesel', visible: true },
  { id: 'refNomina', label: 'Ref. Nómina', visible: true },
  { id: 'invoiceCliente', label: 'Invoice Cliente', visible: true },
  { id: 'invoiceProveedor', label: 'Invoice Proveedor', visible: true },
  { id: 'trafico', label: 'Tráfico', visible: false },
  { id: 'cliente', label: 'Cliente (Paga)', visible: true },
  { id: 'saldoPuente', label: 'Saldo Puente', visible: false }, // ✅ V00355
  { id: 'convenioTarifa', label: 'Convenio Cliente (Tarifa)', visible: true },
  { id: 'refCliente', label: 'Ref. Cliente', visible: false },
  { id: 'facturadoEnCobrar', label: 'Moneda Cobro', visible: false },
  { id: 'montoConvenioCliente', label: 'Monto Convenio (Cliente)', visible: false },
  { id: 'cargosAdicionales', label: 'Cargos Adic. (Cliente)', visible: true },
  { id: 'subtotal', label: 'Subtotal Cliente', visible: true },
  { id: 'tipoCambioAprobado', label: 'Tipo Cambio', visible: false },
  { id: 'dolaresCliente', label: 'Dólares (Cliente)', visible: false },
  { id: 'pesosCliente', label: 'Pesos (Cliente)', visible: false },
  { id: 'conversionCliente', label: 'Conversión Ingreso', visible: false },
  { id: 'origen', label: 'Origen', visible: false },
  { id: 'destino', label: 'Destino', visible: false },
  { id: 'remolque', label: '# Remolque', visible: true },
  { id: 'proveedor', label: 'Proveedor de Unidad', visible: true },
  { id: 'unidadProveedor', label: 'Unidad Externa', visible: false },
  { id: 'operadorProveedor', label: 'Operador Externo', visible: false },
  { id: 'convenioProv', label: 'Convenio Prov.', visible: true },
  { id: 'facturadoEnUnidad', label: 'Moneda Prov.', visible: false },
  { id: 'monedaConvenioProv', label: 'Moneda Conv. Prov.', visible: false },
  { id: 'totalAPagarProv', label: 'Monto Base Prov.', visible: false },
  { id: 'cargosAdicionalesProv', label: 'Cargos Adic. Prov.', visible: false },
  { id: 'subtotalProv', label: 'Subtotal Prov.', visible: false },
  { id: 'dolaresProv', label: 'Dólares Prov.', visible: false },
  { id: 'pesosProv', label: 'Pesos Prov.', visible: false },
  { id: 'conversionProv', label: 'Conversión Gasto', visible: false },
  { id: 'unidad', label: 'Unidad Roelca', visible: true },
  { id: 'operador', label: 'Operador Roelca', visible: false },
  { id: 'sueldoOperador', label: 'Sueldo Operador', visible: false },
  { id: 'sueldoExtra', label: 'Sueldo Extra', visible: false },
  { id: 'sueldoTotal', label: 'Sueldo Total', visible: false },
  { id: 'combustible', label: 'Combustible', visible: false },
  { id: 'combustibleExtra', label: 'Combustible Extra', visible: false },
  { id: 'combustibleTotal', label: 'Combustible Total', visible: false },
  { id: 'clienteMercancia', label: 'Cliente Mercancía', visible: false },
  { id: 'descripcionMercancia', label: 'Desc. Mercancía', visible: false },
  { id: 'cantidad', label: 'Cantidad', visible: false },
  { id: 'embalaje', label: 'Embalaje', visible: false },
  { id: 'pesoKg', label: 'Peso (Kg)', visible: false },
  { id: 'numDoda', label: '# DODA', visible: false },
  { id: 'fechaEmisionDoda', label: 'Fecha DODA', visible: false },
  { id: 'numeroEntrys', label: '# Entrys', visible: false },
  { id: 'cantEntrys', label: 'Cant. Entrys', visible: false },
  { id: 'numManifiesto', label: '# Manifiesto', visible: false },
  { id: 'provServicios', label: 'Prov. Servicios', visible: false },
  { id: 'montoManifiesto', label: 'Costo Manifiesto', visible: false },
  { id: 'totalGastos', label: 'Total Gastos', visible: false },
  { id: 'utilidadEstimada', label: 'Utilidad Estimada', visible: false },
  { id: 'observacionesEjecutivo', label: 'Obs. Ejecutivo', visible: false },
  { id: 'observacionesUnidad', label: 'Obs. Unidad', visible: false },
  { id: 'observacionesCobrar', label: 'Obs. Cobro', visible: false }
];

// ✅ NUEVO: clave para PERSISTIR la configuración de columnas (orden + visibles)
//   en localStorage, para que NO se pierda al recargar la página.
export const COLUMNAS_STORAGE_KEY = 'roelca_completadas_columnas_v1';

// ✅ NUEVO: carga la configuración guardada y la reconcilia con COLUMNAS_BASE:
//   · respeta el ORDEN y la VISIBILIDAD guardados,
//   · si en el código se agregaron columnas nuevas (que no estaban guardadas),
//     se añaden al final con su valor por defecto,
//   · si una columna guardada ya no existe en el código, se descarta.
//   Así nunca se rompe aunque el catálogo de columnas cambie en una actualización.
export const cargarColumnasGuardadas = (): typeof COLUMNAS_BASE => {
  const base = COLUMNAS_BASE.map(c => ({ ...c }));
  try {
    const raw = localStorage.getItem(COLUMNAS_STORAGE_KEY);
    if (!raw) return base;
    const guardadas = JSON.parse(raw);
    if (!Array.isArray(guardadas)) return base;

    const basePorId = new Map(base.map(c => [c.id, c]));
    const resultado: typeof COLUMNAS_BASE = [];
    const yaAgregados = new Set<string>();

    // 1) Primero, en el ORDEN guardado (solo las que siguen existiendo).
    (guardadas as { id?: unknown; visible?: unknown }[]).forEach((g) => {
      const id = String(g?.id ?? '');
      const def = basePorId.get(id);
      if (def && !yaAgregados.has(def.id)) {
        resultado.push({ ...def, visible: typeof g.visible === 'boolean' ? g.visible : def.visible });
        yaAgregados.add(def.id);
      }
    });

    // 2) Columnas nuevas del código que no estaban guardadas: al final.
    base.forEach(c => {
      if (!yaAgregados.has(c.id)) {
        resultado.push({ ...c });
        yaAgregados.add(c.id);
      }
    });

    return resultado;
  } catch {
    return base;
  }
};
