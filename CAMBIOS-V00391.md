# V00391 — Tarjetas del resumen del día con un solo diseño

## Qué cambió
- Clases compartidas `rd-*` (App.css): misma altura (`grid-auto-rows: 1fr`), mismo padding,
  franja de color a la izquierda por tarjeta, etiqueta en mayúsculas, cifra principal con dígitos
  tabulares, detalle en gris y botón al pie (siempre a la misma altura).
- 7 tarjetas en una fila en pantallas ≥1200 px; 4 por fila en pantallas medianas; 2 en tablet/teléfono.
- Operaciones del día: meta del día como texto (sin emojis) y botón "Metas por día".
- Completadas hoy: barra de avance del día.
- Tipo de cambio / Diesel: mismo formato; "Capturar el de hoy" al pie cuando falta.
- Puente AVI, Puente III y Puente Colombia: cifra principal = saldo disponible (rojo si está
  sobregirado), chip de moneda, gastado hoy con número de cruces (clic = lista del día; Colombia en
  dos filas: Caseta y Puente) y "Actualizar saldo" al pie.
- Se quitaron los estilos inline de las tarjetas (ahora todo es CSS).

## Archivos
src/App.tsx, src/App.css
src/features/operaciones/components/TarjetaCasetas.tsx
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint igual que antes (App 72, TarjetaCasetas 0); build OK.
