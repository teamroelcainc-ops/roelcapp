# V00411 — Resumen del día renovado

1. **Tipo de cambio + Diesel en una tarjeta** (dos columnas) con la equivalencia por litro.
2. **TC una vez al día** ("Capturar TC" solo si falta el de hoy). **Diesel: el costo MÁS BAJO** capturado
   hoy (con el proveedor; el detalle dice de cuántas capturas). Botón "Agregar diesel" siempre visible,
   porque el costo puede cambiar en el día o por proveedor.
3. **Puentes = pestaña Saldo**: solo cuentan los puentes con saldo agregado (por id o nombre) y se descuenta
   el Historial de referencias + Otros Cruces desde su primer saldo → el saldo restante coincide con la
   suma de Balance de Referencias de Puentes → Saldo. Colombia: bloques Caseta y Puente con su restante
   y lo de hoy.
4. **Nueva tarjeta "Saldo Diesel"** (TarjetaSaldoDiesel.tsx): misma cuenta que Referencias del Diesel →
   Saldos; saldo restante total, restante por proveedor (hasta 3) y cargas de hoy.
5. **Diseño**: 7 tarjetas del mismo tamaño, fondo con brillo del color de cada tarjeta, filas compactas
   etiqueta/valor, botones al pie alineados, hover sutil; responsive 7 → 4 → 2 → 1 columnas.

## Archivos
src/App.tsx, src/App.css
src/features/operaciones/components/{TarjetaCasetas.tsx, TarjetaSaldoDiesel.tsx (nuevo)}
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint App 71 (antes 72), tarjetas 0; build OK.
