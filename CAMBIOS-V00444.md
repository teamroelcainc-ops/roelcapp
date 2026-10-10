# V00444 — Fase 8: hooks de datos, selectores, archivos más chicos y efectos sin `eslint-disable`

**Sin banderas nuevas ni pasos en producción** (solo web). No cambia lo que el usuario ve. **8.2 (unir Facturación
Clientes y Proveedores) NO se hizo: es decisión de producto** (ver abajo). **8.4 (separar costos y sueldos) queda
diseñado, no aplicado**: necesita migración (P2), reglas (P1) y coordinar la app móvil.

## 8.1 — Hooks de datos y selectores
- `features/operaciones/hooks/useOperacionesActivas.ts`: carga, paginación y "Cargar más" de Operaciones Activas
  (camino canónico y viejo, igual que antes) — salió de OperacionesDashboard (~150 líneas).
- `features/facturacion/hooks/useOperacionesFacturables.ts`: carga de operaciones de Facturación (pendientes,
  facturadas bajo demanda, camino viejo con su respaldo) — estaba COPIADA en Clientes y Proveedores.
- `features/facturacion/selectores.ts`: 13 funciones/constantes que estaban copiadas idénticas en los dos tableros de
  Facturación (columnas, status, fechas de factura, orden natural de referencias…), tipadas y con 12 pruebas.
- `features/operaciones/services/formatosOperacion.ts` (fecha de auditoría, color por tipo, orden de status,
  `limpiarUndefined`; antes en 3 tableros) y `services/auditoriaLog.ts` (antes en el formulario y en Completados).

## 8.3 — Archivos más chicos (primera parte)
| Archivo | Antes | Ahora |
|---|---|---|
| FacturacionProveedoresDashboard | 5,043 | 4,821 |
| FacturacionClientesDashboard | 4,767 | 4,538 |
| FormularioOperacion | 4,290 | 3,899 |
| ServiciosCompletados | 3,921 | 3,690 |
| OperacionesDashboard | 3,062 | 2,870 |
- Del formulario salieron a `components/formulario/`: direcciones por país, T.C. por fecha, documentos de la
  operación, íconos y `CampoArchivo`/`BotonAgregar` (sus estilos en línea pasaron a `CampoArchivo.css` con los mismos
  valores; el hover del botón "+" pasó a CSS). De Completados a `components/completados/`: columnas y formatos.
- **No se llegó a la meta de 800 líneas**: lo que queda son los modales y tablas DENTRO de cada componente (leen
  decenas de estados). Plan por pasos en PLAN-REFACTOR.md ("Fase 8.3 — siguientes pasos"); cada paso necesita
  revisarse en el navegador.

## 8.5 — Efectos y trinquete
- 25 efectos pasaron de `eslint-disable … exhaustive-deps` a `useEffectEvent` (React 19): mismo comportamiento (el
  efecto se repite con las mismas dependencias y lee los valores vigentes). Más la carga inicial de Operaciones (ahora
  en su hook) y un comentario que no hacía nada: total en `src` 129 → 102. Quedan los de `useMemo` (necesitan
  `useCallback` en sus funciones auxiliares; siguiente paso).
- `scripts/verificar-lint.mjs` cuenta los avisos de `exhaustive-deps` que ESLint de verdad SUPRIME (con o sin nombre
  de regla, por línea o por archivo; 91 hoy) y falla si suben (`desactivadosDeps` en la línea base).
- **Cambios de comportamiento a propósito** (correcciones que salieron al pasar a `useEffectEvent`):
  - Pagos: al guardar una operación de la factura abierta, el detalle se recargaba con la pestaña y el catálogo de
    empresas del MOMENTO DE ENTRAR (siempre "cliente"): en la pestaña Proveedores mostraba montos del cliente. Ahora usa
    la pestaña actual.
  - Pagos: la recarga al volver a la pestaña ya no arranca una segunda descarga si hay una en curso (antes el escucha
    veía siempre "no hay recarga en curso").
  - Operaciones: al sacar las finalizadas se usa la regla de status vigente (diferencia de milisegundos).
- `any` en todo el repo: 2,465 → 2,350 (los módulos nuevos no tienen ninguno).

## 8.2 — Unir Facturación Clientes y Proveedores: PENDIENTE DE DECISIÓN
Comparados bloque por bloque, los dos tableros comparten carga y selectores (ya unidos arriba) pero difieren en
modales y reglas (Confirmación de Tarifa y Rate solo en proveedores, filtros, columnas, cálculo del lado). Unirlos es
decidir cuál comportamiento se queda en cada diferencia: lista en code-notes.md.

## 8.4 — Costos y sueldos aparte: DISEÑO (no aplicado)
Las reglas de Firestore no pueden ocultar CAMPOS de un documento: hoy quien puede leer una operación (el operador
desde Mis Operaciones o la app móvil) puede leer sus montos. Propuesta en PLAN-REFACTOR.md ("Fase 8.4"):
`operaciones_finanzas/{opId}` mantenido por el servidor, pantallas de finanzas leyendo de ahí, la app móvil sin
`sueldoOperador` (coordinado con roelca-movil), reglas, y al final (P4) borrar los campos de `operaciones`.

## Verificación
- `tsc -b` ✔ · trinquete ESLint ✔ (any 2,350; exhaustive-deps desactivado 102) · trinquete de consultas ✔ · vitest web
  19 archivos / 185 ✔ (22 nuevas: selectores de Facturación y piezas de operaciones) · `npm run build` ✔ · functions
  sin cambios · `style={{` no sube en ningún archivo (FormularioOperacion 27 → 24).
- **No probado aquí**: navegador (Operaciones Activas "Cargar más", Facturación al cambiar de vista, el campo de
  archivo al arrastrar, el hover del botón "+", los efectos convertidos del formulario).
