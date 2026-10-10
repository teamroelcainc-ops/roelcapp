# V00440 — Fase 4: modelo canónico de operaciones (sin migrar todavía)

**Punto de parada P2**: la migración está lista pero NO se ha corrido. Nada de lo nuevo en el servidor
hace efecto hasta encender la bandera `canonicosEnServidor`. La web se puede publicar sola.

## Qué es
Las operaciones guardan sus relaciones mezcladas: `clientePaga` puede traer el ID de la empresa o su nombre (registros
de AppSheet), la fecha de servicio viene en tres formatos, los montos a veces son texto y el "estado" se deduce del ID
o del nombre del status. Para que la Fase 7 pueda consultar por rango de fecha, por empresa o por estado **en el
servidor** (sin descargar miles de operaciones), cada operación lleva ahora campos **canónicos**, escritos JUNTO a los
legados (nada se borra ni se reemplaza):

| Campo | Qué es |
|---|---|
| `fechaServicioISO` | 'AAAA-MM-DD' (misma regla que "⚡ Acelerar búsquedas") |
| `clientePagaId`, `clienteMercanciaId`, `provServiciosId`, `proveedorUnidadId`, `origenId`, `destinoId` | ID de la empresa en cada papel, aunque el campo legado traiga un nombre |
| `empresasIds` | todas las empresas que participan (para la ficha de Empresas con `array-contains`) |
| `convenioClienteId`, `convenioProveedorId`, `statusId`, `unidadId`, `operadorId`, `cargaId`, `aduanaId` | IDs del resto de relaciones |
| `monedaCliente`, `monedaProveedor` | 'USD' / 'MXN' de facturación |
| `montoConvenioClienteCentavos`, `cargosAdicionalesCentavos`, `totalAPagarProvCentavos`, `cargosAdicionalesProvCentavos`, `sueldoOperadorCentavos` | montos en centavos enteros |
| `estadoGrupo` | 'activa' / 'completada' / 'falso' / 'cancelada' (misma regla que Activas/Completados/Cancelados) |
| `porFacturarCliente`, `porFacturarProveedor` | pendientes de facturar (misma regla que Facturación) |
| `esPrueba`, `nominaId`, `esquemaVersion: 2` | |

Además: `pagos.empresaId` y `referencias_nomina.fechaPagoISO` (junto a `fechaPago`, que no se toca).

## Archivos
- `src/shared/dominio/operacionCanonica.ts` (+ prueba): la regla, pura y compartida con el servidor. Incluye
  `estadoGrupoDe`, `esOperacionPrueba`, `esFacturableProveedor`, la regla "EL CONVENIO MANDA" (antes solo en
  `relacional.ts`) y `normalizarNumerosOperacion`.
- `src/shared/dominio/fechas.ts`: `aFechaServicioISO` (la de "⚡ Acelerar búsquedas", sin escribir basura).
- `functions/src/canonico.ts`: catálogos chicos en memoria y `cambiosCanonicos` (qué escribe el trigger).
- `functions/src/flags.ts`: banderas leídas desde el servidor (60 s en memoria).
- `functions/src/relacional.ts`: `operacionEscrita` escribe lo derivado del convenio + los canónicos en UNA escritura con
  precondición; si la operación cambió mientras se calculaba, recalcula en transacción. `verificarIntegridad` cuenta
  operaciones sin esquema v2, sin `fechaServicioISO`, sin `estadoGrupo` y con relaciones sin su ID.
- `functions/src/index.ts`: `crearOperacion` (v2.2) crea la operación ya canónica (con la bandera) y nunca acepta
  canónicos enviados por el navegador.
- `functions/scripts/migrarEsquemaV2.ts` (+ `tsconfig.scripts.json`, `npm run migrar:v2`): la migración.
- Pruebas: `functions/test/canonico.test.ts`, `functions/test/migrarEsquemaV2.test.ts` (corre la migración completa en
  simulación contra un Firestore falso).

## Cambios visibles en la web (pequeños)
- **Formulario de operación**: montos y cantidades se guardan como número (antes, texto del input: '1250.50'). El
  historial de ediciones no cuenta eso como cambio. El formulario ya no reescribe campos canónicos.
- **Pagos nuevos** llevan `empresaId`. **Nóminas** guardan `fechaPagoISO`.
- **Operaciones Activas / Servicios Completados (Falsos) / Nómina** usan la regla compartida `estadoGrupoDe`
  (resultado igual al anterior para los datos que cargan).
