# Progreso de la refactorización (prompt del 31/10/2026)

Se lee antes de tocar un módulo y se actualiza al cerrar cada versión. Plan completo: el prompt
"Roelca más ligera, cambios al momento, formularios al instante y refactor completo" (una versión por paso).

## Estado por paso

| Paso | Versión | Estado |
| --- | --- | --- |
| 1. Peso, sin cambios visibles | V00534 | Hecho |
| 2. Errores reales | V00535 | Hecho |
| 3. Cambios al momento con el bus | V00536 | Hecho (función editarFactura por desplegar; script de folios P2 sin correr) |
| 4. Fichas y listas en vivo | — | Espera respuesta: ¿`consultasCanonicas` y `dineroPorServidor` encendidas? |
| 5. Formularios al instante | — | Pendiente |
| 6. Una sola librería de Excel | — | Espera respuesta: ¿se quita `xlsx`? |
| 7. Componentes y utils compartidos | — | Pendiente |
| 8. Refactor por módulo | — | Espera respuesta: ¿se instala React Compiler? |

## Módulos refactorizados (paso 8)

Ninguno todavía.

## Mediciones

### Peso por pantalla (`node scripts/medir-pantallas.mjs`, KB gzip de la primera visita)

| Pantalla | V00533 | V00534 | Meta |
| --- | ---: | ---: | ---: |
| Arranque (login) | 391 | 260 | ~276 |
| Operaciones Activas (inicio) | 699 | 333 | ~375 |
| Servicios Completados | 557 | 344 | ~373 |
| Facturación Clientes | 1,344 | 390 | ~482 |
| Facturación Proveedores | 1,334 | 365 | ~472 |
| Estadísticas | 970 | 315 | ~372 |
| Empresas | 637 | 349 | ~372 |
| Pagos | 428 | 301 | ~313 |
| Precache del Service Worker | 7.87 MB (230 archivos) | 5.07 MB (257) | ~5.1 MB |

V00535 (errores): sin cambio de peso (±1 KB).

V00536 (bus): +1 KB gz por pantalla (bus, `useFichaViva`, folio); login igual; precache 5.09 MB (258).

El precache de la auditoría (8.06 MB, 234) contaba también el sw y el manifiesto; el script cuenta lo que lista `sw.js`.

### Repintados (`npm run medir:render`, commits por acción)

| Módulo | Arranque | Cambio de empresa | Ocultar | Volver | Listeners |
| --- | --- | --- | --- | --- | --- |
| Operaciones | 5 → 5–6 | 0 → 0 | 1 → 1 | 1 → 1 | 5 → 5 |
| Completados | 4 → 4 | 1 → 1 | 1 → 1 | 1 → 1 | 7 → 7 |
| Facturación Clientes | 4 → 4–5 | 1 → 1 | 1 → 1 | 1 → 1 | 9 → 9 |
| Empresas | 4 → 4 | 2 → 2 | 1 → 1 | 1 → 1 | 6 → 6 |

El arranque varía ±1 entre corridas de la misma versión (llegada de los listeners); las acciones no cambian.

V00536: Operaciones 6/0/1/1 (5 listeners), Completados 4/1/1/1 (7), Facturación Clientes 5/1/1/1 (9), Empresas 4/2/1/1 (6): iguales.

## Pendiente o anotado

- Fuera del plan del refactor (pedido de Omaf, 31-oct): botones Solucionar en la Revisión de datos. V00538: D1/D4 (Corregir monedas / Tomar lo de la factura), D5/F2/F2c (abren la pantalla exacta). V00539: D2, F3, F2c y F5. Todos los grupos tienen botón.
  V00540: Solucionar abre el formulario ENCIMA de la ventana (operación o Editar factura; al cerrar sigue en el mismo lugar); F5 va a Facturación y la ventana se reabre al volver. Editar factura (clientes) salió del tablero a su propio formulario (`EditarFacturaCliente`); el de Proveedores sigue dentro de su tablero (se unen con `lado` en el paso 7/8).

- V00536: correr `npm run folios` (desde functions/) en simulación y revisar `cambios.csv` antes de aplicar (punto P2). Desplegar `editarFactura` para que el camino con `dineroPorServidor` escriba el folio en las operaciones.
- V00536: Operaciones Activas, Completados y Facturación siguen leyendo una vez (sin listener): el bus cubre lo que se guarda en esta pestaña; lo de otros usuarios u otras pestañas llega en el paso 4.

- V00535: fechas guardadas (Timestamp/Date) que se convierten a su día en UTC; lista en `code-notes.md` (V00535). Decidir si se pasan a hora local.

- `src/features/operaciones/context/FormularioOperacionContext.tsx` no lo importa nadie (código muerto). Se revisa en el paso 8.2.
- `ConfiguradorStatus.tsx`: el cambio de la V00474 (los movimientos no llevan aduana) se había perdido en el repo de Omaf; se volvió a aplicar en la V00537.
- `TarjetaCasetas` y `TarjetaSaldoDiesel` siguen estáticos en `App.tsx`: se pintan en el inicio justo después de entrar; pasarlos a `lazy()` ahorra ~7 KB gz del arranque a cambio de que aparezcan un instante después. Se dejaron.
