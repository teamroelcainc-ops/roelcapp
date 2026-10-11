# V00447 — Revisión de CSS, caché y rendimiento: pantallas en orden, arranque sin esperas en fila

**Solo web. Sin banderas ni pasos en producción.** Corrige lo que se veía desacomodado y lo que hacía más lenta la
V00446 frente a la V00435.

## Cómo se midió (esta vez en navegador)
La medición de la V00446 (`npm run medir:render`) contaba repintados en jsdom: no veía el arranque, la red ni el CSS.
Para esta versión se compiló la app REAL (V00435, V00446 y V00447) con Firebase simulado y se abrió en Chromium:
latencia de red, costo del SDK por documento en el hilo principal, caché IndexedDB con datos de la sesión anterior y
token de reanudación de 30 min, con los mismos datos para las tres (operaciones 25 mil, facturas 9 mil, empresas 2 mil,
convenios detalle 4.5 mil…). Escenario: recargar la app más de 30 min después (lo que pasa con cada versión nueva).
Los milisegundos dependen de esos supuestos; las consultas en fila y los documentos descargados no.

| Paso (build de producción) | V00435 | V00446 | V00447 |
|---|---|---|---|
| Menú visible al recargar | 595 ms | 802 ms | **198 ms** |
| Operaciones Activas con filas | 1,475 ms | 1,624 ms | **1,186 ms** |
| Abrir Servicios Completados | 2,867 ms | 966 ms | **457 ms** |
| Abrir Empresas | 3,141 ms | 1,102 ms | **858 ms** |
| Nueva operación (visible) | 1,979 ms | 780 ms | **32 ms** |
| Abrir Facturación Clientes | 8,706 ms | 8,739 ms | 8,714 ms (sin cambio, ver abajo) |
| Buscar un mes en Completados | ~400 ms | ~400 ms | ~430–510 ms |

En modo desarrollo (`npm run dev`, React monta los efectos dos veces) Facturación bajaba 40 mil operaciones y 18 mil
facturas (V00435: 50 mil documentos; V00446: 60 mil); ahora 29 mil.

