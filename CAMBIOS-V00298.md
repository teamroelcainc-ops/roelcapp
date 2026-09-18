# V00298 — Reporte de ventas: Pesos/Dólares Prov y Cliente iguales al formulario

## Archivos que cambian (respetar rutas)
- `src/features/reportes/components/ReportesDashboard.tsx`
- `src/config/version.ts` y `public/version.json` — bump a V00298.

## La causa
El reporte partía del SUBTOTAL guardado — que ya está en la MONEDA DE LA
FACTURA — y le aplicaba la fórmula que asume moneda del CONVENIO. En el
caso "convenio en Dólares + facturado en Pesos" eso multiplicaba el tipo
de cambio DOS VECES: subtotalProv $1,801.03 (ya en pesos) × 17.15 →
$30,892.53 en "Pesos Prov", y la utilidad salía en -28 mil.

## El arreglo
El desglose ahora parte de la MISMA base que el formulario Por Cobrar:
**monto del convenio + cargos adicionales (en la moneda del convenio)**
— totalAPagarProv + cargosAdicionalesProv en proveedor,
montoConvenioCliente + cargosAdicionales en cliente; el subtotal guardado
queda solo como respaldo para operaciones viejas sin esos campos. Con la
operación del ejemplo: Dólares Prov $0.00, Pesos Prov **$1,801.03**,
Conversión Prov $1,801.03 y utilidad $600.35 — exactamente lo que muestra
el formulario. La columna "Subtotal Prov" sigue mostrando el total en la
moneda de la factura. Aplica igual al lado cliente, al Excel y al PDF
(usan el mismo normalizador).

## Verificación
- `tsc --noEmit`: 0 errores. ESLint: 69 — idéntico a su base.
- `npm run build`: OK (PWA generada).
