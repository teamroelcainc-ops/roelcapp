# V00369 — Reporte de saldos del puente · regla de aplicación del peaje

## Archivos que cambian (respetar rutas)
- `src/features/saldosPuentes/components/SaldosPuentesDashboard.tsx` y `.css`
- `src/features/operaciones/components/OperacionesDashboard.tsx`
- `src/features/operaciones/components/FormularioOperacion.tsx`
- `src/config/historialCambios.ts` + `src/config/version.ts` + `public/version.json` — V00369.

## 1) La regla del peaje, aplicada en TODOS los caminos
El descuento del saldo del puente aplica ÚNICAMENTE a:
1. **Transfer** — siempre.
2. **Logística de Cruces** — solo si el proveedor es **Roelca**.
3. **Logística de Fletes** — NUNCA (aunque el proveedor sea Roelca;
   este caso se corrigió también en el formulario, que antes lo dejaba
   pasar).
La regla vive en el cobro por Verde/Completado (ficha, registro manual
y formulario), en el botón 🧮 y en la alerta 🌉⚠ de la fila (que ahora
también avisa en Logística de Cruces con Roelca).

## 2) Reporte "📊 Reporte" en Saldos de Puentes
Botón nuevo en la cabecera del módulo. Lista TODAS las operaciones que
cruzan puente (las de la regla, sin canceladas) con:
- **Fecha de Servicio** · **# Referencia** · **Tipo de Operación** ·
  **Tráfico** (Importación/Exportación) · **Puente** por el que cruzó
  (si aún no descuenta, el que le toca por su tráfico) · **Saldo del
  Puente** — el monto descontado, o **"🌉⚠ Sin descuento"** en ámbar
  si todavía no marca Verde.
- Rango de fechas (vacío = todo), contador de operaciones y de "sin
  descuento", totales descontados por moneda al pie, y **⬇ Excel**.

## Verificación
- `tsc --noEmit` ✓ · eslint: Operaciones 127, Formulario 377,
  Saldos 0 — baselines exactos · `npm run build` ✓

## Al instalar
Reemplaza los archivos + versión, `npm run build` y publica.
