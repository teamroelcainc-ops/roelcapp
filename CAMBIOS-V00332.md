# V00332 — Combustible y Catálogos integrados al módulo de Autorizaciones

## Archivos que cambian (respetar rutas)
- `src/features/autorizaciones/autorizaciones.ts`
- `src/features/catalogos/components/CatalogosDashboard.tsx`
- `src/features/combustible/components/FormularioCombustible.tsx`
- `src/config/historialCambios.ts` (entrada automática de esta versión)
- `src/config/version.ts` + `public/version.json` — V00332.

## Qué cambia
Los dos módulos que aparecían "pendiente de integrar" ya están dentro:

1) **Combustible** — con acciones Y campos controlables (Fecha, Tipo de
   combustible, Moneda, Litros/Galones, Proveedor, Costo, Tipo de
   cambio). Al guardar un registro, la verificación mira SOLO los campos
   que realmente cambiaron (mismo criterio que Empresas), respeta
   "Agregar libre" y las reglas por rol; crear también se controla.

2) **Catálogos** — el control es por ACCIÓN: quién puede CREAR, EDITAR o
   BORRAR registros de cualquier catálogo (cada catálogo tiene campos
   distintos, por eso se controla la acción completa). Aplica al guardar,
   al eliminar individual y al eliminar en lote; si el usuario no está
   autorizado, ve el aviso y el cambio no se aplica.

**Para activarlo**: en Autorizaciones, configura las reglas de
"Combustible" (por acción o por campo) y de "Catálogos" (por acción).
Sin reglas configuradas, todo sigue como hoy.

## Verificación
- `tsc --noEmit` ✓ · eslint: Catálogos 113 = baseline exacto,
  Combustible 13 = baseline exacto, autorizaciones.ts 13 = baseline ·
  `npm run build` completo ✓

## Al instalar
Reemplaza los 4 archivos + versión, `npm run build` y publica.
