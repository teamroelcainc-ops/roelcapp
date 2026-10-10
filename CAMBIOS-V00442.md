# V00442 — Fase 6: triggers más baratos y consistentes (reintentos, nombres, contadores)

**Puntos de parada**: P1 (reglas: `usos/` y `eventos_procesados/` solo servidor), P2 (puesta al día de nombres y
recuento de usos). La propagación de nombres está detrás de `propagacionEnServidor` (apagada). Lo que corre al
desplegar funciones sin banderas: un trigger menos por operación, reintentos y los contadores en `usos/` (colección
nueva que nadie lee todavía).

## Qué cambia
### 6.1 — Menos invocaciones y menos escrituras dobles
- **`operacionMontoCambiado` ya no existe**: la cascada de montos a las facturas corre dentro de `operacionEscrita`
  (una invocación por escritura de operación en lugar de dos). La cascada ahora es en transacción y con la operación
  ACTUAL: dos operaciones de la misma factura que cambian a la vez ya no se pisan el arreglo de renglones.
- `operacionEscrita` sale sin calcular nada si el evento solo cambió campos que escribe él mismo (canónicos, marca del
  peaje): la segunda vuelta después de su propia escritura ya no lee catálogos.
- Facturas (con `dineroPorServidor`): un evento que no toca dinero (documento adjunto, nombres, o la escritura del
  propio trigger) sale de inmediato. Si la escritura del trigger choca con otra, recalcula en transacción.
- Las callables de dinero escriben de una vez lo que antes escribía después el trigger: agregados de la factura
  (`derivadosFactura`) y, con `canonicosEnServidor`, los canónicos de las operaciones que tocan (`porFacturar*`…).
  **Facturar N operaciones = N invocaciones de `operacionEscrita` sin segunda escritura** (antes 2N–4N).
- Tarifarios y detalles de convenio: listas blancas (un cambio que no toca la relación ni la línea no lee nada; si al
  convenio le falta algo, el guardián V00429 lo sigue completando). La línea del tarifario se escribe en transacción.

### 6.2 — Propagación de nombres (bandera `propagacionEnServidor`)
- Un mapa (`src/shared/dominio/nombres.ts`) de maestro → destinos: empresas (operaciones en sus 6 papeles, facturas,
  pagos, tarifarios, convenios, detalles, unidades de proveedor, diésel), status, tipo de operación, unidades y
  empleados. Busca por el ID de siempre y por el canónico; una escritura por documento; 9 min y 512 MiB por trigger.
- **Regla de empresas = la del formulario**: razón social en Cliente (Paga), Cliente Mercancía, Proveedor de
  Transporte, facturas y pagos; nombre corto en Origen, Destino y Prov. Servicios.
- Con la bandera se ocultan "Sincronizar nombres" (Operaciones, Completados, Cancelados) y "🏷 Razón social"
  (Empresas). Se borran en P4. "⚡ Acelerar búsquedas" se oculta con `consultasCanonicas` (Fase 7).
- **No incluido (decisión)**: la descripción de los detalles de convenio (`convenioNombre`) no se propaga: alimenta
  "EL CONVENIO MANDA" y re-derivaría carga/aduana de operaciones pasadas. El botón de Catálogos se queda (también
  corrige Direcciones, que el mapa no cubre).

### 6.3 — Tarifario ↔ detalles: NO se cambió la dirección (decisión pendiente)
Hoy el status viaja tarifario → detalle y todo lo demás detalle → línea del tarifario. Hacer del detalle la única fuente
exige que la pantalla del tarifario escriba el status en el detalle, y las líneas "pre-convenio" no tienen detalle.
Propuesta en code-notes.md; mientras tanto solo se agregaron listas blancas y transacción.

### 6.4 — Reintentos
- Todos los triggers con `retry: true`. Los errores se registran (`[reintentos]` en el log) y se relanzan; un evento de
  más de 24 h se descarta con error. Los triggers RELEEN el documento actual (o escriben con precondición o en
  transacción) para que un reintento tardío no regrese datos viejos (claims de usuario incluidos).
