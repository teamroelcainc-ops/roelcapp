# V00312 — "↗ Ver en nueva pestaña" en más módulos · tablas con 30 filas de inicio · scroll siempre visible en TODA la app

## Archivos que cambian (respetar rutas)
- `src/utils/verEnPestana.ts` — **NUEVO**: helper genérico del botón ↗.
- `src/index.css` — scrollbars permanentes GLOBALES.
- `src/features/conveniosDetalles/components/DetallesConvenioDashboard.tsx` y `.css`
- `src/features/tarifarioClientes/components/TarifarioClientesDashboard.tsx` y `.css`
- `src/features/tarifarioProveedores/components/TarifarioProveedoresDashboard.tsx`
- `src/features/operaciones/components/ServiciosCompletados.tsx`
- `src/features/operaciones/components/ServiciosCancelados.tsx` y `.css`
- `src/config/version.ts` + `public/version.json` — V00312.

## 1) "↗ Ver en nueva pestaña"
Helper genérico (`urlVerEnPestana` + `filtrosDeUrl`): la URL lleva el módulo
y TODOS sus filtros; al abrirla, el módulo restaura esa misma vista.
Conectado en esta tanda:
- **Detalles del Convenio (Clientes y Proveedores)**: botón ↗ junto a
  "Actualizar" — lleva pestaña activa, búsqueda, entidad y orden por columna.
- **Tarifario de Clientes y de Proveedores**: botón ↗ junto al contador de
  filtros — lleva búsqueda, entidad, status, moneda y orden por columna.
- **Servicios Cancelados**: botón "↗ Ver en nueva pestaña" junto a los chips
  de la búsqueda (igual que Completados); el ?filtros= de la URL manda sobre
  el filtro recordado del usuario.
- Servicios Completados ya lo tenía (V00294).
**Siguiente tanda** (mismo patrón, son 2 líneas por módulo): Facturación
Clientes/Proveedores, Empresas, Pagos y el resto que lo necesite.

## 2) Tablas con 30 filas de inicio
- Detalles del Convenio y ambos tarifarios: la tabla PINTA 30 filas y abajo
  aparecen "Mostrar 30 más" / "Mostrar todas (N)". El tope se reinicia al
  cambiar pestaña, búsqueda, filtros u orden.
- Completados y Cancelados: su paginación pasa de 50 a 30 por página.
- HONESTIDAD: este tope reduce el PESO DE PINTADO (abrir el módulo es más
  ligero). Las LECTURAS de Firestore ya se atacaron por otro lado (⚡ rango
  indexado, cachés por rango y en vivo). Si quieres además `limit()` en
  consultas específicas, dímelo y lo aplico donde no rompa relaciones.

## 3) Scroll SIEMPRE visible — global
Reglas en `index.css` para TODA la app: barra horizontal y vertical
permanentes y estilizadas (12px, riel oscuro, pulgar azul al pasar) en todos
los marcos de tabla y paneles, también donde macOS las oculta.

## Verificación
- `tsc --noEmit` ✓ · eslint: helper 0, Convenios 0, Tarifarios 0,
  Completados 163 (sus preexistentes exactos), Cancelados idéntico a su
  baseline ✓ · `npm run build` completo ✓

## Al instalar
Reemplaza los archivos respetando rutas (verEnPestana.ts es nuevo dentro de
src/utils/), `npm run build` y publica.
