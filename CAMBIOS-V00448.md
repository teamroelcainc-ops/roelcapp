# V00448 — Code Review de la V00447: correcciones

**Web + Cloud Functions + reglas (sin publicar).** Sin banderas nuevas. Corrige lo que encontró la revisión formal de
todo el cambio desde `origin/main` (f27e2ea, V00434) hasta la V00447. Con las banderas apagadas la app se comporta
como la V00447, salvo los puntos marcados **(se nota hoy)**.

## Cómo se revisó
Cuatro revisiones independientes: seguridad; dinero; servidor y despliegue; datos, caché y paridad con la V00434.
Cada hallazgo se comprobó en el código antes de corregirlo; los que no se sostuvieron no aparecen aquí. El arranque y
la navegación se volvieron a medir en el banco de pruebas de navegador (V00447 y V00448, dos corridas cada una): sin
diferencia fuera del ruido.

## 1. Dinero
| Hallazgo | Corrección |
|---|---|
| **Cambiar el # de factura de una operación al MISMO folio** (dar Guardar sin cambiarlo, o un reintento tras perder la respuesta) la sacaba de su factura y creaba otra con el mismo folio. **(se nota hoy)** | Si ya está en una factura con ese folio, no se hace nada (servidor: `moverOperacionFactura` responde `sinCambios`; web con la bandera apagada: igual). Servidor: si estaba repetida en dos facturas y una tiene el folio, se queda solo en esa. |
| `totalesTrasCambioDeOps`: con total guardado en 0 tomaba el de los renglones; el documento secundario de un folio repetido (guarda 0/0) quedaba con saldo al quitarle o moverle una operación. **(se nota hoy)** | El total guardado, aunque sea 0, es el punto de partida. El total manual (`totalManualCentavos`) sigue mandando. |
| Cascada de montos (`functions/src/relacional.ts`): si la operación quedaba con monto 0 (captura a medias) ponía en 0 su renglón en la factura. Con `dineroPorServidor` usaba la regla vieja. | No toca un renglón con monto cuando el nuevo es 0 (deja aviso en el log). Con la bandera usa la regla única. |
| Reconciliación (P3) marcaba como "total manual" TODA factura cuyo total no sale de sus renglones: un total viejo o desfasado quedaba congelado para siempre. | Solo se reporta ("REVISAR") y se marca únicamente si el negocio pone el ID en `--manuales archivo.txt`. |
| Totales que muestra Facturación (tabla, orden, tarjetas, Excel, auditoría) usaban la regla única aunque Pagos siga con la anterior: podían no coincidir en facturas viejas. **(se nota hoy)** | Con la bandera apagada se muestran con la regla de Pagos, como en la V00434. |

## 2. Datos y caché
- **`obtenerVivo` / `obtenerCatalogo` rechazan** si el listener falló o si en `esperaMs` no llegó NINGÚN dato (ni de la
  caché ni del servidor). Antes devolvían `[]` y quien escribía no distinguía "vacío" de "no llegó": la reparación de
  convenios creaba tarifarios vacíos y re-apuntaba los convenios a ellos. Una colección vacía confirmada por el servidor
  sigue devolviendo `[]`. Se revisó cada una de las 126 llamadas con un análisis del árbol de llamadas: las que escriben
  ya estaban dentro de try/catch; los 15 PDF de Operaciones, Cancelados y Completados y la Confirmación de Tarifa
  avisan ahora (`leerParaDocumento`)
  en vez de salir con "N/A"; dos lecturas que solo muestran (nombres de status del tarifario, nombre de la carga en el
  formulario) caen a lo de antes.
- **Listener reabierto tras un error**: si su primer resultado venía vacío se ignoraba y se quedaban las filas viejas.
  Ahora el primer resultado de un listener (re)abierto se publica siempre.
- **Integridad de convenios**: además, se niega a reparar si hay convenios pero la lectura de tarifarios o maestros
  llegó vacía.
- **Banderas al cambiar de usuario**: al cerrar sesión y entrar con otro, se daban por "cargadas" (todas apagadas) sin
  esperar la lectura nueva. Ahora cada sesión espera la suya.
- **Peaje**: los catálogos de gastos con los que se escribe el saldo de puentes se leen confirmados por el servidor.
- **PDF de Servicios Completados**: esperan unidades, operadores externos y direcciones. En el primer clic de la sesión
  salían con "N/A" (la V00434 abría esos catálogos al entrar). **(se nota hoy)**