## 1. CSS — pantallas desacomodadas (existía también en la V00435)
Las clases generadas (`sc-x12`, `ed-x3`…) se nombraron con las iniciales del archivo y 7 grupos de archivos compartían
prefijo con reglas DISTINTAS. El CSS de un módulo se queda cargado al navegar, así que abrir uno desacomodaba al otro
hasta recargar. Es la captura del panel de Filtros de Completados ("Filtros" centrado, "Requiere Fecha Inicio y Fecha
Fin." sobre el buscador, letras grandes): son reglas de Cancelados. Reproducido igual en la V00435.

| Archivo | Antes | Ahora | Chocaba con |
|---|---|---|---|
| ServiciosCancelados | `sc-x` | `scc-x` | Servicios Completados |
| EmpleadosDashboard | `ed-x` | `emd-x` | Empresas |
| CombustibleDashboard / ContactosDashboard | `cd-x` | `cbd-x` / `ctd-x` | Catálogos |
| RolesDashboard / RemolquesDashboard | `rd-x` | `rld-x` / `rmd-x` | Reportes |
| DeduccionesDashboard | `dd-x` | `ded-x` | Direcciones |
| UsuariosDashboard | `ud-x` | `usd-x` | Unidades |
| FormularioContacto | `fc-x` | `fct-x` | Formulario de Combustible |

`scripts/verificar-css.mjs` (parte de `npm run verificar`) falla si una clase `xx-xN` se define en dos archivos.
Comprobado con capturas: cada módulo se ve igual que en la V00435 abierto solo, también después de abrir su pareja.

## 2. Arranque — 4 a 5 consultas en fila antes de mostrar datos
La V00437 abría la app hasta: leer `usuarios/{uid}` del servidor → dos consultas de roles (una tras otra) para la red
de la oficina → recién entonces empezaba a leer las banderas → Operaciones esperaba las banderas para pedir la lista.
- Las banderas empiezan al iniciar sesión.
- El perfil se toma de la caché local; el listener del perfil propio lo confirma con el servidor y cierra la sesión si
  el usuario fue desactivado o borrado (igual que antes).
- La red de la oficina: si la caché sabe que NINGÚN rol del usuario la exige, se revisa en segundo plano (si el servidor
  dice lo contrario, se cierra la sesión). Si algún rol la exige, o la caché no conoce los roles (primera vez en ese
  navegador), se espera como antes. Las dos consultas de roles van en paralelo.

## 3. Caché
- **Todas las pestañas con caché** (`persistentMultipleTabManager`): antes la segunda pestaña y "Ver en nueva pestaña"
  iban siempre al servidor y bajaban todos los catálogos. Ese manager coordina por localStorage y con la cuota llena el
  SDK se congela (V00109): `almacenSesion` ya no copia a localStorage valores de más de 200 mil caracteres ni pasa de
  2 millones en total (lo grande queda en memoria), y el guardián al arrancar sigue.
- El guardián ya no borra los filtros guardados, las columnas ni la selección de Excel de Completados (solo las copias
  de datos `rango_`/`all_`).
- **Sin índices automáticos de la caché local** (V00446): no se midieron y el SDK los rellena en segundo plano ocupando
  su cola de trabajo.
- **Escucha de módulos ocultos 10 → 30 min**, y Operaciones Activas (módulo de inicio, tarjetas de casetas y diésel)
  no cierra sus listeners al ocultarse, como antes de la V00438.

## 4. Formulario de operación
- Operaciones Activas abre en segundo plano los catálogos del formulario 3 s después de pintar la lista, de uno en uno
  y con el navegador libre (`precalentarCatalogosFormulario`). Son las mismas lecturas que abrir el formulario una vez
  en la sesión; la V00435 releía ~11 mil documentos en CADA apertura. Costo: mientras llegan los catálogos grandes el
  navegador puede ocuparse hasta ~0.4 s por catálogo.
- Abrir una operación desde Facturación o Pagos (`EditorOperacionEmbebido`) ya no descarga 17 catálogos con `getDocs`
  (~14 mil documentos cada 5 min, y esperaba a todos). Se borró `services/catalogosOperacion.ts`.

## 5. Facturación y Operaciones
- Candado de "descarga en curso" en las operaciones facturables, las facturas y el cruce de facturas de clientes
  (Proveedores), y en la primera carga de Operaciones Activas: ya no se descarga todo dos veces si el efecto corre otra
  vez antes de terminar (siempre en desarrollo; en producción al cambiar de pestaña durante la carga).
- `useMapaEstable` (`src/shared/hooks`): el mapa id → nombre de Facturación conserva su identidad mientras su contenido
  no cambie; un cambio de catálogo que no toca nombres ya no reordena ni refiltra todas las operaciones y facturas.
- **Lo que sigue pesando**: Facturación descarga al abrir hasta 20 mil operaciones y todas las facturas, igual que la
  V00435. Se reduce al encender `consultasCanonicas` (requiere la migración P2 de la Fase 4).

## Verificación
- `tsc -b` ✔ · trinquete ESLint ✔ (4 archivos mejoraron) · consultas ✔ · CSS ✔ · vitest 23 archivos ✔ (nuevas: precalentado
  de catálogos, `siempreEscuchando`, `useMapaEstable`) · prueba de humo de 31 módulos ✔ · `npm run build` ✔.
- Probado en Chromium con Firebase simulado (tabla de arriba y capturas de los 7 pares de módulos).
- **No probado aquí**: Firebase real. En particular el cambio a varias pestañas (`persistentMultipleTabManager`): abrir
  la app en dos pestañas, trabajar en ambas y recargar una. Si apareciera "Cargando Roelca Inc..." congelado, volver a
  `persistentSingleTabManager` en `src/config/firebase.ts` (una línea) y avisar.
- Para comparar con datos reales: compilar y servir (`npm run build && npm run preview`), no `npm run dev`: en
  desarrollo React hace todo dos veces y la app se siente más lenta que en producción.
