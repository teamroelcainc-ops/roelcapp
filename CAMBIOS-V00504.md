# V00504 — Facturación de Clientes: Excel de TODAS las facturas

**Solo web.** Va encima de la V00503. Sin funciones, reglas, índices ni banderas.

## Qué pidió Roelca
Descargar en un Excel todas las facturas: pagadas y no pagadas, con fecha y sin fecha.

## Qué cambia
En **Facturación → Clientes → Historial de Facturas → Exportar Excel**, la ventana tiene arriba **"Qué facturas"**:
- **Las de la pantalla (N)**: como antes, con los filtros y la pestaña de ahora (Historial o Pagadas, fechas, cliente, moneda, búsqueda y status). Es la opción marcada al abrir la ventana.
- **Todas las facturas (N)**: sin ningún filtro.
  - Pagadas y sin pagar.
  - Con y sin fecha (las que no tienen fecha salen con la celda de fecha vacía).
  - De todos los clientes y de todos los status, también las canceladas.
  - Una fila por factura, como la tabla: los documentos con el mismo invoice y cliente van juntos. Mismo orden que la tabla.
  - El archivo se llama `Facturas_Clientes_Todas_AAAA-MM-DD.xlsx`.
  - Mientras la lista completa no llega del servidor, la opción dice "contando…" y Exportar espera.

En los dos casos:
- **Columna nueva "Estado de pago"** (después de "# Pago"): **Pagada**, **Parcial** o **Sin pagar**.
  - Pagada sigue la misma regla de la pestaña Pagadas: todos los documentos de la fila pagados.
  - Parcial: tiene algún pago y todavía saldo.
  - Se puede quitar o mover como las demás columnas.
- **Totales por moneda** en el subtítulo: Total USD y Total MXN, sin canceladas, como las tarjetas.
- **La fila TOTAL** del final solo sale si todas las facturas son de la misma moneda. Antes sumaba dólares con pesos.

## Lecturas
- Las facturas ya están en memoria: es el listener en vivo de Facturación. No hay lecturas nuevas.
- Para las referencias de las operaciones, el Excel lee las operaciones que la pantalla no tiene. Es el mismo paso de siempre del Excel; con "Todas" pueden ser más.

## Pasos manuales
1. Aplicar el zip (no hay archivos borrados).
2. No hay que desplegar funciones.

## Técnico
- `facturacion/services/gruposFactura.ts` (+ prueba):
  - `filaPagada`: la regla de "Pagadas", que estaba dentro del tablero; `facturaPagada` ahora la llama.
  - `estadoPagoFila`.
- `FacturacionClientesDashboard.tsx`:
  - `alcanceExportFac` ('pantalla' | 'todas').
  - `todasLasFilasFac` = `agruparFacturas(facturasGlobales)`, calculada solo con la ventana abierta.
  - `compararFacturas`: el orden de la tabla, compartido con `historialOrdenado`.
  - `columnasParaExportar` agrega "Estado de pago".
  - Totales por moneda con `sumaEnTotales` + `codigoMonedaFactura` + `totalDeGrupo`.
  - CSS `fac-export-alcance*`.
- `exportarExcelProfesional.ts`: opción `filaTotal` (por defecto sí).
- Simulador (9,010 facturas = 9,004 filas):
  - Con un mes de filtro, la pantalla dio 310 filas.
  - "Todas" dio las 9,004 filas en 6.8 s:
    - las 4 filas sin fecha (5 documentos);
    - 3 Pagadas y 2 Parciales preparadas;
    - una cancelada;
    - sin fila TOTAL al mezclar dólares y pesos.
- Proveedores no cambia: su Excel sigue saliendo con lo de la pantalla.
