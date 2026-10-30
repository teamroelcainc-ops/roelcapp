# V00532 — Operaciones: "Corregir desglose" pone Total, Dólares y Pesos en la moneda de su Facturado en

**Solo web.** Va encima de la V00531. Sin funciones, reglas, índices, banderas ni dependencias.
**Escritura masiva:** solo con prueba (Excel), respaldo (JSON), la casilla de funciones V00496 y la autorización escrita **APLICAR**.

## Qué pasaba (TR-221026-023, factura E4542)
- Convenio de $120 Dólares, Facturado en **Pesos**, TC 18.6425.
- Subtotal y Conversión decían $2,237.10 (bien). Total decía 120, Dólares 120 y Pesos 0: el desglose seguía como si se facturara en dólares.
- Causa: a esas operaciones se les cambió Facturado en sin recalcular (antes de la V00490). Al facturarse quedaron con sus montos fijos (V00494).
- El dinero está bien: Facturación, Por Cobrar y la Utilidad usan la Conversión, que es correcta.

## Qué hace "Corregir desglose" (Operaciones, junto a Corregir monedas)
1. Al abrir, revisa todas las operaciones (sin las de prueba) **sin cambiar nada**: una lectura por operación.
2. Lista las que tienen Total, Dólares y Pesos en otra moneda que su Facturado en, Cliente y Proveedor, con su factura si ya están facturadas.
3. Pasos:
   1. Descargar la prueba (Excel): cada operación con Total, Dólares y Pesos de antes y de después, y su Conversión.
   2. Descargar el respaldo (JSON): los tres campos como están hoy.
   3. Marcar que las funciones del servidor ya están publicadas con la V00496 o una más nueva.
   4. Escribir **APLICAR** y Corregir.
- Pone esos tres campos como los calcula el formulario. Ejemplo: TR-221026-023 → Total $2,237.10, Dólares $0, Pesos $2,237.10.
- **No cambian:** la Conversión, la Utilidad, el monto del convenio ni las facturas.
- **No se tocan:** las que tienen una Conversión distinta de la que da su convenio, cargos, TC y monedas. Salen aparte para revisarlas en el formulario.
- Cada tanda de 100 se relee al escribir. Si una operación cambió desde la prueba, se salta y se dice por qué.
- Queda en la bitácora. Cada operación corregida lleva la marca `desgloseCorregido` (fecha y hora).

## Por qué la casilla de funciones V00496
- Total, Dólares y Pesos son campos de dinero: guardarlos hace que el servidor revise las facturas de esa operación.
- Con las funciones V00495/V00496, una factura emitida no cambia (solo se copian textos).
- Con funciones más viejas, la factura emitida se volvería a calcular.

## Archivos (13)
- `src/features/operaciones/services/corregirDesglose.ts` y `corregirDesglose.test.ts` (nuevos)
- `src/features/operaciones/services/corregirDesgloseDatos.ts` (nuevo)
- `src/features/operaciones/components/CorregirDesgloseModal.tsx`, `.css` y `CorregirDesglosePasos.tsx` (nuevos)
- `src/features/operaciones/components/PestanasOperaciones.tsx` y `.css` (botón)
- `src/config/version.ts`, `public/version.json`, `src/config/historialCambios.ts`, `code-notes.md`, `CAMBIOS-V00532.md`

## Pasos manuales
1. Aplica el zip encima de la V00531 (no hay archivos borrados) y haz el commit. El conteo debe dar **13**.
2. Publica la web.
3. **Antes de aplicar:** publica las funciones de la V00496 (`firebase deploy --only functions`) si no lo has hecho.
4. Operaciones → **Corregir desglose**: revisa la lista, baja la prueba y el respaldo, marca la casilla, escribe APLICAR.
5. Abre la TR-221026-023: Total $2,237.10, Dólares $0, Pesos $2,237.10.
