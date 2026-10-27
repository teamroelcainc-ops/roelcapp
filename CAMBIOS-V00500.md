# V00500 — Excel de Operaciones: todas las operaciones del rango, guarde la fecha como la guarde

**Solo web.** Va encima de la V00499. Sin funciones, reglas, índices ni banderas.

## Qué pasaba
- Con la V00499, el Excel de Operaciones del 01/01/2026 al 27/10/2026 trajo solo **20** operaciones, casi todas del 26 de octubre.
- El Excel buscaba por rango de fecha. Esa búsqueda solo encuentra las operaciones que tienen la fecha guardada como texto `AAAA-MM-DD`: las capturadas o editadas en la app web. Las que vienen de AppSheet tienen la fecha en otro formato (`26/10/2026` o fecha de Firebase) y todavía no tienen `fechaServicioISO`, la fecha normalizada que pone la migración (paso 9 del paso a paso). Una búsqueda por rango no las puede encontrar.
- La columna Status salía "-" en las operaciones que no traen guardado el nombre de su status (sobre todo las activas).

## Qué cambia
- **Mientras no esté hecha la migración** (bandera `consultasCanonicas` apagada), el Excel **revisa todas las operaciones** y se queda con las del rango usando la fecha normalizada, venga como venga: `AAAA-MM-DD`, `26/10/2026` o fecha de Firebase. Sigue incluyendo cualquier status y dejando fuera las de prueba.
  - Las lee en 4 partes al mismo tiempo, de 2,000 en 2,000.
  - La ventana dice el avance: "Revisando operaciones… 12,000 de 35,000 · 3,456 del rango".
  - Cuesta una lectura por cada operación de la base en cada Excel (35,000 operaciones = ~35,000 lecturas, centavos de dólar) y tarda más que antes, según cuántas operaciones haya.
- **Después de la migración** (con `consultasCanonicas` encendida), el Excel vuelve a pedir solo el rango por `fechaServicioISO`: rápido y solo con las lecturas del rango.
- El Status que falta se toma del catálogo de status (por su ID o, en las de AppSheet, por su nombre). Lo que ya está guardado no cambia.

## Pasos manuales
1. Aplicar el zip (no hay archivos borrados).
2. No hay que desplegar funciones.

## Técnico
- `shared/data/consultas.ts`: `recorrerOperaciones(alRecibir, alAvanzar)`. Recorre la colección por id del documento en 4 tramos (`< '5'`, `'5'–'M'`, `'M'–'f'`, `>= 'f'`, cubren cualquier id) en paralelo, con páginas de 2,000. Entrega cada página para que el que llama filtre: no se guarda la colección en memoria.
- `features/operaciones/services/operacionesDelRangoExcel.ts`: con `consultasCanonicas`, `todasLasOperacionesDelRango('fechaServicioISO')`; sin ella, `contarOperaciones` (para el avance) + `recorrerOperaciones` filtrando con `fechaOperacionExcel` (`fechaServicioISO` o `normalizarFechaServicioISO(fechaServicio)`, la misma de Servicios Completados).
- `services/excelOperaciones.ts`: `conNombreDeStatus(ops, catálogo)` (puro). `ExcelOperaciones.tsx` lee `catalogo_status_servicio` con `obtenerCatalogo` (solo para mostrar: si falla, sale lo guardado).
- Pruebas nuevas: los 4 tramos (cubren todo, páginas de 2,000, avance), la lectura con fechas ISO, d/m/aaaa y Timestamp (y sin pruebas ni fechas fuera del rango), la ruta con `consultasCanonicas` y el nombre del status.
- Simulador con datos como producción (todas las fechas en d/m/aaaa, sin `fechaServicioISO`), rango 2026-01-01 a 2026-10-27: la V00499 dice "No hay operaciones"; la V00500 descarga las 3,408 esperadas (las mismas referencias, sin repetidas, de la más reciente a la más vieja).
- No probado contra datos reales: cuánto tarda revisar toda tu base. Servicios Completados, Estadísticas y Análisis de Clientes buscan por rango igual que la V00499: tampoco ven las operaciones con la fecha de AppSheet hasta la migración (no se tocaron aquí).
