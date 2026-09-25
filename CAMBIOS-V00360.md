# V00360 — Peaje al marcar VERDE · gasto del día en la tarjeta · modal con puente

## Archivos que cambian (respetar rutas)
- `src/features/operaciones/components/OperacionesDashboard.tsx`
- `src/features/operaciones/components/TarjetaCasetas.tsx` y `.css`
- `src/config/historialCambios.ts` + `src/config/version.ts` + `public/version.json` — V00360.

## 1) El peaje se descuenta al marcar VERDE (en los horarios)
Tal cual el proceso real:
- **Verde USA** (importación) → descuenta el peaje de **Caseta AVI** en
  dólares ($23.75).
- **Verde MX** (exportación) → descuenta el peaje de **Caseta Puente
  III** en pesos ($144.00).
El descuento se registra en la operación al marcar ese status en los
horarios de la ficha; al COMPLETAR queda como respaldo (por tráfico) si
el verde no se registró. Nunca se cobra dos veces la misma operación, y
el monto usa la tarifa vigente del catálogo Tipos de Gastos.

## 2) La tarjeta muestra lo GASTADO HOY por moneda
"Casetas del día" ahora enseña el **total en Dólares** y el **total en
Pesos** gastados hoy en cruces (suma de los peajes descontados con fecha
de hoy), en vivo.

## 3) El modal "＋ Actualizar saldo" — con tus 5 campos
- **Puente**: lista desplegable con TODOS los puentes del catálogo.
- **Moneda**: la del puente elegido, no editable.
- **Saldo a agregar**.
- **Saldo pendiente por puente**: lo disponible de ese puente hoy.
- **Total**: agregar + pendiente, en vivo.
La recarga queda en Saldos de Puentes (mismo flujo del módulo).

## Nota técnica
El disparo por Verde vive en "Registrar Status" de la ficha (el camino
de los horarios). No toqué FormularioOperacion en esta entrega para no
pisar tu V00356 — si también quieres el disparo por verde al guardar
desde el formulario, mándame tu FormularioOperacion.tsx actual y lo
integro.

## Verificación
- `tsc --noEmit` ✓ · eslint: Operaciones 127 = baseline exacto,
  tarjeta 0 · `npm run build` ✓

## Al instalar
Reemplaza los archivos + versión, `npm run build` y publica.