- Las demás pantallas que deciden "cancelada/completada" por texto (Resumen del día, Resumen diario, saldos y
  referencias de puentes) se dejaron IGUAL a propósito: pasar a la regla por ID cambiaría sus cifras en casos raros;
  cambian junto con sus consultas en la Fase 7.

## Pasos en producción (en orden)
1. Publicar la web (no depende de nada).
2. `firebase deploy --only functions` (con la bandera apagada nada cambia: `operacionEscrita` solo hace lo de siempre,
   ahora con precondición).
3. Encender `canonicosEnServidor: true` en `configuracion/flags`. Desde ese momento cada operación creada o editada
   (web, app móvil o importación) queda con sus canónicos. Costo: ≤ 2 invocaciones de `operacionEscrita` por guardado
   (la segunda no escribe) y 3 catálogos chicos cada 5 min por contenedor.
4. **P2 — migración** (desde `functions/`, con `gcloud auth application-default login`):
   1. Respaldo: `gcloud firestore export gs://roelcaapp.appspot.com/respaldos/$(date +%Y%m%d-%H%M) --project roelcaapp`.
   2. Simulación: `npm run migrar:v2` → revisar `functions/reportes/migracion-v2-*/`:
      `resumen.json`, `cambios.csv`, `pendientes.csv` (nombres que no se pudieron resolver: homónimos, empresas
      inexistentes, fechas ilegibles), `avisos.csv` (IDs que no existen o que son llaves de AppSheet) y `paridad.csv`
      (operaciones que las consultas nuevas clasificarían distinto que los filtros actuales).
   3. Corregir a mano lo que se pueda de `pendientes.csv` y volver a simular.
   4. Aplicar: `npm run migrar:v2 -- --aplicar --confirmo-respaldo`. Es idempotente: se puede repetir.
   5. Correr **Verificar integridad**: `opsSinEsquemaV2`, `opsSinFechaISO`, `opsSinEstadoGrupo` deben quedar en 0 (o
      en los casos de `pendientes.csv`).
5. Nada más: las consultas por canónicos se encienden en la Fase 7 (`consultasCanonicas`).

## A tener en cuenta
- **Fechas de 2 dígitos de año** ('9/10/26'): se leen día/mes (9 de octubre). "⚡ Acelerar búsquedas" las leía como
  mes/día con el motor del navegador. Si alguna operación así ya tenía `fechaServicioISO`, cambiará de día en las
  búsquedas de Servicios Completados (el nuevo es el correcto). Aparecen en `cambios.csv`.
- Los IDs con forma de ID se guardan tal cual aunque no existan (el trigger y la migración deben coincidir); la
  migración los lista en `avisos.csv`, incluidas las llaves de AppSheet guardadas dentro de un documento.
- Un dato que el trigger no puede resolver (un nombre viejo) conserva lo que puso la migración mientras el usuario no
  lo cambie. Si lo cambia por otro nombre, el ID se limpia hasta la siguiente corrida de la migración.
- La regla "EL CONVENIO MANDA" sigue partiendo el nombre del convenio (" - "); dejarla por ID requiere guardar
  `cargaId`/`aduanaId` en el detalle del convenio (Fase 6.3). Las copias de esa regla en Completados, Estadísticas y
  Catálogos se quitan cuando sus consultas pasen a canónicos (Fase 7).

## Verificación
- `tsc -b` ✔ · trinquete ESLint ✔ (any 2,475 → 2,474) · vitest web 93 ✔ · `npm run build` ✔ ·
  functions `tsc` ✔ + scripts ✔ · vitest functions 17 ✔ · copia de dominio al día ✔.
- Revisión independiente en dos rondas: 7 hallazgos confirmados en la primera (campos viejos con el mismo nombre que
  el trigger borraba, `empresasIds` que se encogía, fechas que se movían de día por zona horaria, la migración que se
  caía con un error de escritura, cifras del Resumen del día, `--sin-derivar` sin efecto, historial con cambios
  falsos) y 3 en la segunda (estado calculado distinto por trigger y migración, documentos restaurados que perdían
  IDs, el formulario que regresaba canónicos viejos). Todos corregidos y con prueba.
- **No probado contra Firestore real ni emulador** (no se puede descargar aquí): el trigger, `crearOperacion` y la
  migración se probaron con su lógica y con un Firestore simulado. Antes de P2, correr la simulación en producción
  (no escribe) y, si es posible, `--aplicar` primero en el emulador con un export.
