# V00452 — Pagos más rápido: "Registrar Pago" abre al instante

**Solo web** (deploy de hosting de siempre). Sin reglas, índices, banderas ni Cloud Functions.

## Por qué tardaba 8–10 s
| Causa | Antes | Ahora |
|---|---|---|
| Facturas del modal | Cada vez que se abría "Registrar Pago" se descargaban **todas** las facturas de la pestaña (≈9,000 de clientes / ≈6,000 de proveedores) de 1,000 en 1,000, **una página tras otra**. También al editar un pago, al "Recargar", al volver a la pestaña del navegador y en los reportes. | Un **listener compartido** por colección (`useColeccionViva`): empieza en segundo plano en cuanto se ve la lista de pagos, muestra primero lo que ya está en la caché del navegador y se pone al día con el servidor; después solo llegan los **cambios**. Abrir el modal ya no descarga nada. |
| Moneda de la empresa | Por **cada factura** se recorría el catálogo de empresas (≈2,000) con `find` + nombre normalizado: millones de comparaciones al armar la lista. | Índice (`Map` por id y por nombre) que se arma una vez por catálogo (`crearMonedaEmpresa`, mismo resultado: probado contra la versión vieja con 3,000 casos al azar). |
| Código al entrar a Pagos | Se descargaba y ejecutaba Excel (424 KB), el generador de PDF (975 KB) y el formulario completo de operaciones (con todos sus formularios). | Se cargan **al usarlos** (exportar, abrir el hilo o una operación). |
| Arranque de la app | `src/utils/pdfGenerator.ts` importaba html2pdf y lo usa el inicio de sesión (logo): el PDF (975 KB) iba en la carga inicial de **toda** la app. | html2pdf se carga al generar un PDF. |

**Medido en el banco de pruebas** (Firebase simulado con ≈9,000 facturas, 6,000 de proveedores y 4,000 pagos; red lenta):

| Acción | V00451 | V00452 |
|---|---|---|
| "Registrar Pago" (después de ver la lista unos segundos) | 11.7 s | **1.1 s** |
| Volver a abrir "Registrar Pago" | 9.9 s | **0.16 s** (0 lecturas) |
| "Registrar Pago" en Proveedores | 6.4 s | **0.25 s** |
| Primera vez en un navegador sin caché y clic inmediato | 10.3 s | 9.0 s (la primera descarga sigue siendo completa) |

## Qué cambia para el usuario
- Los saldos de la lista **se actualizan solos** al registrar, editar o eliminar un pago, al editar o recalcular una factura (también si lo hace otra persona). Por eso se quitaron los botones **Recargar** (arriba y dentro del modal) y la recarga al volver a la pestaña del navegador.
- Mientras los saldos vienen de la caché del navegador se ve **"Actualizando saldos…"** y **Guardar Pago** espera a que el servidor los confirme (normalmente un instante). En MTTO también espera los pagos (su saldo sale de ellos).
- Si una factura elegida **se pagó o cambió** mientras se capturaba: al guardar se avisa, se quita de la selección (o se ajusta el monto al saldo nuevo) y se pide revisar antes de guardar. Igual al agregar facturas en la edición de un pago. (La transacción ya protegía contra aplicar de más; ahora se avisa antes, con el nombre de la factura.)
- Si la lista no se puede actualizar (sin red), aparece el aviso con **Reintentar**.
- Reportes de facturas pendientes: usan la lista confirmada por el servidor (si aún no, la esperan).

## Lecturas de Firestore
- Antes: cada apertura del modal (y cada Recargar / edición / reporte) = todas las facturas (≈9,000 lecturas en Clientes).
- Ahora: ≈una descarga completa por sesión y pestaña (o cada 30 min sin usar Pagos); después solo los cambios. **Decisión tomada**: la descarga empieza al ver la lista de pagos (para que el modal abra al instante), así que entrar a Pagos solo para mirar también la hace. Quien registra pagos lee mucho menos que antes. Si se prefiere que empiece hasta presionar "Registrar Pago", es un cambio de una línea (`activo` en PagosDashboard).

## Técnico
- Nuevos: `src/features/pagos/services/facturasPagables.ts` (+ pruebas: moneda de empresa, cobrables, total, ids, MTTO), `src/features/pagos/hooks/useFacturasPagables.ts`, `src/shared/data/coleccionesVivas.test.tsx`.
- `coleccionesVivas.ts`: opción `avisarConfirmacion` (publica una vez la confirmación del servidor sin cambios; los catálogos no la piden y siguen sin repintar, V00446) y `reintentarVivo(clave)`.
- `PagosDashboard.tsx`: pagos e invoices en vivo (claves `pagos:<tab>`, `pagos:facturas_clientes`, `pagos:facturas_proveedores`, `pagos:gastos_mtto`; con `consultasCanonicas` + `dineroPorServidor` solo `abierta == true`); sin parches locales de la lista; edición de pago con la lista derivada; Excel/PDF con `import()`; `HiloModal` y `EditorOperacionEmbebido` perezosos. ESLint del archivo: 46 → 28 problemas.
- `pdfGenerator.ts`: html2pdf con `import()`; si el PDF no se puede generar, ahora se avisa (antes el error se perdía).
- Revisión independiente (agente aparte): 6 hallazgos, corregidos: confirmación del servidor que no llegaba (Guardar se quedaba esperando con la caché completa), reintento tras error, selección que desaparecía en silencio, MTTO sin pagos confirmados, reportes con caché, error al cargar el PDF sin aviso.
- Banco de pruebas: registrar un pago (la factura sale de la lista sin recargar), otra persona paga una factura elegida mientras el modal está abierto (aviso + corrección), edición de pago, Excel de pagos y de pendientes, hilo y editor perezosos, MTTO. Sin errores de consola.

## No probado con datos reales
El tiempo real depende del tamaño de las facturas y de la red. Pruébalo en tu computadora (Paso 2 del documento de pasos).
