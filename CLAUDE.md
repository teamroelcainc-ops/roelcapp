# CLAUDE.md

Reglas para Claude Code en este repositorio (React + TypeScript + Vite + Firebase). Objetivo: código fácil de mantener, carga rápida y el menor número posible de lecturas y escrituras en Firebase. Las reglas de la sección final "Específico de este proyecto" tienen prioridad sobre las generales.

## Forma de trabajar

- Cambios pequeños y verificables, un área a la vez. Un refactor no cambia lo que el usuario ve ni lo que la app hace.
- Pregunta antes de: instalar o quitar dependencias, cambiar Security Rules o índices, desplegar, mover carpetas en bloque o fusionar dos funcionalidades que ambas funcionan.
- Registra en `code-notes.md` las decisiones no obvias y lo que quede pendiente. Es muy grande (más de 200 KB): **nunca lo leas completo**. Para agregar, lee solo las últimas ~30 líneas y escribe al final; para buscar una decisión, usa `grep` con una palabra clave.
- Si existe `refactor-progress.md`, léelo antes de tocar un módulo: dice qué módulos ya están refactorizados y qué quedó pendiente.

## Estructura

Organiza por dominio (feature), no por tipo de archivo:

```
src/
  app/                 App.tsx, router, providers globales
  features/<dominio>/  components/ (X.tsx + X.css), hooks/, services/, types.ts
  shared/              components/, hooks/, utils/ reutilizables entre dominios
  lib/firebase.ts      única inicialización de Firebase
  types/               tipos compartidos (única fuente)
```

En un proyecto existente no reorganices todo de golpe: aplica esta estructura al código nuevo y mueve archivos cuando ya los estés tocando.

## Componentes

- Componentes funcionales con **función flecha**. La interfaz de props se llama `<Nombre>Props` y va justo arriba del componente, en el mismo archivo. Sin `React.FC` ni clases (excepción: un Error Boundary).
  ```tsx
  interface ChipStatusProps {
    texto: string;
    color: string;
  }

  const ChipStatus = ({ texto, color }: ChipStatusProps) => { … };

  export default ChipStatus;
  ```
  Los componentes que todavía usan `function` se convierten cuando se refactoriza su módulo, no en un commit masivo aparte.
- Una responsabilidad por componente. Si pasa de ~150 líneas o mezcla varias tareas (datos + formulario + tabla), divídelo en subcomponentes, un custom hook o un util.
- **Todo lo que se repite se vuelve reutilizable.** El mismo bloque de UI en 2 o más lugares es un componente; la misma lógica con estado o efectos es un hook; sin estado es un util. Si lo usan varios dominios va en `src/shared/`; si lo usa uno, en `features/<dominio>/`.
  - Antes de crear, busca si ya existe (`src/shared/`, `src/shared/dominio/`, `src/utils/` y `grep`). Si hay dos versiones parecidas, unifícalas en una y compara su comportamiento punto por punto (ver "Código limpio").
  - Límite: si unificar dos bloques exige más de 2 props booleanas que cambian el comportamiento, usa composición (`children`, props que reciben elementos) o déjalos separados y anótalo en `code-notes.md`. Un componente reutilizable no es uno con un `if` por cada pantalla.
  - Los pares de módulos casi iguales (Facturación, Tarifarios y Convenios de Clientes/Proveedores; Completados/Cancelados) se unen con una prop `lado` y espacios para lo propio de cada lado, no copiando el archivo.
- Una función que devuelve JSX (`chipStatusFactura()`, `BuscadorCliente()`) es un componente: se declara como tal y se usa como `<ChipStatusFactura />`.
- Un tablero se lee como composición: arma la pantalla, conecta datos y pasa handlers. Las tablas, filas, filtros, fichas y modales viven en componentes con nombre, aunque solo los use esa pantalla.
- El JSX solo describe la UI:
  - Un evento que hace más que una llamada va en una función con nombre declarada en el componente; las flechas en línea solo para una llamada simple (`onClick={() => setAbierto(true)}`).
  - Filtros, ordenamientos, formatos y condiciones largas se calculan en constantes con nombre antes del `return`.
  - Nada de ternarios anidados en el JSX: usa una constante, un return temprano o un subcomponente.
- Evita el prop drilling con composición (`children`, props que reciben elementos) antes de crear un Context; Context antes que una librería de estado global.
- Íconos desde la librería del proyecto (p. ej. `lucide-react`), no SVG a mano salvo que el ícono no exista.
- JSX semántico: listas de `.map()` en `<ul>/<li>`; pares etiqueta/valor en `<dl>/<dt>/<dd>`; acciones en `<button>`, nunca `<div onClick>`.
- `key` estable tomada del dato (`id`, `url`); el índice solo si la lista es estática y no tiene identificador.
- Los handlers que actúan sobre un ítem lo reciben como parámetro (`onClick={() => remove(item)}`), no leen un "ítem seleccionado" del estado que pudo cambiar antes de confirmar.

## Nombres

El código está en **español** y en camelCase. Los nombres de colecciones y campos de Firestore no se renombran: los comparten las Cloud Functions y Roelca Móvil.

