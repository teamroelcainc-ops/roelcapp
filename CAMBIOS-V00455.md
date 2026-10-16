# V00455 — Tarjetas de Operaciones Activas: completadas, TC / Diesel y saldos de puente

**Solo web** (deploy de hosting de siempre). Sin reglas, índices, banderas ni Cloud Functions.

## Qué cambia
1. **Completadas hoy** ya no es una tarjeta aparte: queda dentro de **Operaciones del día**, con el número, el porcentaje, la barra de avance y el desglose por tipo (Logística Cruces, Transfer, Logística Fletes, Renta).
2. **Tipo de cambio** y **Diesel** tienen cada uno su tarjeta, con su botón (Capturar TC / Capturar o Agregar diesel). El Diesel sigue mostrando el más bajo del día y su equivalencia por litro.
3. **Actualizar saldo** en una tarjeta de puente abre el **mismo formulario "Agregar saldo"** de Referencias de Puentes → Saldo (Fecha, Hora, Puente, Saldo inicial, con "Editar formulario") y guarda en sus **Saldos**, igual que desde ese módulo (también queda quién lo registró).
4. El puente viene **elegido** según la tarjeta: Puente AVI → Caseta AVI · Puente III → Caseta Puente III · Puente Colombia → Caseta Mx Colombia. Se puede cambiar en la lista.
5. Al **presionar una tarjeta de puente** se abre la tabla de **movimientos de su saldo**, con las columnas del Historial de referencias (# Referencia, Puente, Fecha, Hora, Referencias seleccionadas, Total a pagar) y **rango de fechas** (Desde / Hasta, y Hoy · 7 días · 30 días · Todo). Por defecto, los últimos 30 días. Además de las referencias que lo descuentan, salen los **saldos agregados** (en azul, con quién los registró). Arriba: saldo agregado y descontado en el rango; abajo: referencias, operaciones y total. Los botones de adentro de la tarjeta ("Hoy · N cruces", "Actualizar saldo") siguen haciendo lo suyo.

## Técnico
- Nuevos: `src/features/puentes/components/ModalAgregarSaldoPuente.tsx/.css` (prefijo `masp-`), `src/features/puentes/services/puentesCatalogo.ts` y `saldosPuentes.ts`, `src/features/operaciones/components/ModalMovimientosPuente.tsx/.css` (prefijo `tmov-`), `src/features/operaciones/services/movimientosPuente.ts` (+ pruebas).
- `ReferenciasPuentesDashboard.tsx`: el modal "Agregar saldo" es el componente compartido; la lista, el nombre y la moneda de los puentes salen de `puentesCatalogo.ts`. ESLint del archivo: un `any` menos (línea base bajada).
- `TarjetaCasetas.tsx`: guarda las referencias y saldos que ya escuchaba (para el modal); se quitó su modal propio de recarga; los dos modales se cargan al abrirlos.
- `App.tsx` / `App.css`: tarjetas Operaciones del día (con completadas), Tipo de cambio y Diesel; se quitaron las reglas `.rd-dos*`.
- Lecturas de Firestore: **ninguna nueva** (el modal usa los listeners que ya tenían las tarjetas).
- Carga inicial: +0.3 KB.
- Banco de pruebas (app con Firebase simulado): Actualizar saldo en las 3 tarjetas (caseta elegida correcta; el saldo se guarda con fecha, hora, puente, moneda y quién lo registró; la tarjeta sube al instante), movimientos de AVI y Colombia con rango, Hoy, Todo y un rango sin datos, "Hoy · cruces" sigue abriendo su lista, y "+ Agregar saldo" en Referencias de Puentes. Sin errores de consola.

## Qué revisar con datos reales
1. Operaciones Activas: Operaciones del día muestra "Completadas hoy"; TC y Diesel en tarjetas separadas.
2. Puente AVI → Actualizar saldo: abre "Agregar saldo" con Caseta AVI. Cancela (o guarda un saldo real si toca).
3. Presiona la tarjeta Puente AVI: la tabla de movimientos con las referencias de los últimos 30 días; cambia las fechas.
