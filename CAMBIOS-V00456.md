# V00456 — Operaciones Activas: tarjetas más bajas, Completadas hoy, historial de TC y diesel, tabla rediseñada

**Solo web** (deploy de hosting de siempre). Sin reglas, índices, banderas ni Cloud Functions.

## Qué cambia
1. **Tarjetas más bajas.** Menos relleno, cifras un poco más chicas y el desglose de completadas en una línea que se acomoda sola. En el banco de pruebas pasan de 320 px a 220 px de alto.
2. **Pestaña "Completadas hoy".** Al presionar *Completadas hoy* en la tarjeta **Operaciones del día** aparece una pestaña al lado de **Rentas** con todos los servicios completados del día (misma regla y misma consulta que la tarjeta, así que el número coincide). Cada fila abre su detalle y se puede editar como siempre. Si con la pestaña abierta se completa (o se regresa) una operación de hoy desde el detalle, entra (o sale) sola. La pestaña se cierra con la **✕**. *Actualizar* también la vuelve a leer.
3. **Historial de tipo de cambio y diesel.** Al presionar la tarjeta **Tipo de cambio** se ven los últimos 30 tipos de cambio con su variación contra el anterior (▲ sube / ▼ baja) y la hora de captura. Al presionar **Diesel**: las últimas 40 capturas con proveedor, precio por galón, por litro (USD y MXN) y la marca *más bajo* de cada día. Los botones de adentro (*Capturar TC*, *Capturar / Agregar diesel*) siguen abriendo su captura.
4. **Tabla de Operaciones Activas rediseñada** (lo que hace cada botón no cambia):
   - Arriba: el título con cuántas activas hay y el botón **Nueva operación** con su nombre.
   - Una sola barra: búsqueda (con ✕ para borrarla), *Filtros*, *Actualizar*, y a la derecha *Resúmenes*, *Excel*, *Columnas*, *Manual* y *Vista* como íconos con su nombre al pasar el mouse.
   - Pestañas con el color de cada tipo (Transfer naranja, Cruces azul, Fletes verde, Rentas morado) y la línea del color en la pestaña activa.
   - Cada fila con una franja del color de su tipo; la referencia y el tipo en ese color; **status** y **tráfico** como etiquetas; editar y eliminar como íconos que se encienden al pasar el mouse.
   - Encabezados sin mayúsculas forzadas, filas más compactas y el pie con *Mostrando 1–50 de N* y flechas de página.

## Técnico
- Nuevos: `src/features/operaciones/services/resumenDia.ts` (+ pruebas), `resumenDiaDatos.ts`, `pestanaCompletadas.ts`; `components/ModalHistorialResumen.tsx/.css` (prefijo `mhr-`, perezoso).
- `App.tsx`: el Resumen del día usa el servicio (se quitaron sus copias de las reglas); Completadas hoy es un botón; TC y Diesel abren su historial; al capturar TC o diesel se invalida su historial. ESLint del archivo: 62 → 55.
- `OperacionesDashboard.tsx/.css`: pestaña `completadas`, tablero rediseñado, sin `onMouseEnter/Leave`; `style={{` 17 → 7; ESLint 81 → 76. Íconos de `lucide-react` (ya era dependencia).
- `App.css`: tarjetas más bajas, `rd-card--clic` / `rd-card__abrir` (también para las tarjetas de puente) y el botón de completadas.
- Lecturas: la pestaña lee las operaciones de hoy al abrirse (≈ las del día); cada historial, 30 / 40 documentos la primera vez que se abre (después, de la memoria hasta que se capture uno nuevo o pasen 5 min).
- Carga inicial: +1.3 KB gzip.
- Revisión independiente (agente aparte), corregido: altura en pantallas ≤ 900 px, pestañas que se salían sin barra, bordes y anillos de foco del estilo global de botones, pestaña que no se enteraba de un status cambiado desde el detalle, lecturas encimadas, pestañas como grupo de botones (la ✕ no puede ir en un tablist) y el modal con Escape y foco.
- Banco de pruebas (V00455 contra V00456): altura de tarjetas, pestaña Completadas hoy (2 filas, pie "1–2 de 2 completadas hoy", se cierra y vuelve a Todos), historial de TC (30) y diesel (4, con "más bajo"), *Agregar diesel* sigue abriendo su captura, orden por columna, búsqueda con ✕, clic en fila abre el detalle. Sin errores de consola.

## Qué revisar con datos reales
1. Presiona *Completadas hoy* en Operaciones del día: la pestaña muestra los mismos servicios que cuenta la tarjeta.
2. Presiona la tarjeta Tipo de cambio y la de Diesel: los últimos registros, el de hoy marcado.
3. Recorre la tabla: editar, eliminar, columnas, Excel y filtros funcionan como antes.