- **Variables:** un sustantivo que dice qué contienen (`facturasPendientes`, no `data`, `lista`, `aux`, `res`, `temp`). Los arreglos van en plural y los mapas por id terminan en `PorId` (`empresasPorId`).
- **Funciones:** verbo + objeto (`calcularSaldoFactura`, `formatearMoneda`, `leerOperacionParaEditar`).
- **Booleanos:** empiezan con `es`, `esta`, `tiene`, `puede` o `debe` (`esUSD`, `estaGuardando`, `tieneSaldo`, `puedeEditar`).
- **Handlers:** se nombran por lo que hacen, no por el evento (`guardarFactura`, `abrirFicha`; no `handleClick`). La prop que los recibe es `on` + verbo en español (`onGuardar`, `onCerrar`).
- **Otros:** hooks `use<Qué>`; componentes en PascalCase por lo que muestran; constantes fijas de módulo en UPPER_SNAKE_CASE (`ID_USD`).
- **Abreviaturas:** solo las del negocio (RFC, TC, CONV, TARI, TARP, ref). Nombres de una letra solo como índice de un bucle corto.

```ts
// Mal
const normSC = (s: string) => …;
const fv = facturas.find(…);
const nEmp = empresa?.moneda;

// Bien
const normalizarTexto = (texto: string) => …;
const facturaViendo = facturas.find(…);
const monedaEmpresa = empresa?.moneda;
```

## JavaScript moderno (ES2017 o posterior)

El proyecto compila con `target: ES2022`, así que todo esto es válido y es lo que se escribe:

- `async`/`await` con `try/catch` en vez de cadenas `.then().catch()`. La función de un `useEffect` no puede ser `async` (debe devolver el cleanup): declara una función async adentro y llámala.
- `const`/`let`, nunca `var`. Spread `{ ...objeto, campo }` en vez de `Object.assign`.
- `Object.entries`/`Object.values` para recorrer objetos, en vez de `Object.keys` + `objeto[clave]`.
- `array.includes(x)` en vez de `indexOf(x) !== -1`.
- `a?.b` en vez de cadenas de `&&`. `??` en vez de `||` **solo** cuando `0`, `''` o `false` son valores válidos que no deben reemplazarse: `||` también reemplaza esos valores. No hagas reemplazos masivos de `||` por `??`.

## Estado y efectos

- Estado lo más cerca posible de donde se usa; súbelo solo cuando dos componentes lo necesitan.
- Lo que se puede calcular desde props o estado se calcula en el render; no lo guardes en otro `useState` sincronizado con `useEffect`.
- **Nunca mutes el estado:** `lista[i].visible = !lista[i].visible` cambia el objeto que React ya tiene. Crea uno nuevo: `lista.map((columna) => (columna.id === id ? { ...columna, visible: !columna.visible } : columna))`.
- `useEffect` solo para sincronizar con algo externo (listeners de Firestore, DOM, timers), siempre con cleanup. La lógica que responde a una acción del usuario va en el handler, no en un efecto.
- Cada `useEffect` sincroniza UNA cosa. Si hace dos (un timer y un listener del teclado), se divide en dos efectos, cada uno con su cleanup.
- Un efecto que actualiza estado compara antes y devuelve el valor anterior si no cambió nada (`setFormData((prev) => (igual ? prev : nuevo))`). Así no dispara una cascada de redibujos.
- React 19:
  - `<Contexto value={…}>` en vez de `<Contexto.Provider>`.
  - `ref` llega como prop normal, sin `forwardRef`.
  - `useDeferredValue` o `useTransition` para filtros y búsquedas sobre listas grandes, para que escribir no se trabe.
- Lógica con estado o efectos que se repite → custom hook (`useAlgo`) dentro del dominio o en `shared/hooks`.
- Contexts pequeños por dominio; no pongas en un Context valores que cambian a cada tecla.
- Memoización: si el proyecto tiene React Compiler activo, no agregues `useMemo`/`useCallback`/`memo` manuales. Si no lo tiene, úsalos solo ante un problema medido (React DevTools Profiler) o para estabilizar dependencias de un efecto o props de un hijo memoizado.

## TypeScript

- `strict` activo. Nada de `any` en estado, props o parámetros; usa `unknown` y reduce el tipo.
- Tipa cada colección de Firestore una sola vez, en su service, con `withConverter<T>()` (o un cast en el punto de lectura si no hay converter). El resto del código recibe `T` sin casts.
- Una sola fuente de tipos compartidos (`src/types`). Si un archivo necesita campos extra, evalúa si pertenecen al tipo canónico; si son locales, usa un tipo extendido con nombre y un comentario que explique por qué.
- Todo `as any` que sobreviva lleva un comentario con la razón. Excepción aceptable: datos genuinamente dinámicos (p. ej. un formulario cuya estructura depende de configuración) como `Record<string, unknown>`, documentado donde ocurre.
- `import type` para imports que solo son tipos.
- `satisfies` para comprobar un objeto de configuración sin perder su tipo literal, y `as const` para listas fijas de claves.

## Firebase — acceso a datos

### Inicialización
- Una sola inicialización en `src/lib/firebase.ts`, SDK modular (`firebase/firestore`, nunca `firebase/compat`), configuración desde `import.meta.env.VITE_FIREBASE_*`.
- Los componentes no llaman a Firestore directamente: usan los hooks o services de su dominio.

### Lecturas (cada documento devuelto se cobra)
- Filtra, ordena y limita en el servidor (`where`, `orderBy`, `limit`). Nunca descargues una colección entera para filtrarla o contarla en el cliente.
- Paginación con cursores (`startAfter`), no con `offset`: los documentos saltados también se cobran.
- Conteos y sumas con `getCountFromServer` / `getAggregateFromServer`.
- Sin lecturas N+1 dentro de loops: agrupa ids con `where(documentId(), 'in', ids)` en tandas de 30.
- Documentos pequeños: imágenes y archivos van a Storage (en Firestore se guarda la URL, nunca base64); los campos pesados que se leen poco van a una subcolección o a un documento aparte.
- Las Security Rules que usan `get()`/`exists()` suman lecturas en cada petición; tenlo en cuenta al diseñarlas.