- `eventos_procesados/{id}` con TTL de 7 días en `expiraEn` (declarado en `firestore.indexes.json`).

### 6.5 — Contadores de uso
- `usos/{empresa|convenioCliente|convenioProveedor}_{id}`: `usoOps` (operaciones sin pruebas) y `ultimoUsoISO`.
  En documentos APARTE (no en la empresa ni en el convenio: esos los escuchan todas las pantallas).
- `operacionEscrita` los mantiene con `increment()` en un lote con `create(eventos_procesados/usos_<evento>)`: un
  reintento no suma dos veces y una importación masiva no compite por el mismo documento. Si fallan, solo se
  registra (nunca frenan lo demás); `npm run usos` los deja exactos.

### 6.6 — Índices
`fieldOverrides`: sin índice para `operacionesGuardadas`, `tarifas` y `pagos.facturas` (nadie los consulta; menos costo
de escritura) y TTL de `eventos_procesados.expiraEn`.

## Pasos en producción (en orden)
1. Web.
2. `firebase deploy --only functions`. **Pedirá borrar `operacionMontoCambiado`: responder que sí** (si se conserva,
   la cascada de montos correría dos veces).
3. `firebase deploy --only firestore:indexes` (fieldOverrides + TTL). P1: reglas (`npm run test:rules` → `--only
   firestore:rules`).
4. Alerta: en Cloud Monitoring, métrica basada en registros con `"[reintentos]"` y severidad ERROR.
5. **P2** (desde `functions/`, después del respaldo):
   - `npm run usos` → revisar `reportes/usos-*/usos.csv` → `npm run usos -- --aplicar --confirmo-respaldo`.
   - `npm run nombres` → revisar `reportes/nombres-*/cambios.csv` (qué copias de nombres cambiarían y a qué) →
     `-- --aplicar --confirmo-respaldo` → encender `propagacionEnServidor`.

## Lecturas / invocaciones por acción
| Acción | Antes (V00441) | Ahora |
|---|---|---|
| Facturar N operaciones (callables, canónicos encendidos) | 2N–4N invocaciones, N escrituras extra de operación + 1 de factura | N invocaciones sin escritura extra |
| Guardar una operación sin cambios de dinero | 2 invocaciones | 1 invocación |
| Adjuntar el PDF de una factura (con `dineroPorServidor`) | 1 invocación + 1 lectura (proyección) | 1 invocación, 0 lecturas |
| Renombrar una empresa | 6 consultas, solo `nombre` | 16 destinos × (ID + canónico) con `select`, 1 escritura por documento |
| Cambio sin relevancia en un detalle de convenio | 3 lecturas (tarifario, maestro, tarifario) | 0 |

## Verificación
- `tsc -b` ✔ · trinquete ESLint ✔ (sin cambios) · vitest web 150 ✔ · `npm run build` ✔ · functions `tsc` ✔ + scripts ✔ ·
  vitest functions 49 ✔ (reintentos y deduplicación, contadores, propagación con reglas por destino, cascada en
  transacción con bandera apagada, listas blancas) · copia de dominio al día ✔.
- Revisión independiente: 10 hallazgos. Corregidos: reintentos que usaban la copia del evento (cascada de montos,
  claims, tarifario, renombres), renombres que habrían cobrado el peaje a operaciones viejas (ahora solo cuentan los
  IDs que cambia el usuario), propagación de la descripción del convenio (retirada), contadores que podían frenar
  `operacionEscrita` y competir en importaciones, saldo de factura que podía quedar atrasado tras una precondición,
  descarte a los 15 min de eventos solo atrasados (ahora 24 h), regla única de empresas que no coincidía con el
  formulario (ahora por destino), escrituras duplicadas y sin `select` en la propagación, sin puesta al día previa.
- **No probado aquí**: emulador (reglas, TTL, reintentos reales) ni navegador.
