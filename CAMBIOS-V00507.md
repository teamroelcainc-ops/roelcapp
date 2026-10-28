# V00507 — Empresas: reporte de clientes y proveedores con dirección y operaciones

**Solo web.** Va encima de la V00506. Sin funciones, reglas, índices ni banderas. **No cambia datos**: solo lee.

## Qué hay de nuevo
En **Empresas**, junto a Columnas y Excel, hay un botón nuevo: **Reporte**. Abre una ventana con el periodo y el botón **Descargar Excel**.

- **Periodo (fecha de servicio):** Desde / Hasta. Si lo dejas vacío, cuenta todas las operaciones de cualquier fecha (tarda unos segundos y avisa cuántas lleva). Las fechas de AppSheet (26/10/2026) también cuentan.
- **El Excel trae tres hojas:**
  - **Resumen:** el periodo, cuántos clientes y proveedores hay, cuántos tienen operaciones, y el total de operaciones de cada categoría: Importación, Exportación y Otros (Movimientos, En falso y Sin clasificar). Abajo dice cómo se contó, cuántas canceladas no contaron y cuántas operaciones traen un cliente o un proveedor que no está en Empresas.
  - **Clientes** y **Proveedores:** una fila por empresa, de la que tiene más operaciones a la que tiene menos:
    - # Empresa, Razón Social, Nombre Corto, Tipo(s) de Empresa y Status;
    - Dirección completa y separada (Calle, # Ext., # Int., Colonia, Municipio / Ciudad, Estado, C.P., País), y las Otras direcciones que tenga;
    - Operaciones, Importación, Exportación, Otros, y Otros separado en Movimientos, En falso y Sin clasificar; y la fecha de la Última operación.
- Al terminar, la ventana dice cuántos clientes, proveedores y operaciones salieron. **Descargar de nuevo** con el mismo periodo no vuelve a leer.

## Cómo cuenta
- **Cliente o proveedor:** por los tipos de la empresa (Cliente (Paga) o (Mercancía); Proveedor (Transporte) o (Servicios)). Una empresa que es las dos cosas sale en las dos hojas. Si una empresa aparece en operaciones como cliente o proveedor y su tipo no lo dice, también sale.
- **Papel en la operación:** el cliente es el que paga o el de la mercancía; el proveedor es el de transporte o el de servicios. Una operación cuenta una vez para cada empresa.
- **Importación, Exportación, Movimiento:** la misma clasificación de Estadísticas (convenio, tipo de operación y tipo de servicio, o la que se puso a mano en "Sin clasificar"). Si no dice, se usa el tráfico de la operación.
- **En falso** va a Otros aunque haya sido de importación o exportación. **Canceladas** y **de prueba** no cuentan.

## Pasos manuales
1. Aplicar el zip (no hay archivos borrados).
2. No hay que desplegar funciones.
3. Mientras Cloudflare no pueda descargar el repositorio (la falla del 27-oct), publica después del push con `npm run build` y `npx wrangler deploy`.

## Técnico
- `features/empresas/services/reporteEmpresas.ts` (puro, con pruebas): `armarReporteEmpresas`, `claseDeOperacion`, `otrosDe`.
  - La empresa de cada papel se busca como los campos canónicos: por sus dos ids y, en registros viejos que guardaron el nombre, por un nombre que solo tenga una empresa.
  - Los totales del Resumen son operaciones distintas.
- `reporteEmpresasLectura.ts`: `leerOperacionesDelRango` (con periodo) o `recorrerOperaciones` (sin periodo), más Empresas, Tipo de Empresa, Direcciones, Status y Tráfico de los catálogos abiertos. Si algo falla, no descarga nada a medias.
- `excelReporteEmpresas.ts`: ExcelJS, que se carga al descargar. Encabezado en dos filas (Empresa / Dirección / Operaciones), con las primeras dos columnas fijas y filtros.
- `operaciones/services/clasificacionOperacion.ts`: la regla de Estadísticas (`movimientoDeOperacion`, `textoDeOperacion`), sacada de `EstadisticasDashboard.tsx` sin cambios. Estadísticas la importa.
- `excelOperaciones.ts`: `descargarBuffer` exportado.
- `ReporteEmpresasModal.tsx` + `.css` (prefijo `rpe-`) y el botón en `EmpresasDashboard.tsx` (`ed-reporte-btn`).
- Simulador (16,006 operaciones más 6 sembradas):
  - Cliente Prueba 507, todas las fechas: 5 operaciones (2 de importación, 1 de exportación por tráfico, 2 otros: 1 movimiento y 1 en falso). La cancelada no contó.
  - Octubre: 4 operaciones (la que tiene fecha de AppSheet de marzo 2025 quedó fuera).
  - La dirección sale del Directorio separada por campos; la del proveedor sale con el texto guardado.
- No probado contra datos reales: cuántas salen "Sin clasificar" depende de que el convenio, el tipo de operación o de servicio, o el tráfico digan importación, exportación o movimiento.
