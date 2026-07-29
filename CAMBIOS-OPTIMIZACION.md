# Optimización Roelca — cambios aplicados

## 1. Caché y lecturas mínimas (app tipo Play Store)

### `src/config/firebase.ts`
- **Caché persistente de Firestore (IndexedDB, multi-pestaña).** Todo dato ya visto
  queda guardado EN el dispositivo:
  - Al reabrir la app, las vistas pintan al instante desde el caché local mientras
    el SDK sincroniza en segundo plano.
  - Los `onSnapshot` sirven primero desde caché (latencia ~0) y solo facturan
    lecturas por los documentos que CAMBIARON — no por toda la colección.
  - La app funciona offline: consultas y escrituras se encolan y se sincronizan solas.
- CRUD helpers sin `any` (tipos del SDK con cast documentado).

### PWA instalable (`vite.config.ts`, `index.html`, `public/icons/`)
- `vite-plugin-pwa`: manifest + service worker. La app se puede **instalar** en
  Android/iOS/escritorio (ícono propio, pantalla completa, sin barra del navegador).
- El "cascarón" (JS/CSS/HTML/iconos) se precachea: cargas siguientes sin red.
- `autoUpdate`: al publicar una versión nueva, el SW la baja en segundo plano.
- Imágenes de Firebase Storage: stale-while-revalidate (pintan al instante).
- Vendors en chunks separados (`react`, `firebase`): entre deploys el navegador
  reutiliza esos ~480 KB cacheados y solo baja el código que cambió.
- Iconos generados en `public/icons/` (192/512/maskable/apple-touch).

### Velocidad de filtros
- Los filtros de los dashboards ya operan en memoria (useMemo sobre datos cargados);
  con el caché persistente la carga inicial de esos datos también es local → los
  filtros responden al instante incluso al reabrir la app.

## 2. Vista móvil

### `src/styles/mobile.css` (nuevo, importado en `main.tsx`)
Capa responsive global que corrige TODA la app sin tocar los ~50 componentes:
- Modales a pantalla completa en teléfono (≤640px), con scroll y safe-area.
- Rejillas de formularios (`repeat(2/3/4, 1fr)` inline) colapsan a 1 columna.
- Tablas con scroll horizontal táctil y densidad compacta.
- Drawers de filtros a ancho completo.
- Inputs a 16px (elimina el zoom automático de iOS al tocar un campo).
- Botones con objetivo táctil de 40px.
- ⚠️ Usa `!important` a propósito para ganarle a los estilos inline existentes;
  conforme cada módulo se migre a clases hermanas, estas reglas dejan de aplicar.

### Sidebar off-canvas (`App.css` vía mobile.css + `App.tsx`)
- En móvil el menú flota SOBRE el contenido y se desliza (no lo aplasta).
- Inicia cerrado en pantallas chicas; navegar desde el menú lo cierra solo
  (`navegarA()` en App.tsx).

### `index.html`
- `lang="es"`, título "Roelca", `theme-color` oscuro, `viewport-fit=cover` (notch),
  meta tags de Apple para modo standalone.

## 3. CLAUDE.md aplicado — archivo ejemplar + convención

### `src/features/relojChecador/components/HistorialChequeosDashboard.tsx` (+ `.css` hermano)
Refactor completo como EJEMPLAR de la convención para el resto del proyecto:
- 0 estilos inline (todo en el CSS hermano; badge de 2 estados con clase+modificador).
- 0 `any`: tipos con nombre (`ChequeoRegistro`, `UsuarioSesion`) y comentario ⭐
  explicando por qué son locales.
- Ícono `lucide-react` (`<Download />`) en vez de SVG a mano.
- Sin `React.FC`; botón deshabilitado vía `:disabled` en CSS.
- Verificado: `grep style={{` → 0, `tsc --noEmit` → 0 errores, `eslint` → limpio.

## 4. Migración masiva a CSS hermanos (CLAUDE.md) — TODO el proyecto

Ejecutada con `codemod-css.mjs` (incluido en la raíz), que usa el AST real del
compilador de TypeScript (no regex):
- **6,626 `style={{...}}` estáticos migrados** a clases en **58 archivos CSS
  hermanos** (uno por componente, ej. `OperacionesDashboard.css`), con
  deduplicación (objetos idénticos comparten clase) e import automático.
- **740 estilos inline permanecen a propósito**: son los DINÁMICOS (ternarios,
  variables de runtime, CSS vars, spreads) — exactamente el caso que CLAUDE.md
  permite como inline. Migrarlos requiere criterio manual (clase+modificador
  para estados finitos), módulo por módulo.
- Los nombres de clase son generados (`od-x1`, `fcd-x12`...): correctos y
  deduplicados, pero no semánticos. Renombrarlos a nombres con significado es
  parte de la pasada manual por módulo.
- El diseño visual NO cambia: es el mismo estilo, movido de inline a CSS.
- Verificación: `tsc --noEmit` 0 errores · `npm run build` OK ·
  eslint idéntico a la línea base (381 problemas preexistentes por `any`,
  0 nuevos) en los archivos más grandes.

## Estado y hoja de ruta (honesto)

Tras la migración masiva quedan **740 estilos inline (dinámicos, permitidos)** y
**~1,762 `any`** por tipar módulo a módulo.
Lo entregado aquí ataca los 5 objetivos con las palancas globales (caché, PWA,
capa móvil, chunks) + el patrón ejemplar listo para replicar.

Orden sugerido para continuar módulo por módulo (ideal con Claude Code + CLAUDE.md):
1. OperacionesDashboard (vista más usada) → CSS hermano + tipos.
2. ServiciosCompletados / Cancelados.
3. FacturacionClientes / Proveedores (los más grandes).
4. Formularios (FormularioOperacion primero).
Cada módulo migrado deja de depender de los `!important` de mobile.css.

## Verificación
- `npx tsc --noEmit -p tsconfig.app.json` → **0 errores** (igual que la línea base).
- `npm run build` → build de producción OK; PWA genera `sw.js` con 64 entradas.
- `npx eslint` en archivos tocados → limpio.

## Dependencias nuevas
- `lucide-react` (íconos, convención CLAUDE.md)
- `vite-plugin-pwa` (dev)


## 5. Refactor senior (TanStack Query + Zustand + resiliencia offline)

Infraestructura nueva (lista para adoptarse módulo a módulo):
- `src/lib/queryClient.ts` + provider en `main.tsx` — caché de datos de servidor.
- `src/stores/useUsuarioStore.ts` (Zustand) — usuario/roles de sesión globales,
  alimentado por App.tsx; elimina prop drilling en vistas nuevas.
- `src/hooks/useEstadoConexion.ts` — estado online/offline reactivo.
- `src/components/AvisoSinConexion.tsx` — banner global montado en App.

Módulo patrón migrado: **Remolques**
- `features/remolques/hooks/useRemolques.ts`: useQuery hidrata el listado,
  onSnapshot alimenta el MISMO caché (setQueryData) → tiempo real sin
  descargas duplicadas; eliminación con mutación optimista y rollback.
- Dashboard: sin useEffect+useState de datos, hover real en CSS, eventos
  tipados (14 → 7 problemas de eslint; 0 nuevos).
- Formulario: botón Guardar deshabilitado sin conexión ("Sin conexión") e
  invalidación del caché al guardar.
