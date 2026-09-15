# V00261 — Exportar Excel de Facturación: rápido, con indicador y con aviso de error

## Archivos que cambian (respetar rutas)
- `src/features/facturacion/components/FacturacionClientesDashboard.tsx`
- `src/features/facturacion/components/FacturacionProveedoresDashboard.tsx`
- `src/config/version.ts` y `public/version.json` — bump a V00261.

## Qué pasaba
El botón SÍ arrancaba, pero el V00260 resolvía las referencias de las
6,643 facturas en ~230 consultas EN SERIE a Firebase: tardaba varios
minutos sin ningún indicador, y si algo fallaba a la mitad no avisaba.
A la vista, "no funcionaba".

## El arreglo (ambos lados: Clientes y Proveedores)
- La resolución de referencias ahora va en PARALELO (12 lotes a la vez):
  de minutos a unos segundos la primera vez; las siguientes exportaciones
  del día son casi instantáneas porque lo resuelto queda en memoria.
- El botón muestra "⏳ Exportando…" y se deshabilita mientras trabaja,
  para que se vea que está en proceso (y no se dispare doble).
- Todo el proceso va en try/catch: si algo falla, sale un aviso claro en
  vez de quedarse callado.

## Cómo verificar
Historial de Facturas → Exportar Excel: el botón cambia a "⏳ Exportando…"
unos segundos y descarga el archivo con las referencias reales (TR-…).

## Verificación técnica
- `tsc --noEmit`: 0 errores. ESLint: 308 y 335, idénticos a la entrega
  anterior (ninguno nuevo).
- `npm run build`: OK (PWA generada).