### Tiempo real
- `onSnapshot` solo para datos que cambian mientras el usuario mira la pantalla. Catálogos y configuración que casi no cambian → lectura única + caché (ver "Caché").
- Cada `onSnapshot` devuelve su `unsubscribe` en el cleanup del efecto.
- Un solo listener por consulta compartida, en un provider o hook de nivel superior que entrega los datos a las vistas. Antes de crear un listener o un `getDocs`, revisa si esos datos ya llegan por props o context: un fetch propio de una colección que ya se escucha congela los datos en el momento de la carga y duplica lecturas.
- El listener usa la consulta más acotada posible (`where`, `limit`), no la colección completa.

### Cambios al momento en todas las vistas
- Un modal o ficha abierta guarda el **id** del registro, no una copia. En cada render toma la versión vigente del listener, o escucha ese documento. Una copia en `useState` se queda congelada en el momento de abrir.
- Quien escribe un dato que otra vista lee una sola vez invalida esa lectura en el mismo handler: `invalidateQueries` o borrar la clave de su caché.
- Un dato copiado en varios documentos (nombres, folios, montos) se actualiza en todas sus copias en el mismo batch, transacción o trigger. Nunca se deja para un botón de "reparar".
- Después de guardar no se parchea la lista con una copia local. El listener refleja la escritura local al instante, y un parche con la lista del render pisa datos más nuevos.

### Formularios de edición: abren al instante
- Arrancan con los datos del registro desde el primer render: `useState(() => estadoInicialDesde(registro))`, y quien los abre los monta con `key` igual al id del registro. Nunca se dibujan vacíos para llenarse después en un `useEffect`.
- Si ya reciben el registro, no hacen `getDoc` antes de pintar. Si hace falta la versión del servidor, la releen en segundo plano.
- No bloquean todo el formulario esperando catálogos. Solo la sección que los necesita muestra su indicador de carga, y un select muestra el nombre guardado (`*Nombre`) mientras llega su catálogo.
- La vista que abre el formulario precalienta sus catálogos al montarse, y precarga el código del formulario con `import()` cuando el usuario pasa el mouse o enfoca el botón de editar.
- Las lecturas independientes van en paralelo con `Promise.all`, nunca un `await` tras otro.

### Escrituras
- `updateDoc` solo con los campos que cambian; no reescribas el documento completo con `setDoc`.
- `serverTimestamp()`, `increment()`, `arrayUnion()`/`arrayRemove()` en vez de leer-modificar-escribir.
- Varias escrituras relacionadas → `writeBatch`; las que dependen del valor actual (contadores, consecutivos) → `runTransaction`.
- No escribas en cada tecla: guarda al confirmar o con debounce.
- Toda escritura en `try/catch` con feedback visible para el usuario.

### Seguridad
- La configuración de Firebase del cliente no es secreta; la protección real son las Security Rules. No confíes en validaciones que solo existen en el cliente.
- Nunca subas al repo archivos `.env` con secretos ni llaves de cuentas de servicio.
- Todo texto libre interpolado en HTML crudo (`dangerouslySetInnerHTML`, `window.open()` + `document.write()`, cuerpos de email) pasa por `escapeHtml()`. No hace falta en el `src` de `<img>` con URLs de Storage o base64.

## Caché

Usa el nivel más simple que resuelva el problema. No apiles varias capas de caché sobre el mismo dato sin una razón: cada capa extra es otro lugar que hay que invalidar.

### 1. Caché persistente de Firestore (base)

```ts
// src/lib/firebase.ts
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';

export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
```

- Guarda en IndexedDB: los datos aparecen al instante al recargar y la app funciona offline. Un listener que se reconecta antes de 30 minutos solo cobra los cambios; después de 30 minutos (o sin persistencia) se cobra como una consulta nueva.
- `initializeFirestore` se llama una sola vez y antes de cualquier `getFirestore`.
- Este caché no se borra entre sesiones. Si la app maneja datos sensibles en equipos compartidos, al cerrar sesión ejecuta `terminate(db)`, luego `clearIndexedDbPersistence(db)`, y recarga.

### 2. Listeners compartidos (datos en vivo)
Ver "Tiempo real": un listener por consulta, compartido por todas las vistas.

### 3. Caché en memoria con TTL (lecturas únicas)
Para `getDocs`/`getDoc` de datos que cambian poco, evita repetir la lectura al navegar entre vistas. Se guarda la promesa para que dos componentes que piden lo mismo a la vez compartan una sola petición:

```ts
// src/shared/utils/memoryCache.ts
const store = new Map<string, { expires: number; value: Promise<unknown> }>();

export function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as Promise<T>;
  const value = load().catch((err: unknown) => {
    store.delete(key); // los errores no se cachean
    throw err;
  });
  store.set(key, { expires: Date.now() + ttlMs, value });
  return value;
}

export function invalidate(prefix: string): void {
  for (const key of store.keys()) if (key.startsWith(prefix)) store.delete(key);
}
```

- El service que escribe en una colección invalida su prefijo (`invalidate('services:')`) después de la escritura.
- Si el proyecto ya usa TanStack Query, úsalo en su lugar (`staleTime`, `invalidateQueries`); no lo instales sin preguntar.

### 4. localStorage
- Solo datos pequeños, no sensibles y que cambian poco (preferencias de UI, configuración). Clave versionada (`app:v2:settings`) con fecha de expiración; lectura y escritura dentro de `try/catch`.
- Nunca datos personales de clientes ni tokens. Si la caché persistente de Firestore está activa, no copies datos de Firestore a localStorage.

