# V00300 — Ruta (Origen — Destino) visible en la ficha del tarifario

## Archivos que cambian (respetar rutas)
- `src/features/tarifarioClientes/components/TarifarioClientesDashboard.tsx` y `.css`
- `src/features/tarifarioProveedores/components/TarifarioProveedoresDashboard.tsx` y `.css`
- `src/config/version.ts` y `public/version.json` — bump a V00300.

## Qué agrega
La tabla de la ficha del pre convenio (Detalle del Pre Convenio) ahora
tiene la columna **ORIGEN — DESTINO** en cada línea — la misma ruta que
se sincroniza con el detalle del convenio. Así puedes VERIFICAR la
relación bidireccional de un vistazo, sin abrir el ✏ de cada línea.

## Importante — tus capturas son de la versión SIN la V00299
Los dos síntomas que muestran (el editor de CONV-507 abriendo sin tarifa
y el origen "Nuevo Laredo" de CONV-508 sin llegar a TARI-001) son
exactamente lo que la V00299 corrige. Para activarlo TODO:
1. Instala V00299 y V00300 (app).
2. `firebase deploy --only functions` — motor relacional v1.3 (los
   triggers convenio→tarifario).
3. Prueba: edita CONV-508 (o cualquier detalle), Guardar → abre TARI-001
   y la columna nueva debe mostrar "Nuevo Laredo — …" en esa línea.
   Y CONV-507 debe abrir con su tarifa cargada.

## Verificación
- `tsc --noEmit`: 0 errores. ESLint: ambos tarifarios 0.
- `npm run build`: OK (PWA generada).
