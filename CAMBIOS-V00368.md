# V00368 — Saldos de Puentes como LIBRO CONTABLE · sin "Registrar Status"

## Archivos que cambian (respetar rutas)
- `src/features/saldosPuentes/components/SaldosPuentesDashboard.tsx` y `.css`
- `src/features/operaciones/components/OperacionesDashboard.tsx`
- `src/config/historialCambios.ts` + `src/config/version.ts` + `public/version.json` — V00368.

## 1) El módulo ahora es un LIBRO DE ASIENTOS por puente
- Arriba quedan las 2 tarjetas del disponible por moneda (con su 📜).
- Debajo, **chips con cada puente y su disponible** (verde/amarillo/
  rojo según el semáforo) — presiona uno para abrir su libro.
- El **libro del puente**: cabecera con el DISPONIBLE grande (y la
  alerta si va bajo) y la tabla de asientos:
  **Fecha | Movimiento | Cargo (−) | Abono (+) | Saldo**
  Las recargas ABONAN (+ verde), cada cruce CARGA (− rojo con su
  referencia), y la columna Saldo lleva el corrido — siempre sabes
  cuánto queda después de cada movimiento. Las recargas llevan 🗑
  ahí mismo. Todo en vivo.
- La parrilla de tarjetas y la tabla de recargas de abajo se
  sustituyen por este libro (misma información, en forma contable).

## 2) Ficha de Operaciones sin "Registrar Status"
El botón naranja "+ Registrar Status" salió del Detalle de Operación —
los status se marcan con los botones de SIGUIENTE PASO (y esos siguen
cobrando el peaje al marcar Verde).

## Verificación
- `tsc --noEmit` ✓ · eslint: Operaciones 127 = baseline, Saldos 0 ·
  `npm run build` ✓

## Al instalar
Reemplaza los archivos + versión, `npm run build` y publica.