### 5. Archivos estáticos y Storage
- Vite genera `assets/*` con hash en el nombre: caché inmutable de un año. `index.html` no debe tener caché larga, para que cada deploy llegue de inmediato. En Cloudflare Pages/Workers, `public/_headers`:
  ```
  /assets/*
    Cache-Control: public, max-age=31536000, immutable
  ```
  En Firebase Hosting, lo equivalente va en `headers` de `firebase.json`.
- Al subir a Storage, incluye `cacheControl: 'public, max-age=31536000'` en la metadata; si el archivo cambia, súbelo con un nombre nuevo en vez de sobrescribirlo.
- Redimensiona y comprime las imágenes en el cliente antes de subirlas. En `<img>`: `loading="lazy"`, `width` y `height`.

## Velocidad de carga

- Rutas, vistas y modales pesados con `React.lazy` + `Suspense`. Un formulario o modal grande que se abre desde un tablero también va con `lazy()`, y se precarga en segundo plano después de pintar para que abra al instante.
- Librerías pesadas (`xlsx`, `exceljs`, `html2pdf.js`, `pdfjs-dist`, `jszip`, mapas, gráficas) **nunca** con import estático en un componente o service que se carga con una pantalla. Siempre `import()` dentro del handler que exporta o genera, a través de un solo helper por tipo de archivo. Un import estático en cualquier archivo mete la librería entera en el chunk de esa pantalla.
- Nada de imágenes en base64 dentro del código. Van como archivo en `public/` (o importadas como asset); si un PDF necesita la imagen como dataURL, se convierte al generar el PDF.
- No metas al precache del Service Worker (`globPatterns` de `vite.config.ts`) archivos que solo se usan al presionar un botón. Las librerías al usar están en `LIBRERIAS_AL_USAR` (fuera del precache) y se sirven con CacheFirst al usarse (V00534): generar un PDF o un Excel sin conexión requiere haberlo hecho antes con conexión.
- Importa Firebase por submódulo; `firebase/storage`, `firebase/functions`, etc. solo en los módulos que los usan.
- Búsquedas y filtros que consultan datos, con debounce (~300 ms). Listas de cientos de filas: paginación o virtualización.
- Compara el tamaño de los chunks de `npx vite build` antes y después de cualquier cambio que afecte la carga, por pantalla: el chunk de la pantalla más todo lo que importa de forma estática. `node scripts/medir-pantallas.mjs --json medida.json` lo calcula; `--comparar anterior.json` muestra la diferencia (V00534).

## Estilos (CSS)

Ningún CSS dentro del código React/TypeScript. Los estilos viven en un archivo hermano (`Componente.tsx` → `Componente.css`, importado una sola vez con `import './Componente.css'`) o en el CSS global (`App.css`/`index.css`).

- Prohibido: `style={{...}}` con valores fijos, objetos de estilo en JS (`const s = {...}`), `<style>` embebido en JSX y hover simulado con `onMouseEnter`/`onMouseLeave`.
- Estados finitos (activo, seleccionado, variantes) → clase con modificador: ``className={`chip${active ? ' active' : ''}`}`` y `.chip.active {...}` en el CSS.
- Botones deshabilitados: atributo `disabled` + `.btn:disabled {...}`, sin calcular opacidad ni cursor a mano.
- `:hover` en CSS. Si un elemento `.active` también debe cambiar al pasar el mouse, declara `:hover` después de `.active`.
- Valores que solo existen en runtime (un color que viene de Firestore, un ancho calculado, la posición de un menú flotante) → variable CSS (`import type { CSSProperties } from 'react'`):
  ```tsx
  <span className="status-dot" style={{ '--dot-color': status.color } as CSSProperties} />
  ```
  ```css
  .status-dot { background: var(--dot-color); }
  ```
- Antes de crear una clase, busca si ya existe una global. Si necesitas algo parecido pero distinto a propósito, crea un modificador o una clase con otro nombre y deja una nota de por qué.
- Si el proyecto usa de forma consistente CSS Modules o Tailwind, respeta esa convención; no lo migres sin preguntar.

## Código limpio

- Antes de escribir un helper, busca en `src/shared/dominio`, `src/shared/utils` y `src/utils` si ya existe.
- Formatos y cálculos (fechas, texto, números, dinero) nunca se escriben dentro de un componente: van en `src/shared/dominio` (lógica pura compartida con el servidor) o en `src/shared/utils`. Lista de los que ya existen en "Formatos y utilidades" (sección del proyecto).
- Si unificas dos versiones de la misma lógica, compara su comportamiento punto por punto (mayúsculas, eventos, debounce) y quédate con lo más robusto de cada una; anótalo en `code-notes.md`.
- Elimina: imports, variables, funciones, exports y archivos sin uso; código comentado; `console.log` de depuración (los `console.error` dentro de un `catch` se quedan); dependencias que ya no se importan.
- Código que parece inalcanzable: confírmalo con `grep` (¿alguien abre ese modal, llama esa función, importa ese archivo?). Si nadie lo usa, elimínalo. Si se usa por un flujo no obvio, entiéndelo antes de tocarlo.
- Dos implementaciones de la misma funcionalidad que ambas funcionan son una decisión de producto: anótalo en `code-notes.md` y pregunta cuál se queda.
- `npx knip` ayuda a detectar archivos, exports y dependencias sin uso; confirma cada caso antes de borrar.

## Pruebas

- Vitest + React Testing Library (encajan con Vite). Si no están instalados, propónlo antes de instalarlos.
- Prueba la lógica pura (utils, hooks, services) y los componentes por lo que el usuario ve y hace, no por detalles internos.
- Services y Security Rules se prueban contra el Firebase Emulator Suite, nunca contra producción.

