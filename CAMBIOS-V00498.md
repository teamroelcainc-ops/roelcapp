# V00498 — Reportes como pestaña de Operaciones y Excel de todas las operaciones

**Solo web.** Va encima de la V00497. Sin funciones, reglas, índices ni banderas.

## Qué pidió Roelca
1. Que "Reportes" del menú sea una pestaña del módulo de Operaciones.
2. Un botón en Operaciones para descargar en Excel todas las operaciones de un rango de fechas, sin importar su status.
3. Que ese Excel abra una ventana como la de Servicios Completados.

## Qué cambia
- **Reportes**: ya no está en el menú lateral. Es la cuarta pestaña de Operaciones (Activas · Completadas · Canceladas · Reportes), con el mismo permiso de siempre. Quien solo tiene permiso de Reportes entra por "Operaciones" directo a esa pestaña.
- **Botón Excel** (a la derecha de las pestañas, junto a "Corregir monedas", en las cuatro pestañas): abre la ventana **Configuraciones de exportación** con:
  - el rango de fechas (Desde / Hasta; por omisión, del día 1 del mes a hoy);
  - las configuraciones guardadas (Usar / 🗑) y **Nueva configuración**;
  - después, la misma ventana de columnas de Servicios Completados: marcar, ordenar arrastrando ⋮⋮, guardar la configuración con nombre y Exportar.
  - Descarga **todas** las operaciones con fecha de servicio en el rango, de cualquier status (activas, completadas, canceladas, en falso). Las de prueba no salen. Archivo `Operaciones_<desde>_a_<hasta>.xlsx`.
- Las configuraciones son **las mismas** de Servicios Completados ("Conf. Rol", "Configuración para Clientes", etc.): lo que se guarde en una se ve en la otra.
- **Servicios Completados**: su Excel usa ahora las mismas ventanas (salieron del módulo a un componente compartido). Se ve y sale igual que antes.

## Pasos manuales
1. Aplicar el zip (no hay archivos borrados).
2. No hay que desplegar funciones.

## Técnico
- `features/operaciones/services/modulosOperaciones.ts`: `'reportes'` en `MODULOS_OPERACIONES` (+ prueba). `App.tsx`: se quitó el ítem del menú.
- `components/PestanasOperaciones.tsx`: pestaña Reportes y botón Excel (carga perezosa).
- `components/exportar/ModalExportarExcel.tsx` (+ CSS `mxe-`, + prueba): ventanas de configuraciones y columnas, con rango opcional.
- `components/exportar/ExcelOperaciones.tsx`: el Excel de todas las operaciones.
- `services/excelOperaciones.ts` (+ prueba): valor de cada columna (sacado tal cual de ServiciosCompletados) y la descarga (xlsx se carga al exportar).
- `services/operacionesDelRangoExcel.ts` (+ prueba): `fechaServicio` + `fechaServicioISO` del rango, sin filtro de status; tope de 25,000 por consulta que se avisa.
- `services/configsExportExcel.ts`: `config_export_excel` (listar, guardar, borrar) y la última selección por usuario.
- `ServiciosCompletados.tsx` / `.css`: usa las piezas compartidas; se quitaron sus ventanas y 24 reglas de CSS que ya no se usaban.
- Probado en el simulador: las cuatro pestañas y el menú sin Reportes; el Excel de un rango con completadas y canceladas (336 filas: 307 + 29); una configuración guardada exporta sus columnas en su orden; el Excel de Servicios Completados es idéntico al de la V00497 (307 filas × 16 columnas).
- No probado contra datos reales: cuántas operaciones tiene un rango largo (el tope es 25,000 por consulta).
