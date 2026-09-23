# V00342 — Moneda al editar la empresa · botón "🏷 Razón social" para toda la cadena

## Archivos que cambian (respetar rutas)
- `src/features/empresas/components/FormularioEmpresa.tsx`
- `src/features/empresas/components/EmpresasDashboard.tsx` y `.css`
- `src/features/empresas/services/sincronizarRazonSocial.ts` (NUEVO)
- `src/config/historialCambios.ts` (entrada automática de esta versión)
- `src/config/version.ts` + `public/version.json` — V00342.

## 1) La moneda ya aparece al editar (y sin IDs pelones)
Causa encontrada: hay empresas con la moneda (o el tipo de factura)
guardada como NOMBRE ("Dólares") y otras como ID del catálogo. El
selector busca por ID, por eso "tenía moneda pero salía vacío" o se veía
el ID en vez del nombre. Ahora, en cuanto cargan los catálogos, el valor
se normaliza al ID correcto y el selector lo muestra de inmediato — al
guardar, queda ya normalizado.

## 2) Botón "🏷 Razón social" (Empresas, junto a ➕)
Recorre TODAS las empresas y escribe su razón social actual en:
- **Operaciones**: cliente que paga, cliente de la mercancía y proveedor.
- **Facturación**: facturas de clientes y de proveedores.
- **Pagos**: cliente / proveedor / entidad.
Solo toca los registros donde el nombre difiere (en lotes), y avisa
cuántos actualizó. Así todos los módulos muestran el nombre actual y
nunca un ID.

## Verificación
- `tsc --noEmit` ✓ · eslint: FormularioEmpresa 21 y EmpresasDashboard 71
  (baselines exactos), servicio nuevo en 0 · `npm run build` ✓

## Al instalar
Reemplaza/añade los archivos + versión, `npm run build` y publica.
