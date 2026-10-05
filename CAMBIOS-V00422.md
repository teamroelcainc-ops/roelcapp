# V00422 — Pestañas por tipo en Activas · Colombia cuadrado · Saldo de Diesel por día

1. **Operaciones Activas — pestañas**: Todos (por defecto) · Transfer · Logística Cruces · Logística
   Fletes · Rentas (y "Otros" solo si hay de otro tipo), cada una con su contador. Se combinan con la
   búsqueda y los filtros; la exportación usa lo que se ve.
2. **Tarjetas de puente = pestaña Saldo**: el saldo restante ya coincidía (AVI 1,172.80 · III 2,396.00 ·
   Colombia 3,008.70). En Colombia, "Caseta" salía en $0 porque se buscaba un saldo propio de la caseta;
   ahora caseta y puente se miden contra el saldo del PUENTE (777.60 + 540.00 = 1,317.60).
3. **Saldo del Diesel**: al agregar saldo, por defecto es GENERAL ("Todos los proveedores"; se puede
   elegir uno). Se descuenta el TOTAL CARGADO POR DÍA de las referencias del Historial desde la fecha
   del saldo. El detalle (asiento) muestra una fila por día (referencias, galones, cargo, saldo corrido);
   clic en el día → sus referencias; clic en una referencia → sus operaciones. La tarjeta "Saldo Diesel"
   usa la misma cuenta.
   Nota: usa saldo general O saldos por proveedor (si hay ambos, la misma carga descuenta de los dos).

## Archivos
src/features/operaciones/components/{OperacionesDashboard.tsx + .css, TarjetaCasetas.tsx, TarjetaSaldoDiesel.tsx}
src/features/diesel/components/ReferenciasDieselDashboard.tsx + .css
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint igual que antes; build OK.