- **`fechaServicioISO: null` explícito**: `orderBy('fechaServicioISO')` deja fuera los documentos SIN el campo; una
  operación sin fecha de servicio no aparecería en las listas al encender `consultasCanonicas`. El trigger y la
  migración (P2) escriben ahora `null`. La paridad de la migración tiene fila de **Facturación proveedores**.

## 3. Seguridad
- **`gestionarUsuario`**: con las reglas VIEJAS (las publicadas hoy) cualquier usuario puede escribirse el rol ADMIN en
  su perfil y con eso podía crear, deshabilitar o borrar cuentas de Auth con esta función. Ahora responde "apagada"
  mientras `usuariosPorServidor` no esté encendida, y el paso a paso la enciende DESPUÉS de publicar las reglas (paso
  8). Riesgo que queda: con las reglas viejas esa persona también podría encender la bandera; eso lo cierra solo P1.
  Por eso P1 conviene hacerlo pronto.
- **Eliminar con papelera** ya no borra `facturas_clientes`/`facturas_proveedores` (dejaba operaciones ligadas a una
  factura inexistente; se borran en Facturación), `saldos_corrientes`, `usos` ni `eventos_procesados`.
- **HTML de PDF e impresión**: los 5 PDF de la operación y las Instrucciones de diésel pegaban el texto capturado con
  `innerHTML` sin escapar: un `<img onerror=…>` en una descripción se ejecutaba con la sesión de quien generara el PDF.
  Ahora `escaparTextos(datos)` en cada generador; también Reportes → PDF (celdas, columnas, resumen, título) y la fecha
  de la Relación de Compras.
- **Reglas (sin publicar, se publican en P1)**:
  - `escritor()` exige que el perfil SIGA siendo de personal (existe, activo, no cliente). Antes solo que existiera: un
    usuario desactivado o pasado a cliente seguía escribiendo hasta 1 h con su token.
  - `catalogo_roles` solo admin: también decide "Requiere IP de oficina" (borrar un rol ahí saltaba esa revisión).
  - Storage: subir o borrar exige además el perfil vigente.
  - Pruebas nuevas en `firebase-tests/firestore.rules.test.ts`. **No se pudieron correr aquí** (el emulador se descarga
    de un sitio bloqueado en este entorno): se corren en el paso 8 con `npm run test:rules`.

## 4. Servidor
- **Node 22** en Cloud Functions (`functions/package.json` → `engines`). El deploy avisaba que Node 20 deja de
  recibir soporte el 2026-10-30. `firebase-functions` 7 lo soporta; no cambia código.
- **Índices junto con las funciones**: la política TTL de `eventos_procesados` (`expiraEn`) está en
  `firestore.indexes.json`; sin desplegarla esa colección crece sin límite. Se despliega con las funciones.

## No corregido (y por qué)
- **Quitar una referencia de un grupo fusionado** (Facturación Clientes) escribe el grupo completo. Existía en la
  V00434; queda para la decisión 8.2.
- **Pago con una factura sin moneda reconocible** mezclada con facturas USD o MXN: el servidor lo acepta, igual que la
  web. La reconciliación (P3) reporta las facturas sin moneda.
- **Empresas con `consultasCanonicas`**: el filtro de moneda usa la moneda guardada en la operación; el camino viejo la
  recalculaba. Revisar en el paso 12.
- **Bitácora**: el usuario de cada entrada de `historial_actividad` lo pone el navegador. Bajo.

## Pruebas
- `npm run verificar`: 24 archivos, 267 pruebas (nuevas: obtenerCatalogo rechaza / vacío real / reabrir tras error;
  banderas al cambiar de usuario; total guardado en 0; `fechaServicioISO` null). Línea base de ESLint bajada
  (any 2327 → 2323).
- Cloud Functions: build y 49 pruebas (reconciliación con `--manuales`).
- `npm run build` y banco de pruebas en navegador sin errores.

## Pasos manuales (ya están en el paso a paso)
1. Aplicar la V00448 encima de la V00447 (`git merge --ff-only`).
2. Paso 4: `firebase deploy --only functions,firestore:indexes` (a "¿borrar índices que no están en el archivo?" → N).
3. `usuariosPorServidor` pasa del paso 7 al paso 8, después de publicar las reglas.
4. El registro público de Authentication se cierra DESPUÉS de encender `usuariosPorServidor`: con el registro cerrado,
   el alta de usuarios del camino viejo (app secundaria del navegador) falla.
5. P1 (paso 8) pronto: es lo que cierra el riesgo de las reglas viejas.
6. P3: la reconciliación se aplica con `--manuales manuales.txt` (IDs que el negocio confirmó como totales manuales).
