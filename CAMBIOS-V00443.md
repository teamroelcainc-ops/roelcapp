# V00443 — Fase 7: consultas acotadas (cada pantalla pide solo lo que muestra)

**Bandera**: `consultasCanonicas` (apagada). Con ella apagada todo sigue por el camino de siempre, salvo las
correcciones de la lista "Sin bandera" de abajo. **Puntos de parada**: ninguno nuevo; la bandera exige que la
migración P2 de la V00440 ya esté aplicada (ver "Pasos en producción").

## Qué cambia con `consultasCanonicas`
Las pantallas consultan por los campos canónicos de la Fase 4 (`estadoGrupo`, `fechaServicioISO`, `empresasIds`,
`*Id`, `porFacturar*`) con `where` + `orderBy` + `limit` + cursor (`src/shared/data/consultas.ts`). Sin índice NO hay
respaldo de "leer todo": el error se muestra.

| Pantalla | Antes | Con la bandera |
|---|---|---|
| 7.1 Operaciones activas | `not-in` de 50 (o 2,000 sin filtro si fallaba) | `estadoGrupo == 'activa'`, de la más reciente, 50 por página con cursor |
| 7.2 Servicios Completados | el rango por `fechaServicio` Y por `fechaServicioISO` (todas las operaciones del rango, dos veces) y filtro de status aquí | completadas y falsos del rango (`estadoGrupo` + `fechaServicioISO`), una vez; caché solo en memoria |
| 7.2 Servicios Cancelados | las ~9,000 canceladas de la historia | las canceladas del rango buscado (aviso si pasan de 30,000) |
| 7.3 Facturación (clientes y proveedores) | hasta 20,000 operaciones facturables | solo las pendientes de facturar (`porFacturar*`); las facturadas se piden al abrir "Facturadas" o "Todas" |
| 7.4 Pagos — modal de pago | hasta 12,000 facturas, y otra vez cada vez que se volvía a la pestaña | solo las facturas `abierta` (requiere también `dineroPorServidor`); sin recarga al volver el foco (el botón ↻ sigue) |
| 7.5 Resumen del día | toda la colección de operaciones y de referencias de diésel | las operaciones y cargas de diésel de ESE día |
| 7.5 Reportes → Operaciones | toda la colección | solo el rango (por `fechaServicioISO`) |
| 7.5 Estadísticas | rango por `fechaServicio` (se perdían fechas d/m/aaaa y Timestamp) | rango por `fechaServicioISO`; meses y días con la misma fecha |
| 7.5 Saldos de Puentes → Reporte | toda la colección | el rango De–Hasta (por omisión, del día 1 del mes a hoy); cambiar una fecha vuelve a pedir (con espera de 400 ms) |
| 7.6 Empresas — conteo y "último uso" | toda la colección (+ copia en sessionStorage) y un listener de 1,500 operaciones | contadores `usos/empresa_*` (una lectura por empresa usada, en caché 5 min) |
| 7.6 Empresas — Referencias | 6 consultas de hasta 1,000 (una por papel) | 1 consulta `empresasIds array-contains` (las 3,000 más recientes, con aviso) |
| 7.6 Empresas — detalle de uso | 12 conteos + 12 × 50 documentos (por ID y por nombre) | 6 conteos por el ID canónico + las 50 más recientes |
| 7.7 Detalles de Convenio | toda la colección al entrar | contadores `usos/convenio*_*`; la lista de la ficha se pide al abrirla (50 más recientes) |
| 7.8 Formulario → uso de tarifas | toda la colección | contadores de convenio (en caché) |
| 7.8 Formulario → último servicio de la unidad | hasta 600 operaciones | 2 (`unidadId` + `fechaServicioISO`) |

**Diferencias visibles con la bandera (decisión tomada; ver code-notes):**
- Detalles de Convenio: la tabla muestra el total de operaciones por convenio, pero ya no el desglose por status de
  cada fila (el desglose sale en la ficha, de las 50 más recientes). Los contadores no cuentan las operaciones de prueba.
- Uso de tarifas del formulario: una operación cuyo convenio de cliente y de proveedor apuntan a la misma tarifa
  cuenta dos veces.
- Saldos de Puentes: el reporte pide un rango (antes cargaba todo y el rango solo filtraba).
- Facturación "Facturadas"/"Todas" sigue bajando todas las completadas (hasta 20,000; el aviso de tope se ve).

