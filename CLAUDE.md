# CLAUDE.md

Reglas para Claude Code en este repositorio (React + TypeScript + Vite + Firebase). Objetivo: código fácil de mantener, carga rápida y el menor número posible de lecturas y escrituras en Firebase. Las reglas de la sección final "Específico de este proyecto" tienen prioridad sobre las generales.

## Forma de trabajar

- Cambios pequeños y verificables, un área a la vez. Un refactor no cambia lo que el usuario ve ni lo que la app hace.
- Pregunta antes de: instalar o quitar dependencias, cambiar Security Rules o índices, desplegar, mover carpetas en bloque o fusionar dos funcionalidades que ambas funcionan.
- Registra en `code-notes.md` las decisiones no obvias y lo que quede pendiente.

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

- Solo componentes funcionales: `export default function Nombre(props: Props)`. Sin `React.FC` ni clases (excepción: un Error Boundary).
- Una responsabilidad por componente. Si pasa de ~150 líneas o mezcla varias tareas (datos + formulario + tabla), divídelo en subcomponentes, un custom hook o un util.
- Evita el prop drilling con composición (`children`, props que reciben elementos) antes de crear un Context; Context antes que una librería de estado global.
- Íconos desde la librería del proyecto (p. ej. `lucide-react`), no SVG a mano salvo que el ícono no exista.
- JSX semántico: listas de `.map()` en `<ul>/<li>`; pares etiqueta/valor en `<dl>/<dt>/<dd>`; acciones en `<button>`, nunca `<div onClick>`.
- `key` estable tomada del dato (`id`, `url`); el índice solo si la lista es estática y no tiene identificador.
- Los handlers que actúan sobre un ítem lo reciben como parámetro (`onClick={() => remove(item)}`), no leen un "ítem seleccionado" del estado que pudo cambiar antes de confirmar.

## Estado y efectos

- Estado lo más cerca posible de donde se usa; súbelo solo cuando dos componentes lo necesitan.
- Lo que se puede calcular desde props o estado se calcula en el render; no lo guardes en otro `useState` sincronizado con `useEffect`.
- `useEffect` solo para sincronizar con algo externo (listeners de Firestore, DOM, timers), siempre con cleanup. La lógica que responde a una acción del usuario va en el handler, no en un efecto.
- Lógica con estado o efectos que se repite → custom hook (`useAlgo`) dentro del dominio o en `shared/hooks`.
- Contexts pequeños por dominio; no pongas en un Context valores que cambian a cada tecla.
- Memoización: si el proyecto tiene React Compiler activo, no agregues `useMemo`/`useCallback`/`memo` manuales. Si no lo tiene, úsalos solo ante un problema medido (React DevTools Profiler) o para estabilizar dependencias de un efecto o props de un hijo memoizado.

## TypeScript

- `strict` activo. Nada de `any` en estado, props o parámetros; usa `unknown` y reduce el tipo.
- Tipa cada colección de Firestore una sola vez, en su service, con `withConverter<T>()` (o un cast en el punto de lectura si no hay converter). El resto del código recibe `T` sin casts.
- Una sola fuente de tipos compartidos (`src/types`). Si un archivo necesita campos extra, evalúa si pertenecen al tipo canónico; si son locales, usa un tipo extendido con nombre y un comentario que explique por qué.
- Todo `as any` que sobreviva lleva un comentario con la razón. Excepción aceptable: datos genuinamente dinámicos (p. ej. un formulario cuya estructura depende de configuración) como `Record<string, unknown>`, documentado donde ocurre.
- `import type` para imports que solo son tipos.

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

- Rutas, vistas y modales pesados con `React.lazy` + `Suspense`.
- Librerías pesadas (mapas, PDF, gráficas, Excel) con `import()` dinámico en el momento en que se usan, no en el arranque.
- Importa Firebase por submódulo; `firebase/storage`, `firebase/functions`, etc. solo en los módulos que los usan.
- Búsquedas y filtros que consultan datos, con debounce (~300 ms). Listas de cientos de filas: paginación o virtualización.
- Compara el tamaño de los chunks de `npm run build` antes y después de cualquier cambio que afecte la carga.

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

