# V00499 — Excel de Operaciones sin límite de cantidad

**Solo web.** Va encima de la V00498. Sin funciones, reglas, índices ni banderas.

## Qué pasaba
- El botón **Excel** de Operaciones, con un rango grande (por ejemplo, del 01/01/2026 al 27/10/2026), decía: *"No se pudo armar el Excel: Limit value in the structured query is over the maximum value of 10000."*
- La V00498 pedía hasta 25,000 operaciones en una sola consulta, y Firestore no acepta más de 10,000 por consulta.

## Qué cambia
- El Excel lee el rango **en páginas de 2,000** hasta traer **todas** las operaciones, sin tope de cantidad. Como antes, incluye cualquier status y deja fuera las de prueba.
- Mientras lee, la ventana dice cuántas lleva ("Leyendo operaciones del rango… 8,000 leídas") y después "Armando el Excel con N operaciones…". Un rango de varios años tarda más, pero termina.
- La ventana ya no se ve corrida un instante al abrirse.

## Pasos manuales
1. Aplicar el zip (no hay archivos borrados).
2. No hay que desplegar funciones.

## Técnico
- `shared/data/consultas.ts`: `todasLasOperacionesDelRango(campo, desde, hasta, alAvanzar)` (páginas con cursor de 2,000, `orderBy` del mismo campo: basta el índice automático) + `LIMITE_FIRESTORE`. `todasLasPaginas` acepta `alAvanzar` (opcional; los demás usos no cambian).
- `features/operaciones/services/operacionesDelRangoExcel.ts`: `fechaServicio` + `fechaServicioISO` en páginas, en paralelo; se quitó el tope (`TOPE_OPERACIONES_EXCEL`).
- `components/exportar/ExcelOperaciones.tsx`: el aviso de avance. `ModalExportarExcel.tsx`: prop `textoExportando`. `ModalExportarExcel.css`: animación propia (`mxe-aparecer`); el `fadeIn` global movía la ventana.
- Lecturas: cada operación del rango se lee una vez por cada una de sus dos fechas (las nuevas tienen las dos), igual que en la V00498. Ejemplo: 16,000 operaciones = ~32,000 lecturas.
- Probado en el simulador, que ahora rechaza un `limit` mayor a 10,000 como Firestore. La V00498 da ahí el mismo error de la captura. La V00499 descargó las 16,000 operaciones del simulador (2023-02-16 a 2026-10-11): 16,000 filas sin repetidas, de la más reciente a la más vieja, con activas, completadas y canceladas. Prueba nueva: 12,500 operaciones en 7 páginas, ninguna consulta con `limit` mayor a 10,000.
- No probado contra datos reales: cuánto tarda un rango de un año en tu red.
