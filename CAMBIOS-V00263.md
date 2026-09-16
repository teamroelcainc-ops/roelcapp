# V00263 — Buscador global en la barra superior (filtra el módulo activo)

## Archivos que cambian (respetar rutas)
- `src/utils/busquedaGlobal.ts` **(NUEVO)** — bus del buscador
- `src/App.tsx` y `src/App.css` — input centrado en el topbar
- Módulos conectados (1 línea + import cada uno):
  `src/features/facturacion/components/FacturacionClientesDashboard.tsx`,
  `FacturacionProveedoresDashboard.tsx`,
  `src/features/operaciones/components/ServiciosCompletados.tsx`,
  `ServiciosCancelados.tsx`,
  `src/features/tarifarioClientes/components/TarifarioClientesDashboard.tsx`,
  `src/features/tarifarioProveedores/components/TarifarioProveedoresDashboard.tsx`,
  `src/features/conveniosDetalles/components/DetallesConvenioDashboard.tsx`,
  `src/features/catalogos/components/CatalogosDashboard.tsx`,
  `src/features/empresas/components/EmpresasDashboard.tsx`
- `src/config/version.ts` y `public/version.json` — bump a V00263.

## Qué hace
Input redondeado, centrado en la barra superior (donde marcaste), estilo
oscuro de la app. Lo que escribas ahí FILTRA EL MÓDULO EN EL QUE ESTÁS:
usa el mismo criterio del buscador propio de cada módulo. El placeholder
te dice qué busca (p. ej. "Buscar en facturas…").

Módulos conectados: Facturación Clientes y Proveedores, Servicios
Completados y Cancelados (filtra EN VIVO, sin presionar Buscar),
Tarifario Clientes y Proveedores, Convenio de Clientes, Catálogos (busca
en el catálogo abierto) y Empresas.

## Diseño a prueba de romper nada
- Si el módulo activo NO tiene búsqueda, el campo se deshabilita solo y
  dice "Sin búsqueda en este módulo" — nunca estorba ni lanza errores.
- Al cambiar de módulo, el texto se limpia solo (no arrastra filtros).
- El buscador escribe EN el estado del buscador propio de cada módulo,
  así que los filtros, contadores y exports existentes siguen intactos.
- En pantallas angostas el input se adapta al ancho disponible.
- Conectar un módulo nuevo en el futuro es UNA línea:
  `useBusquedaGlobal((t) => setBusqueda(t), 'qué busca');`

## Verificación
- `tsc --noEmit`: 0 errores. ESLint: todos los archivos con sus conteos
  idénticos a la entrega anterior (los tarifarios, convenios y el bus en
  0); ningún problema nuevo.
- `npm run build`: OK (PWA generada, 149 archivos sin imports rotos).