## Verificación al terminar cada archivo o lote

1. `grep -c "style={{" archivo.tsx` → solo quedan variables CSS justificadas.
2. `npx tsc --noEmit -p tsconfig.app.json` (o `npx tsc -b`, según el proyecto) → sin errores nuevos en todo el proyecto.
3. `npx eslint archivo.tsx` comparado con el estado anterior (`git stash` / `git stash pop`) → ningún problema nuevo.
4. `npm run build` termina bien; si el cambio afecta la carga, compara el tamaño de los chunks.
5. Si cambiaste lógica de runtime (listeners, caché, mapas, APIs externas), di explícitamente qué no pudiste probar en el navegador: tsc, eslint y build verifican que compila, no que funciona.


## Específico de este proyecto (Roelca)

Utilidades existentes, listeners globales, excepciones documentadas y decisiones propias de este repo. Tienen prioridad sobre las reglas generales. Historial completo de decisiones en `code-notes.md`; el plan de refactorización por fases y sus puntos de parada en `PLAN-REFACTOR.md`.

### Qué es
- Sistema de operaciones logísticas de Roelca Inc (cruces, transfer, fletes, rentas): operaciones, facturación de clientes y proveedores, pagos, nómina, diésel, puentes, tarifarios y convenios. Firestore se usa como base relacional; el "motor relacional" son las Cloud Functions de `functions/src/relacional.ts`.
- Comparte el proyecto de Firebase (`roelcaapp`) con la app móvil **Roelca Móvil** (repo aparte, Expo). Su contrato no se rompe: el operador lee `operaciones` donde `operador == colaboradorId`, escribe en `horarios` y `status`/`statusNombre` de SUS operaciones; el GPS escribe solo en `rastreo_operaciones/{opId}` (+ `puntos`); el cliente lee todo por la callable `portalCliente`.

### Estructura actual
- Ya está organizado por dominio en `src/features/<dominio>/` (components con su `.css` hermano, services). Quedan carpetas por tipo heredadas (`src/components`, `src/utils`, `src/hooks`); se mueve un archivo solo cuando se toca.
- Firebase se inicializa en `src/config/firebase.ts` (equivale a `lib/firebase.ts`). `src/firebase/config.ts` es un segundo `initializeApp` muerto: no lo importes.
- Código nuevo compartido:
  - `src/shared/dominio/` → lógica PURA compartida con las Cloud Functions (constantes, moneda, fechas, números, dinero, operación canónica). Sin imports de Firebase ni React. `functions/src/dominio/` es una COPIA generada (`node scripts/sincronizar-dominio.mjs`, corre sola en el build de functions); nunca edites la copia. Dentro de esa carpeta los imports relativos llevan `.js` (`./constantes.js`), porque functions compila con NodeNext.
  - `src/shared/data/` → capa de datos de la web (catálogos, listeners compartidos, banderas, convertidores, medidor de lecturas).
  - `src/types/` → tipos compartidos; los documentos de Firestore en `src/types/firestore.ts`.