## Sin bandera (siempre)
- 7.10 Facturación: la remisión y el rate leen TODAS las operaciones de la factura (antes solo las primeras 60) y las
  referencias del historial se resuelven todas (antes 150 por vuelta; si ninguna de esas existía, las demás nunca).
- 7.8 Lotes `in` de 30 en paralelo (antes de 10 uno tras otro): Pagos (operaciones de una factura), Catálogos (uso de
  tarifas), Facturación. Detalles de Convenio: "Unir" lee solo las operaciones de los descartados (antes toda la
  colección) y "Guardar cambios" escribe en lotes (antes una escritura tras otra).
- Empresas → "¿Dónde se usa?": conteo exacto con agregación (antes hasta 300 documentos y "300+").
- Servicios Completados: cambiar el rango y buscar vuelve a descargar (antes se quedaba con el primer rango); editar o
  borrar actualiza también la caché en memoria.
- Mis Operaciones: `in` de hasta 30 ids de operador (antes se cortaba en 10).
- Se borró `recalcularHistorialCalculadoHoy` (nadie la usaba).
- Las pantallas que al montar eligen camino esperan a que lleguen las banderas (`useFlagsCargadas`, máx. 3 s).

## Chequeo nuevo (criterio de aceptación de la Fase 7)
`node scripts/verificar-consultas.mjs` (dentro de `npm run verificar`): falla si aparece un `getDocs`/`onSnapshot` NUEVO
sobre la colección `operaciones` completa. Los 13 que quedan (caminos viejos detrás de la bandera y herramientas de
reparación/migración) están en `scripts/consultas-baseline.json` y solo pueden bajar; se borran en P4.

## Índices nuevos (`firestore.indexes.json`)
`operaciones`: (estadoGrupo, fechaServicioISO desc) · (porFacturarCliente, fechaServicioISO desc) · (porFacturarCliente,
clientePagaId, fechaServicioISO desc) · (porFacturarProveedor, fechaServicioISO desc) · (porFacturarProveedor,
proveedorUnidadId, fechaServicioISO desc) · (empresasIds CONTAINS, fechaServicioISO desc) · (convenioClienteId,
fechaServicioISO desc) · (convenioProveedorId, fechaServicioISO desc) · (unidadId, fechaServicioISO desc).
Los de la app móvil y los anteriores se conservan. Las demás consultas usan índices de un campo (automáticos).

## Pasos en producción (en orden)
1. Web (sin bandera no cambia nada salvo lo de "Sin bandera").
2. `firebase deploy --only firestore:indexes` y esperar a que TODOS digan "Habilitado" en la consola.
3. Requisitos de la bandera: `canonicosEnServidor` encendida (si no, las operaciones nuevas no tienen `estadoGrupo` ni
   `porFacturar*` y no aparecerían), migración **P2** de la V00440 aplicada y "Verificar integridad" en cero,
   `npm run usos -- --aplicar` de la V00442 hecho (contadores exactos).
4. Encender `consultasCanonicas`. Para el modal de Pagos acotado, además `dineroPorServidor` (y la reconciliación P3
   aplicada, que deja `abierta` en todas las facturas).
5. Revisar con `npm run dev:medir` (`__lecturas.tabla()`) Operaciones, Completados, Facturación, Empresas y Detalles de
   Convenio.

## Verificación
- `tsc -b` ✔ · trinquete ESLint ✔ (any 2470 → 2465) · vitest web 17 archivos / 163 ✔ (13 nuevas de `consultas.ts`) ·
  `npm run build` ✔ · functions `tsc` ✔ · vitest functions 49 ✔ · copia de dominio al día ✔ · `style={{` sin cambios.
- Revisión independiente: 11 hallazgos, corregidos: Facturación se quedaba en "Cargando…" al cambiar de vista a media
  descarga (ahora la última petición manda y ninguna se cancela), "Unir entidades" de Pagos no renombraba las facturas
  pagadas con la bandera, el reporte de puentes consultaba por cada tecla y podía mostrar un rango viejo, el Resumen del
  día podía mostrar otro día, un error en Referencias de Empresas vaciaba toda la pestaña, Cancelados cortaba en 30,000
  sin avisar y filtraba por la fecha vieja, Estadísticas perdía en meses/días las fechas Timestamp, las pantallas
  arrancaban por el camino viejo antes de que llegaran las banderas, contadores leídos dos veces, la caché del rango
  canónico iba a localStorage, operaciones de prueba en la lista del convenio.
- **No probado aquí**: navegador ni emulador (índices reales, tiempos de las consultas, lecturas medidas).
