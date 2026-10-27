# V00501 — Excel: Año, Mes, Semana y Día al lado de la fecha de servicio

**Solo web.** Va encima de la V00500. Sin funciones, reglas, índices ni banderas.

## Qué pidió Roelca
"Año, mes, semana y día al lado de la fecha de servicio en el Excel, siempre."

## Qué cambia
- En el Excel de **Operaciones** (botón Excel), de **Servicios Completados** y de **Servicios Cancelados**, la columna de la fecha de servicio siempre lleva al lado cuatro columnas: **Año**, **Mes**, **Semana** y **Día**.
  - Ejemplo: `2026-10-26 | 2026 | octubre | 44 | lunes`.
  - No hay que marcarlas: salen con la fecha en cualquier configuración guardada. Si se quita la fecha de servicio del Excel, tampoco salen.
  - Se cuentan como en Estadísticas Operativas (Diario: mes · semana · día). El mes y el día van con nombre. La semana es la del año, de lunes a domingo, y la semana 1 es la del 1 de enero.
  - Si una operación no tiene una fecha reconocible, esas cuatro celdas quedan vacías.
- La ventana de columnas lo dice: "La fecha de servicio siempre sale con Año, Mes, Semana y Día al lado."
- **Corrección en Estadísticas Operativas**: la semana se calculaba con la hora local. Mientras dura el horario de verano (de marzo a noviembre en Texas), **cada lunes caía en la semana anterior**: en Diario el lunes decía la semana pasada y en Semanal sus servicios se sumaban a la semana pasada. Ahora usa la misma regla que el Excel y el lunes empieza su semana.

## Pasos manuales
1. Aplicar el zip (no hay archivos borrados).
2. No hay que desplegar funciones.

## Técnico
- `shared/dominio/fechas.ts`: `NOMBRES_MES`, `NOMBRES_DIA`, `semanaDelAnio(iso)` (en UTC) y `partesDeFecha(iso)` (puros; la copia de functions se genera sola).
- `features/operaciones/services/excelOperaciones.ts`: `desgloseFechaExcel(iso)`; `filasExcel` agrega las cuatro columnas después de `fechaServicio`. Lo usan Operaciones y Servicios Completados. `ServiciosCancelados.tsx` las agrega después de su columna `fecha`.
- `EstadisticasOperativas.tsx`: usa `semanaDelAnio`, `NOMBRES_MES` y `NOMBRES_DIA` compartidos (se quitaron sus copias).
- Pruebas: la semana del año (incluidos lunes con horario de verano, corridas también con TZ=America/Chicago) y el orden de las columnas en el Excel.