### Datos, listeners y caché
- **`MantenerVivo`** (`src/utils/mantenerVivo.tsx`): 12 módulos pesados no se desmontan al navegar; se ocultan. Un listener propio de un módulo vivo se condiciona con `useModuloEscuchando()` (o usa `useSnapshotSoloVisible`): sigue abierto 30 min después de ocultar el módulo y luego se cierra (`siempreEscuchando` en el módulo de inicio, Operaciones Activas, no lo cierra nunca). `useModuloVivoActivo()` es solo para "¿es el módulo que se ve?" (buscador global, avisos). Antes de entregar un cambio de carga de datos: `npm run medir:render` (repintados por acción) contra la versión anterior.
- **Catálogos → `useCatalogo(nombre)`** de `src/shared/data/catalogos.ts`. No hagas `getDocs`/`onSnapshot` propios de un catálogo ni lo copies a localStorage. La lista de catálogos y su campo de nombre está en `CATALOGOS` de ese archivo; uno nuevo se agrega ahí. Después de escribir en un catálogo no parches una copia local. Los catálogos quedan abiertos toda la sesión y sus avisos a React van agrupados (V00446). Los del formulario de operación están en `features/operaciones/services/catalogosFormulario.ts` y Operaciones Activas los abre en segundo plano al arrancar (`precalentarCatalogos`); el formulario abierto desde otro módulo (`EditorOperacionEmbebido`) no descarga catálogos propios. Fuera de React: `obtenerCatalogo(col)` devuelve en cuanto hay datos; `obtenerCatalogo(col, { fresco: true })` espera al servidor y es solo para servicios que ESCRIBEN decidiendo con el catálogo. Desde la V00448 **rechaza** si el listener falla o no llegó ningún dato a tiempo (antes devolvía `[]`): quien escribe lo deja fallar (try/catch con aviso); un documento usa `leerParaDocumento` (`src/utils/direccionPdf.ts`); solo lo que únicamente MUESTRA puede caer a una lista vacía con `.catch`.
- **Datos en vivo compartidos → `useColeccionViva(clave, consulta)`** de `src/shared/data/coleccionesVivas.ts`: un `onSnapshot` por clave para toda la app. Si la vista decide con datos "al día" (habilitar un Guardar de dinero), pasa `{ avisarConfirmacion: true }` y usa `delServidor`; `reintentarVivo(clave)` reabre un listener que falló (V00452). Una lista grande que un modal necesita (p. ej. las facturas de Pagos) va en vivo y se precarga, no se descarga en cada apertura.
- **Lecturas únicas** (conteos, páginas, reportes) → TanStack Query (`src/lib/queryClient.ts`); invalida con `queryClient.invalidateQueries` después de escribir.
- La caché persistente de Firestore (IndexedDB, `persistentMultipleTabManager` desde la V00447: todas las pestañas) es la ÚNICA caché en disco. Ese manager coordina las pestañas por localStorage y con la cuota llena se congela: nada grande a localStorage (`almacenSesion` tiene tope). No guardes operaciones, facturas ni catálogos en localStorage/sessionStorage (`cat_v1__`, `cat_v2__`, `roelca_catalogos_v2`, `almacenSesion` son legado y se están retirando).
- **Banderas (`configuracion/flags`)** → `useFlags()` / `obtenerFlags()` de `src/shared/data/flags.ts`. Todo cambio que depende de algo desplegado en el servidor (callables nuevas, campos migrados) va detrás de una bandera que por defecto está apagada, con el camino viejo intacto. La tabla de banderas y cuándo encender cada una está en `PLAN-REFACTOR.md`.
- **Fechas**: se guardan `AAAA-MM-DD`. Para consultar por rango usa `fechaServicioISO` (canónico); `fechaServicio` tiene formatos mezclados (ISO, Timestamp, d/m/aaaa de AppSheet). Convierte con `aFechaISO()` de `src/shared/dominio/fechas.ts`. "Hoy" se calcula con `src/utils/fechaHoraLocal.ts` (hora local), nunca con `toISOString()`.
- **Monedas**: `monedaCanonica()`/`esUSD()` de `src/shared/dominio/moneda.ts` aceptan ID del catálogo, código o nombre. Nunca compares contra `'USD'` o contra el ID a mano. IDs en `src/shared/dominio/constantes.ts` (`ID_USD`, `ID_MXN`, `STATUS_COMPLETADOS`, `STATUS_CANCELADO`, `TIPO_EMPRESA`).
- **Dinero**: montos a 2 decimales, tipo de cambio hasta 4 (regla V00274). Sumas en centavos (`sumarMontos`). La regla de conversión (convenio USD + factura MXN → × TC; MXN + USD → ÷ TC; misma moneda → igual) vive en `src/shared/dominio/dinero.ts` y es la MISMA en web y servidor.
- **Relaciones**: guarda siempre el ID (`clientePaga`, `proveedorUnidad`, `convenio`, `status`, `unidad`…) y su copia `*Nombre` para pintar tablas. Nunca busques por nombre. Las copias `*Nombre` las mantiene el servidor (triggers de `relacional.ts`); no agregues botones de "reparar nombres".
- **Escrituras de dinero** (aplicar pagos, facturar, nómina): transacción (`runTransaction`) o callable. Nunca leer-modificar-escribir con datos de una lista ya cargada.
- **Operaciones entre módulos (`src/utils/operacionesBus.ts`)**: mientras las listas de operaciones lean una sola vez, toda escritura de la web en `operaciones` avisa con `notificarOperacionGuardada(id, datosCompletos, origen, camposCambiados)`. Eso incluye las respuestas de las callables de dinero, el costo adicional, la confirmación de tarifa y "Rectificar". Quien escucha aplica todos los campos del aviso, sin quedarse con un subconjunto. El bus solo llega a la pestaña actual: lo que cambia otra pestaña, otro usuario, Roelca Móvil o un trigger solo se ve con un listener.

### Formatos y utilidades (úsalas; no escribas otra copia)
- **Fechas** (`src/shared/dominio/fechas.ts`): `aFechaISO`, `aFechaServicioISO`, `isoADma`, `fechaServicioDeOperacion`. **Hoy** (`src/utils/fechaHoraLocal.ts`): `hoyLocalISO`, `fechaLocalISO`, `ahoraLocalISOCorto`.
  - Nunca `toISOString().slice(0, 10)` ni `.split('T')[0]` para "hoy": es la fecha UTC y después de las 6 p. m. da la de mañana.
  - Nunca `new Date('AAAA-MM-DD')` para mostrar una fecha: la interpreta en UTC y muestra el día anterior.
- **Texto** (`texto.ts`): `normalizarTexto`. No escribas otra copia de `normalize('NFD')`.
- **Números y dinero** (`numeros.ts`): `aNumero` (acepta `"$1,234.50"`), `r2`, `r4`, `aCentavos`/`deCentavos`, `sumarMontos`. Nunca `parseFloat` de un monto (`parseFloat("1,234.50")` da 1), ni `Math.round(x * 100) / 100`, ni sumas de montos en flotante.
- **Monedas** (`moneda.ts`): `monedaCanonica`, `esUSD`, `esMXN`, `nombreMoneda`. **Empresas** (`nombres.ts`): `razonSocialEmpresa`, `nombreMostrarEmpresa`.
- **HTML para PDF** (`src/shared/utils/html.ts`, V00534): `escaparHTML`, `escaparTextos`. `src/utils/pdfGenerator.ts` los reexporta, pero no lo importes desde una pantalla solo para escapar texto: tiene todas las plantillas de PDF.
- **Logo** (`src/shared/utils/logo.ts`, V00534): el logo es un archivo (`public/logo-roelca.png`, y `public/logo-roelca-chico.png` para Excel, Remisión y documentos de proveedor). En pantalla, `RUTA_LOGO_ROELCA`. En un PDF o Excel, `logoComoDataUrl(ruta)` al generar (o `logoListo(ruta)` en una plantilla síncrona). El logo registrado de la empresa: `setLogoPdf`/`getLogoPdf`/`logoPdfPorDefecto`.
- **Librerías pesadas, un cargador por tipo** (V00534): `cargarXlsx`/`cargarExcelJS` (`src/shared/utils/excel.ts`), `cargarHtml2pdf`/`cargarPdfjs` (`src/shared/utils/pdf.ts`), `cargarJSZip` (`src/shared/utils/zip.ts`) y `cargarStorage` (`src/config/firebase.ts`). Se llaman dentro del handler; nunca un import estático de esas librerías.
- **Precarga** (`src/shared/hooks/usePrecargarAlPintar.ts`, V00534): una pantalla que abre un formulario o modal con `lazy()` lo precarga con `usePrecargarAlPintar(precargar…)`. El formulario de operación se usa como `FormularioOperacionDiferido` y se precarga con `precargarFormularioOperacion` (`features/operaciones/services/cargarFormularioOperacion.ts`). Los PDF de una operación salen de `src/utils/pdfOperacionDiferido.ts`.
- Lo que falte se crea en esos archivos la primera vez que se necesite, no dentro del componente: formatear moneda para mostrar, fecha corta en español, capitalizar, descargar un archivo.

