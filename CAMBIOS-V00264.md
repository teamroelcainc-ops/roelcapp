# V00264 — Módulos vivos, operación minimizada global y tarjetas de facturación clicables

## Archivos que cambian (respetar rutas)
- `src/utils/mantenerVivo.tsx` **(NUEVO)** y `src/utils/moduloVivoContexto.ts` **(NUEVO)**
- `src/utils/busquedaGlobal.ts` (consciente del módulo visible)
- `src/App.tsx` y `src/App.css` (12 módulos envueltos en MantenerVivo)
- `src/features/operaciones/components/FormularioOperacion.tsx` (portal)
- `src/features/facturacion/components/FacturacionClientesDashboard.tsx` y `.css`
- `src/config/version.ts` y `public/version.json` — bump a V00264.

## 1) La operación minimizada te sigue a todos lados
El formulario de operación (abierto o minimizado) ahora vive en un PORTAL
sobre toda la app. Minimizas una operación, te vas a Facturación, Catálogos
o donde sea, y la píldora flotante sigue ahí abajo — un clic y se abre
encima del módulo en el que estés, con todo lo capturado intacto.

## 2) Los módulos ya no se recargan al navegar (MantenerVivo)
12 módulos ya NO se desmontan al cambiar de pantalla — solo se ocultan.
Al regresar aparecen AL INSTANTE tal cual los dejaste: mismos filtros,
misma búsqueda, misma página, sin "Cargando…" ni volver a filtrar.
Módulos vivos: Mis Operaciones, Operaciones Activas, Servicios Completados,
Servicios Cancelados, Facturación Clientes, Facturación Proveedores,
Tarifario Clientes, Tarifario Proveedores, Convenio de Clientes, Convenio
de Proveedores, Catálogos y Empresas.
- El buscador global del topbar sabe cuál módulo está VISIBLE (no el
  último abierto) y le manda la búsqueda solo a ese.
- La primera visita a cada módulo carga normal; el costo es memoria del
  navegador, no lecturas extra de Firebase.

## 3) Tarjetas de facturación clicables
Las 4 tarjetas del historial (Facturas Listadas, Ops. Facturadas, Total
USD, Total MXN) ahora se PRESIONAN: se abre el detalle con las facturas
que componen el número (invoice, fecha, cliente, ops, moneda, total) —
USD muestra solo las facturas en Dólares, MXN solo las de Pesos, siempre
con los filtros actuales del historial — y el botón "⬇ Descargar Excel"
baja exactamente esa información (con referencias reales incluidas).

## Verificación
- `tsc --noEmit`: 0 errores. ESLint: App 72 y Facturación 308 (idénticos),
  FormularioOperacion 385 (idéntico), utilidades nuevas en 0.
- `npm run build`: OK (PWA, 151 archivos sin imports rotos).

## Nota
Si notas la app pesada tras visitar muchos módulos en una sesión muy
larga, avísame — se puede limitar cuántos módulos quedan vivos a la vez.
