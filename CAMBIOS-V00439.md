# V00439 — Fase 3: catálogos compartidos en vivo, tipos de Firestore y constantes únicas

Sin pasos en producción: es solo la web. Ningún cambio de datos ni de reglas.

## Qué se siente
- **Los catálogos se leen una vez para toda la app** y se mantienen al día solos. Antes cada módulo hacía su propio
  `getDocs` de empresas, unidades, remolques, convenios, monedas, status… y los copiaba a localStorage hasta 24 h
  (`cat_v1__`, `cat_v2__`, `roelca_catalogos_v2`, `flujo_v1__`). Ahora hay **un solo listener por colección**
  (`src/shared/data/catalogos.ts`), compartido por todas las pantallas, que sigue abierto 15 min después de que nadie
  lo usa (ir y volver no vuelve a leer). Editar una empresa o un convenio se ve al instante en Operaciones,
  Facturación, Estadísticas, etc., sin "limpiar caché".
- Al arrancar se borran las copias viejas de catálogos en localStorage (liberan espacio).
- Los servicios fuera de React (PDF, sincronizar nombres, integridad de convenios, reglas de estatus) usan
  `obtenerCatalogo()`, que espera la confirmación del servidor (máx. 6 s) en vez de la copia local.
- **Permisos por rol** (`EDITAR REF`, Autorizaciones, "Vista como") salen de la sesión: ya no se relee el perfil y
  toda la colección `roles` en cada formulario.

## Archivos nuevos
- `src/types/firestore.ts`: tipos de los documentos (ids con marca, `FechaISO`, `Centavos`, `Esquema`).
- `src/shared/data/convertidores.ts`: `col('pagos')` → colección tipada con `withConverter` (normaliza números en
  texto y agrega `fechaServicioISO` al leer; para código nuevo).
- `src/shared/data/coleccionesVivas.ts`: `useColeccionViva(clave, consulta)` — un `onSnapshot` por clave para toda la
  app, con conteo de uso, permanencia de 15 min y pausa en módulos ocultos (MantenerVivo).
- `src/shared/data/catalogos.ts`: `useCatalogo`, `useCatalogos`, `obtenerCatalogo`, `idReal`.
- `src/shared/data/sesion.ts`: `usePermisoRol`, `tienePermisoRol`, `useEsAdmin`.
- `src/features/facturacion/services/mapaCatalogos.ts`.
- Pruebas: `catalogos.test.tsx`, `convertidores.test.ts`, `sesion.test.ts`.

## Archivos borrados (sin uso o duplicados)
`src/types/operacion.ts`, `models.ts`, `empresa.ts`, `tipoCambio.ts`, `proveedorUnidad.ts`;
`src/config/entitySchemas.ts`, `formDefs.ts`, `modules.ts`; `src/firebase/config.ts` (segundo `initializeApp`);
`src/hooks/useCatalogoCache.ts`; `src/features/conveniosClientes/services/tarifasReferenciaService.ts`.
Las constantes repetidas (`ID_USD`, `ID_MXN`, status completados/cancelado, tipos de empresa, puentes) ahora vienen
de `src/shared/dominio/constantes.ts`; la moneda se decide con `esUSD`/`monedaCanonica`.

## Cambios de comportamiento (a revisar)
- **EDITAR REF**: antes cualquier rol cuyo nombre *contuviera* "ADMIN" (p. ej. **ADMINISTRATIVO**) contaba como
  administrador y podía editar la referencia. Ahora solo el rol administrador exacto o un rol con el permiso
  `EDITAR REF` en sus módulos. Si un rol ADMINISTRATIVO debe editar referencias, agréguele ese permiso en Roles.
- **Monedas**: la regla compartida reconoce el ID del catálogo, el código (USD/MXN) y el nombre con o sin acento
  ("Dólares"). Antes algunas pantallas solo reconocían una forma. Afecta a:
  - Costos Adicionales: una moneda del catálogo llamada "Dólares" sin "USD" ahora se trata como dólares.
  - Combustible: `esDolar` ahora es verdadero para "Dólares" con acento (antes solo "dolar"/"usd" sin acento).
  - Saldo de puentes por moneda y tarjetas de casetas: el nombre que se muestra/guarda es el canónico
    ("Dólares"/"Pesos").
- **Caché persistente**: se mantiene `persistentSingleTabManager` (una pestaña con caché en disco) hasta que la
  Fase 7 retire las copias de operaciones en localStorage; el guardián de espacio (>3.5 MB) sigue activo para esas
  copias (`roelca_completadas_`, `empresas_conteo_ops_`, `detalles_convenio__`).
- La Confirmación de Tarifa a Proveedor pide las direcciones al abrirse (antes usaba solo las que ya estuvieran en
  la copia local; si no estaban, la ciudad salía vacía).
- Los PDF de Operaciones (Solicitud de Retiro, Instrucciones, Check List, Prueba de Entrega, Carta) piden unidades,
  remolques, unidades y operadores de proveedor al momento del clic (antes podían salir "N/A" si se descargaba
  justo al abrir la ficha).

## Detalle técnico
- **Id real del documento**: cada documento de catálogo es `{ id, ...datos }` como lo armaban los módulos (si el
  documento guarda su propio campo `id`, ese gana, igual que antes) y trae `_docId` (no enumerable) con el id real.
  Donde el código viejo usaba `d.id`/`d.ref` del snapshot (escrituras, mapas de llaves foráneas, opciones de
  selects), ahora se usa `idReal(x)`. Revisado archivo por archivo contra `git diff` (≈60 archivos).
- `onSnapshot` con `includeMetadataChanges`: la confirmación del servidor sin cambios también marca `delServidor`
  (sin eso `obtenerCatalogo` esperaba los 6 s completos cuando la caché ya tenía todo).
- Un listener que falla (p. ej. permisos) se puede reabrir; al cerrarse por permanencia deja de contar como
  "confirmado por el servidor".
- En desarrollo los arreglos compartidos están congelados (`Object.freeze`): ordenar en sitio lanza error; se copia
  antes (`[...datos].sort()`).
- `agregarRegistro`/`actualizarRegistro` revisan los datos contra su tipo cuando la colección está en `Esquema`.
- ESLint: regla `no-restricted-syntax` (aviso) contra `getDocs`/`onSnapshot` directos sobre colecciones de catálogo.

## Verificación
- `tsc -b` ✔ · trinquete ESLint ✔ (any 2,817 → 2,475) · vitest 75 ✔ · `npm run build` ✔ · functions `tsc` ✔.
- Revisión independiente: 8 hallazgos — confirmación del servidor sin cambios, reapertura tras error, id real del
  documento, multi-pestaña con localStorage aún en uso, direcciones de la Confirmación de Tarifa, catálogos de los PDF,
  EDITAR REF y monedas (documentados arriba) — corregidos.
- **No probado en navegador**: listeners compartidos y su permanencia, la limpieza de localStorage al arrancar,
  los PDF y la Confirmación de Tarifa, los selects que guardan ids de catálogo. Revisar con `npm run dev:medir`:
  `__lecturas.listeners()` debe mostrar un listener por catálogo aunque haya varias pantallas abiertas.