### Capas de la refactorización (V00436–V00444): úsalas, no las reimplementes
- **Ids**: `idReal(doc)` (`src/shared/data/coleccionesVivas.ts`) = id REAL del documento (`_docId`, no enumerable; un campo `id` guardado gana en `doc.id`). Para escribir o abrir un documento usa `idReal`/`_docId`, nunca `doc.id` a ciegas. `{...doc}` pierde `_docId`: léelo antes.
- **Consultas acotadas** (`src/shared/data/consultas.ts`): `paginaOperaciones` (estadoGrupo + rango de `fechaServicioISO`, cursor), `paginaPorFacturar`, `paginaOperacionesDeEmpresa` (`empresasIds`), `paginaOperacionesDeConvenio`, `paginaFacturasAbiertas`, `operacionesDelDia`/`operacionesDelRango`, `todasLasPaginas` (tope que se AVISA), `porIds` (lotes de 30 en paralelo), `usosPorTipo`/`usosEnCache` (contadores `usos/`). Detrás de `consultasCanonicas`; sin índice no hay respaldo de "leer todo". Índice nuevo → `firestore.indexes.json`.
- **Hooks de datos**: `useOperacionesActivas` (`features/operaciones/hooks`), `useOperacionesFacturables(lado, …)` (`features/facturacion/hooks`). Selectores puros: `features/facturacion/selectores.ts`, `features/operaciones/services/formatosOperacion.ts` y `auditoriaLog.ts`. Antes de copiar un helper de un tablero a otro, búscalo ahí.
- **Banderas al montar**: un efecto que al montar elige entre el camino viejo y el nuevo espera `useFlagsCargadas()` (o `await obtenerFlags()` en el cargador); `useFlags()` vale "todas apagadas" hasta la primera lectura.
- **Dinero**: regla única en `src/shared/dominio/dinero.ts` (`montoOperacion`, `conversionOperacion`, `totalNativoFactura`, `derivadosFactura`); planes de facturación en `src/shared/dominio/facturacion.ts`. Con `dineroPorServidor` la web llama las callables de `functions/src/dinero.ts` con `llamarDinero()` (`features/facturacion/services/dineroServidor.ts`): `facturarOperaciones`, `editarFactura`, `quitarOperacionFactura`, `moverOperacionFactura`, `agregarOperacionFactura`, `eliminarFactura`, `recalcularFactura`, `registrarPago`, `editarPago`, `eliminarPago`. Otras callables: `crearOperacion`, `renumerarOperacion`, `eliminarConPapelera`, `gestionarUsuario`, `sincronizarClaims`, `verificarIntegridad`, `portalCliente`.
- **Servidor** (`functions/src`): un trigger por escritura de operación (`operacionEscrita`: canónicos, peaje, cascada de montos, contadores `usos/`); todo trigger con `OPCIONES_TRIGGER` (`retry: true`) + `conReintento()` de `eventos.ts`, y RELEE el documento actual (o escribe con precondición/transacción): nunca escribas con la copia del evento. Nombres `*Nombre`: mapa único en `src/shared/dominio/nombres.ts` (propagación con `propagacionEnServidor`).
- **Scripts de puesta al día** (desde `functions/`, simulación por defecto; `-- --aplicar --confirmo-respaldo` es un punto de parada P2/P3): `npm run migrar:v2`, `reconciliar`, `saldos:diesel`, `usos`, `nombres`. Reportes en `functions/reportes/` (fuera de git).
- **Efectos**: si un efecto necesita llamar funciones del componente sin re-ejecutarse por ellas, usa `useEffectEvent` (React 19), no `eslint-disable … exhaustive-deps` (el trinquete cuenta esos comentarios y no deja que suban).

### Seguridad
- Las reglas (`firestore.rules`, `storage.rules`) y los índices (`firestore.indexes.json`) ya están en el repo y declarados en `firebase.json`. **Nunca corras `firebase deploy` sin `--only`**: publicaría reglas e índices. Las funciones se despliegan con `firebase deploy --only functions`. Las reglas se prueban con `npm run test:rules` (emulador) antes de publicarlas.
- Roles efectivos en custom claims (`personal`, `admin`, `cliente`) que pone la callable `asignarAcceso`; las reglas y `exigirPersonal`/`exigirAdmin` (functions/src/acceso.ts) los leen. Un usuario sin documento en `usuarios` NO tiene acceso (nunca "admin por omisión").
- Callables nuevas: validan el payload con zod y llaman `exigirPersonal`/`exigirAdmin` primero. Una callable que da poder sobre cuentas o permisos va detrás de su bandera (`gestionarUsuario` responde "apagada" sin `usuariosPorServidor`, V00448).
- HTML generado para PDF o impresión (innerHTML, `document.write`): todo texto capturado pasa por `escaparHTML`/`escaparTextos` de `src/shared/utils/html.ts` (V00448 · V00534).

