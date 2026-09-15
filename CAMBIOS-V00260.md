# V00260 — Excel de Facturación: referencias reales (TR-…) en vez de IDs

## Archivos que cambian (respetar rutas)
- `src/features/facturacion/components/FacturacionClientesDashboard.tsx`
- `src/features/facturacion/components/FacturacionProveedoresDashboard.tsx`
- `src/config/version.ts` y `public/version.json` — bump a V00260.

## La causa
Las facturas importadas guardan sus operaciones por ID (7657fa80…). Para
mostrarlas, el historial resuelve ID → referencia con un mapa que solo se
llena para las FILAS VISIBLES en pantalla (paginación, con tope de 150).
Al exportar el Excel se recorren TODAS las facturas del rango (Enero a
Agosto), y las que estaban fuera de la página caían al respaldo: el ID.
Por eso la columna "Referencias" salía con IDs.

## El arreglo
Antes de generar el Excel, ahora se resuelven las referencias de TODO el
historial filtrado (consultas por lotes de 30 a Firebase con los IDs
faltantes) y con ese mapa completo se arma la columna "Referencias" (y
"Ref Cliente" en el lado clientes). Lo resuelto se guarda también en el
mapa de la tabla, así que las filas quedan resueltas para la sesión.
Aplica a AMBOS lados: Facturación Clientes y Facturación Proveedores.

## Cómo verificar
Exporta de nuevo "Facturas de Enero a Agosto": la columna Referencias debe
traer TR-xxxxxx-xx (o la referencia que tenga cada operación), separadas
por coma cuando la factura agrupa varias. Un ID solo aparecería si la
operación ya no existe en la base (referencia rota de una importación).

## Verificación técnica
- `tsc --noEmit`: 0 errores.
- ESLint: Clientes 308 (original 311 — tres menos), Proveedores 335
  (idéntico al original) — ningún problema nuevo.
- `npm run build`: OK (PWA generada).