- Antes de escribir un helper, busca en `shared/utils` (o `src/utils`) si ya existe.
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
- **`MantenerVivo`** (`src/utils/mantenerVivo.tsx`): 12 módulos pesados no se desmontan al navegar; se ocultan. Un listener dentro de un módulo vivo usa `useSnapshotSoloVisible` (o `useColeccionViva` con `soloVisible`) para cerrarse mientras el módulo está oculto.
- **Catálogos → `useCatalogo(nombre)`** de `src/shared/data/catalogos.ts`. No hagas `getDocs`/`onSnapshot` propios de un catálogo ni lo copies a localStorage. La lista de catálogos y su campo de nombre está en `CATALOGOS` de ese archivo; uno nuevo se agrega ahí. Después de escribir en un catálogo no parches una copia local.
- **Datos en vivo compartidos → `useColeccionViva(clave, consulta)`** de `src/shared/data/coleccionesVivas.ts`: un `onSnapshot` por clave para toda la app.
- **Lecturas únicas** (conteos, páginas, reportes) → TanStack Query (`src/lib/queryClient.ts`); invalida con `queryClient.invalidateQueries` después de escribir.
- La caché persistente de Firestore (IndexedDB) es la ÚNICA caché en disco. No guardes operaciones, facturas ni catálogos en localStorage/sessionStorage (`cat_v1__`, `cat_v2__`, `roelca_catalogos_v2`, `almacenSesion` son legado y se están retirando).
- **Banderas (`configuracion/flags`)** → `useFlags()` / `obtenerFlags()` de `src/shared/data/flags.ts`. Todo cambio que depende de algo desplegado en el servidor (callables nuevas, campos migrados) va detrás de una bandera que por defecto está apagada, con el camino viejo intacto. La tabla de banderas y cuándo encender cada una está en `PLAN-REFACTOR.md`.
- **Fechas**: se guardan `AAAA-MM-DD`. Para consultar por rango usa `fechaServicioISO` (canónico); `fechaServicio` tiene formatos mezclados (ISO, Timestamp, d/m/aaaa de AppSheet). Convierte con `aFechaISO()` de `src/shared/dominio/fechas.ts`. "Hoy" se calcula con `src/utils/fechaHoraLocal.ts` (hora local), nunca con `toISOString()`.
- **Monedas**: `monedaCanonica()`/`esUSD()` de `src/shared/dominio/moneda.ts` aceptan ID del catálogo, código o nombre. Nunca compares contra `'USD'` o contra el ID a mano. IDs en `src/shared/dominio/constantes.ts` (`ID_USD`, `ID_MXN`, `STATUS_COMPLETADOS`, `STATUS_CANCELADO`, `TIPO_EMPRESA`).
- **Dinero**: montos a 2 decimales, tipo de cambio hasta 4 (regla V00274). Sumas en centavos (`sumarMontos`). La regla de conversión (convenio USD + factura MXN → × TC; MXN + USD → ÷ TC; misma moneda → igual) vive en `src/shared/dominio/dinero.ts` y es la MISMA en web y servidor.
- **Relaciones**: guarda siempre el ID (`clientePaga`, `proveedorUnidad`, `convenio`, `status`, `unidad`…) y su copia `*Nombre` para pintar tablas. Nunca busques por nombre. Las copias `*Nombre` las mantiene el servidor (triggers de `relacional.ts`); no agregues botones de "reparar nombres".
- **Escrituras de dinero** (aplicar pagos, facturar, nómina): transacción (`runTransaction`) o callable. Nunca leer-modificar-escribir con datos de una lista ya cargada.

### Seguridad
- Las reglas (`firestore.rules`, `storage.rules`) y los índices (`firestore.indexes.json`) ya están en el repo y declarados en `firebase.json`. **Nunca corras `firebase deploy` sin `--only`**: publicaría reglas e índices. Las funciones se despliegan con `firebase deploy --only functions`. Las reglas se prueban con `npm run test:rules` (emulador) antes de publicarlas.
- Roles efectivos en custom claims (`personal`, `admin`, `cliente`) que pone la callable `asignarAcceso`; las reglas y `exigirPersonal`/`exigirAdmin` (functions/src/acceso.ts) los leen. Un usuario sin documento en `usuarios` NO tiene acceso (nunca "admin por omisión").
- Callables nuevas: validan el payload con zod y llaman `exigirPersonal`/`exigirAdmin` primero.

### Versiones y entregas (la gerencia sigue el trabajo por versión)
- Cada entrega sube la versión: `npm run version:bump` (actualiza `src/config/version.ts` y `public/version.json`), agrega su entrada al inicio de `CAMBIOS_APP` en `src/config/historialCambios.ts` (resumen en lenguaje cotidiano) y un `CAMBIOS-Vxxxxx.md` con el detalle técnico y los pasos manuales. Los comentarios de código llevan `✅ Vxxxxx` cuando explican un cambio.
- Registrar un módulo nuevo toca: `lazy()`, el tipo de `moduloActivo`, el mapa de permisos, `ICON`, el ítem del sidebar con `puede()`, el render con `MantenerVivo` si es pesado (todo en `App.tsx`), `GRUPOS_MODULOS` de `RolesDashboard.tsx` y `src/components/modulosNavMovil.ts`.

### ESLint, estilos y verificación en este repo
- El repo arrastra ~3,000 problemas de ESLint (casi todos `any`) y ~1,100 `style={{` heredados. Regla: **no pueden crecer**. `node scripts/verificar-lint.mjs` (trinquete contra `scripts/lint-baseline.json`) falla si un archivo empeora o sube el total de `any`; cuando un archivo mejora, `--actualizar` baja su línea base. En lugar del paso 1 general, comprueba que `grep -c "style={{"` de cada archivo tocado no suba y que lo nuevo no agregue ninguno.
- `npm run verificar` = `tsc -b` + trinquete de ESLint + trinquete de consultas (`scripts/verificar-consultas.mjs`: ninguna lectura nueva de `operaciones` completa) + `vitest run`. Las Cloud Functions: `npm --prefix functions run build` y `npm --prefix functions test`.
- Medir lecturas: `npm run dev:medir` y en la consola `__lecturas.marcar('acción')`, `__lecturas.tabla()`, `__lecturas.listeners()`.

### Excepciones documentadas
- `src/shared/data/medidor/firestoreMedido.ts` reemplaza `firebase/firestore` solo en `vite --mode medir`; usa internos del SDK para saber la ruta de una consulta.
- `<style>` dentro de strings HTML generados para PDF/impresión es válido (no es JSX).
- `vite.config.ts` hace `skipWaiting` + `clientsClaim` a propósito (V00311, causa de ERR_FAILED intermitente); la recarga por versión nueva espera a que no haya formularios con cambios sin guardar.

### Archivos y entorno
- Los `node_modules` de Omaf vienen de Windows: para `vite build` en Linux instala `--no-save @rollup/rollup-linux-x64-gnu` de la misma versión de rollup y da permisos de ejecución a `node_modules/.bin/*`.
- Hosting: Cloudflare Workers con assets estáticos (`wrangler.jsonc`, `public/_headers`) + PWA (`vite-plugin-pwa`). No se despliega desde Claude.
- En scripts de Python que reemplazan texto: siempre `assert` de que el texto original existe exactamente una vez (falló 3 veces sin eso).