### Versiones y entregas (la gerencia sigue el trabajo por versión)
- Cada entrega sube la versión: `npm run version:bump` (actualiza `src/config/version.ts` y `public/version.json`), agrega su entrada al inicio de `CAMBIOS_APP` en `src/config/historialCambios.ts` (resumen en lenguaje cotidiano) y un `CAMBIOS-Vxxxxx.md` con el detalle técnico y los pasos manuales. Los comentarios de código llevan `✅ Vxxxxx` cuando explican un cambio.
- Registrar un módulo nuevo toca: `lazy()`, el tipo de `moduloActivo`, el mapa de permisos, `ICON`, el ítem del sidebar con `puede()`, el render con `MantenerVivo` si es pesado (todo en `App.tsx`), `GRUPOS_MODULOS` de `RolesDashboard.tsx` y `src/components/modulosNavMovil.ts`.

### ESLint, estilos y verificación en este repo
- El repo arrastra ~2,400 problemas de ESLint (2,200 son `any`) y ~1,050 `style={{` heredados (medido en V00533). Regla: **no pueden crecer**. `node scripts/verificar-lint.mjs` (trinquete contra `scripts/lint-baseline.json`) falla si un archivo empeora o sube el total de `any`; cuando un archivo mejora, `--actualizar` baja su línea base. En lugar del paso 1 general, comprueba que `grep -c "style={{"` de cada archivo tocado no suba y que lo nuevo no agregue ninguno.
- `npm run verificar` = `tsc -b` + trinquete de ESLint + trinquete de consultas (`scripts/verificar-consultas.mjs`: ninguna lectura nueva de `operaciones` completa) + clases de CSS repetidas (`scripts/verificar-css.mjs`) + `vitest run`. Las Cloud Functions: `npm --prefix functions run build` y `npm --prefix functions test`.
- **Clases de CSS**: cada `.css` usa su PROPIO prefijo (`scc-x12`, no el de otro archivo): el CSS de un módulo se queda cargado al navegar y dos archivos con la misma clase se desacomodan entre sí según el orden en que se abran (V00447).
- **Esperas**: mientras una lista, tabla o tarjeta espera datos de un filtro, una búsqueda o un listener, se muestra `<CargandoDatos texto="…" />` (`src/shared/components/CargandoDatos.tsx`; `compacto` en espacios chicos, `enLinea` para el número de una tarjeta), nunca el estado vacío ("No hay…", 0) ni nada. La bandera de carga se enciende en el MISMO handler que aplica el filtro; un listener nuevo lleva su bandera de "primera respuesta" (también en el callback de error) (V00449).
- **Avisos**: una notificación para el usuario (flotante y en la campana) se hace con `avisar()` / `publicarRevision()` de `src/shared/data/avisos.ts` (las muestra `AvisosFlotantes`, montado una vez en App). No crear otro sistema de toasts (V00450).
- **Carga de archivos**: toda carga usa `<AdjuntosArchivos>` (`src/shared/components`) con una lista `Adjunto[]` y se sube al guardar con `subirAdjuntos` (`src/shared/archivos`). Máximo 10 (`MAX_ADJUNTOS`); expedientes `SIN_LIMITE`; una sola imagen `max={1}`. Se guarda la lista + el primer archivo en los campos de siempre (`camposDeArchivos`) y se lee con `archivosDeDocumento`. No hagas otro `<input type="file">` (V00451).
- **Arranque**: no pongas consultas al servidor EN FILA antes de pintar la app. El perfil se toma de la caché local y lo confirma el listener del perfil; las banderas empiezan al iniciar sesión (V00447).
- Medir lecturas: `npm run dev:medir` y en la consola `__lecturas.marcar('acción')`, `__lecturas.tabla()`, `__lecturas.listeners()`.

### Excepciones documentadas
- `src/shared/data/medidor/firestoreMedido.ts` reemplaza `firebase/firestore` solo en `vite --mode medir`; usa internos del SDK para saber la ruta de una consulta.
- `<style>` dentro de strings HTML generados para PDF/impresión es válido (no es JSX).
- `vite.config.ts` hace `skipWaiting` + `clientsClaim` a propósito (V00311, causa de ERR_FAILED intermitente); la recarga por versión nueva espera a que no haya formularios con cambios sin guardar.

### Archivos y entorno
- Los `node_modules` de Omaf vienen de Windows: para `vite build` en Linux instala `--no-save @rollup/rollup-linux-x64-gnu` de la misma versión de rollup y da permisos de ejecución a `node_modules/.bin/*`.
- Cloud Functions en Node 22 (`functions/package.json` → `engines`, V00448).
- Hosting: Cloudflare Workers con assets estáticos (`wrangler.jsonc`, `public/_headers`) + PWA (`vite-plugin-pwa`). No se despliega desde Claude.
- `.env` está en git a propósito: solo la configuración web de Firebase (pública) y el build de producción la lee. Nunca pongas ahí llaves secretas: el token de Banxico que estuvo en ese archivo sigue en el historial de GitHub (darlo de baja en Banxico).
- `dist/` y `node_modules/` NUNCA van en git (los ignora `.gitignore` de la raíz; no lo reemplaces por el de `functions/`).
- En scripts de Python que reemplazan texto: siempre `assert` de que el texto original existe exactamente una vez (falló 3 veces sin eso).
