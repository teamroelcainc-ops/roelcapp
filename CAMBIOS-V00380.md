# V00380 — Operaciones de PRUEBA

## Cómo se usa
En **Nueva Operación**, junto a "Documentos", está el botón **🧪 Prueba**. Al activarlo
(se pinta ámbar con ✓) la operación se guarda como prueba:
- Referencia con prefijo **PR.** delante de la línea: `PR.TR-270926-001`, `PR.FL-…`, `PR.LO-…`
- Contador PROPIO por prefijo+fecha → **no consume consecutivos reales** (la Cloud Function
  `crearOperacion` ya cuenta por prefijo; no hay que redesplegar functions).
- Campo `esPrueba: true` en el documento.
Al editarla, el formulario muestra el sello fijo **🧪 PRUEBA** (no se puede convertir una
real en prueba ni al revés). En Operaciones Activas y Completados la referencia lleva el chip 🧪 PRUEBA.
Si se cambia la línea de una prueba, la renumeración conserva el PR.

## Dónde SÍ aparece (para probar como real)
Operaciones Activas, Servicios Completados, Cancelados, ficha, Registrar Movimiento,
reglas de estatus, documentos, cobro del peaje en la propia operación.

## Dónde NO entra
Facturación Clientes y Proveedores (lista Asignar Operaciones + bus de cambios), Pagos (vía bus),
Nómina (operaciones completadas para referencias), Estadísticas, Reportes (módulo Operaciones)
y Resumen diario, Panel de Control, Saldos de Puentes (cruces, reporte y 🧮) y Tarjeta de Casetas,
Auditoría de Facturación y Auditoría por Empresa, Excel de Empresa (ops+facturación+pagos) y los
Excel de Operaciones Activas y Completados.

Regla central: `src/utils/operacionPrueba.ts` → `esOperacionPrueba(op)` = `esPrueba === true`
o ref que empieza con `PR.`

## Archivos
- NUEVO src/utils/operacionPrueba.ts
- src/utils/operacionesBus.ts
- src/index.css (chip .op-prueba-chip)
- src/features/operaciones/components/FormularioOperacion.tsx + .css
- src/features/operaciones/services/operacionesService.ts
- src/features/operaciones/components/OperacionesDashboard.tsx
- src/features/operaciones/components/ServiciosCompletados.tsx
- src/features/operaciones/components/TarjetaCasetas.tsx
- src/features/facturacion/components/FacturacionClientesDashboard.tsx
- src/features/facturacion/components/FacturacionProveedoresDashboard.tsx
- src/features/facturacion/components/AuditoriaCadenaCliente.tsx
- src/features/estadisticas/components/EstadisticasDashboard.tsx
- src/features/reportes/components/ReportesDashboard.tsx
- src/features/reportes/components/ResumenDiarioOperaciones.tsx
- src/features/panelControl/PanelControlDashboard.tsx
- src/features/saldosPuentes/components/SaldosPuentesDashboard.tsx
- src/features/nominas/components/ReferenciasNominaDashboard.tsx
- src/features/empresas/components/AuditoriaCadenaEmpresa.tsx
- src/features/empresas/components/EmpresasDashboard.tsx
- src/config/historialCambios.ts, public/version.json
- (incluye también statusRules.ts de V00379 por si aún no la aplicaste)

Verificación: tsc 0; eslint idéntico a la base en los 18 archivos (Formulario 377, Operaciones 126,
Completados 163…; nuevos en 0); build OK.
