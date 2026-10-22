# V00475 — Reportes de puentes: la ventana muestra el Excel con las referencias de cada unidad y día

**Solo web.** Va encima de la V00474. Sin funciones, reglas, índices ni banderas.

## Qué cambia en pantalla
**Referencias de Puentes → Operaciones sin asignar → Cargar reporte de puente.** Con cualquiera de los tres Excel (AVI, Puente 3 o Puente Colombia) se abre la ventana. Ahora la tabla es **cada renglón del Excel**:

| Columna | Qué trae |
| --- | --- |
| ☑ | Solo en los renglones que coinciden con una operación de Operaciones sin asignar (marcados por defecto) |
| Cruce | Fecha y hora del cruce (Colombia: las dos horas, puente y caseta) |
| Tag # | El tag del Excel |
| Unidad | La unidad de ese tag (o *Tag sin unidad*) |
| Cobró el puente | El monto del Excel (Colombia: los dos cobros) |
| **Referencias de la unidad ese día** | Todas las operaciones de esa unidad esa fecha: **Coincide** (con su hora de Verde), **Por asignar**, **En el Acumulado · PT3-011026-001**, **Sin completar**, **Sin importación ni exportación**; o *Sin operaciones de esta unidad ese día* |
| Revisar | Los avisos de siempre (monto distinto, otro puente, otra operación ese día…) |

- **Abre mostrando los renglones con referencias.** Los chips de arriba cambian la vista: *Todos los renglones*, *Con referencias de la unidad ese día*, *coinciden*, *sin operación por asignar* y *tag sin unidad*.
- Si las operaciones del módulo **aún se están cargando**, la ventana lo dice (*Cargando las operaciones para buscar las referencias…*) en lugar de marcar que no hay referencias.
- *Enviar al Acumulado*, *Solo marcar en la tabla*, *Exportar resultado* y *Quitar reporte* funcionan igual. El Excel exportado trae además la columna *Referencias de la unidad ese día*.

## Pasos manuales
Ninguno.

## Técnico
- `reporteAvi.ts`: `RefDelDia` (`porAsignar` / `acumulado` / `sinCompletar` / `otroTrafico` + `referencia`) y `ETIQUETA_REF_DEL_DIA`.
- `ReferenciasPuentesDashboard`:
  - `referenciaDeOp` (operación → consecutivo del Acumulado);
  - el cálculo del reporte arma también `refsDelDia` (por `claveUnidadDia`, con las mismas operaciones que ya trae el módulo; sin lecturas nuevas);
  - pasa `refsDelDia` y `cargandoOps` al panel.
- `PanelReporteAvi`:
  - una sola tabla con todos los renglones en orden de fecha y hora;
  - filtro por chips (`filtroElegido`; por defecto *con referencias*);
  - la columna de referencias;
  - se quitó la sección plegada de *cruces que no coinciden*, porque ahora están en la tabla.
- `PanelReporteAvi.css`: `.pra-filtro`, `.pra-chip--todos`, `.pra-refs`, `.pra-ref-dia--*`, `.pra-fila--clic`.
- Banco de pruebas, con los Excel de muestra REPORTE_PUENTE_240 (1,667 renglones) y REPORTE_PUENTE_800 (189):
  - **Puente 3:** abre con 4 renglones con referencias. Ejemplo: *1 oct 10:01 · UND.4701 · TR-011026-101 Coincide · Verde 09:55 / TR-011026-102 Por asignar / TR-011026-104 Sin completar*; y *1 oct 10:10 · UND.4702 · TR-011026-103 Coincide / TR-011026-105 En el Acumulado · PT3-011026-001*;
  - **Colombia:** 2 renglones con sus dos cobros;
  - **filtros:** *coinciden* = 3, *Todos* = 1,667;
  - el Excel exportado trae la columna nueva;
  - sin errores de consola.
