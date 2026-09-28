# V00388 — Aduana Colombia (2 cobros de puente) · aduana visible · subtotal a 2 decimales

## 1. Aduana visible
- Opciones del convenio ("Elige la tarifa" y la tabla Ver/editar): chip con la aduana de su tarifa.
- Resumen lateral de la operación → tarjeta Servicio: chip "Aduana …".
- Solo si la tarifa tiene aduana.

## 2. Subtotal a 2 decimales
- `convertirAMonedaFactura` redondea el monto convertido a centavos
  (antes 2567,9500000000003 → ahora 2567.95). Aplica a cliente y proveedor.

## 3–5. Aduana COLOMBIA = dos cobros (NUEVO src/utils/puenteColombia.ts)
- Caseta (cruzar): la de los Gastos Incluidos de la tarifa (Caseta Mx Colombia / Trompo Colombia).
  Sin caseta en la tarifa → Trompo Colombia si es trompo, si no Caseta Mx Colombia.
- Piso del puente: "Puente Mx Colombia" con el importe FIJO del catálogo Tipos de Gastos (hoy $90
  Pesos; si lo cambias allá, los cobros nuevos usan el nuevo monto). Se guarda en
  `saldoPuentePiso, saldoPuentePisoPuente, saldoPuentePisoMoneda, saldoPuentePisoFecha, saldoPuentePisoEvento`
  en el mismo momento que la caseta (mismo evento y fecha). Nunca se cobra dos veces.
- Nuevo Laredo (y cualquier otra aduana): un solo cobro, como antes.
- Dónde: formulario, Registrar Movimiento / Siguiente paso de Operaciones Activas.
- Saldos de Puentes y Tarjeta de casetas: el piso es un segundo cruce que descuenta de la cuenta
  "Puente Mx Colombia". Reporte: segunda fila por operación. Servicios Completados: "caseta + piso".
  Utilidad de la ficha: línea "− Puente Mx Colombia".
- Tarifas de Referencia: Colombia admite 1 caseta + 1 Puente Mx Colombia (avisos "Sin caseta",
  "N casetas", repetido); Nuevo Laredo sigue con UN solo gasto de puente.

## Nota
Operaciones Colombia que ya descontaron su caseta antes de esta versión no reciben el piso solas.
"Aplicar a operaciones" (Saldos de Puentes) no se modificó.

## Archivos
src/utils/puenteColombia.ts (nuevo)
src/features/operaciones/components/{FormularioOperacion.tsx, FormularioOperacion.css, OperacionesDashboard.tsx, ServiciosCompletados.tsx, TarjetaCasetas.tsx}
src/features/saldosPuentes/components/SaldosPuentesDashboard.tsx
src/features/catalogos/components/CatalogosDashboard.tsx
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint igual a la base en los 7 archivos; build OK.
