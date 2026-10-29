# V00523 — Facturación de Clientes: Corregir muestra las referencias con sus montos y abre la factura con un clic

**Solo web.** Va encima de la V00522. Sin funciones, reglas, índices, banderas ni dependencias. **No escribe datos.**

## Qué cambia
En la pestaña **Corregir**:
- **Clic en la factura** (en cualquier parte de la fila) abre su **Ficha**. El invoice es el botón, para usarlo con el teclado. Se quitó la columna "Ver factura".
- Columna nueva, **Referencias**: cada referencia con lo que cobra **en la factura**.
  - Si hoy la operación cobra otra cosa, el monto de la factura sale tachado y al lado **→ hoy $…** en amarillo. Por ejemplo: `$ 120.00` tachado → hoy `$ 150.00`.
  - Si la factura no guardó lo que cobró cada operación, sale solo **hoy $…** (lo que cobra hoy).
  - **sin monto**: la factura solo guardó la referencia (no la operación) o la operación ya no existe.
  - Hasta 6 referencias por factura; si tiene más, dice "+N más (en la factura)".
- En **Motivo** dice, con el costo de hoy de sus operaciones:
  - **"Con el costo de hoy, cuadra."** en verde;
  - o "Con el costo de hoy suman $…".
- Para eso se leen **solo las operaciones de las facturas que se ven** (300 a la vez; cada una una sola vez).
- **Nada se modifica**: ni los totales ni las operaciones.

## Archivos (11)
- `src/features/facturacion/hooks/useOperacionesPorId.ts` (nuevo)
- `src/features/facturacion/components/CorregirTotalesFacturas.tsx` y `.css`
- `src/features/facturacion/services/cuadreFactura.ts` y `cuadreFactura.test.ts`
- `src/features/facturacion/components/FacturacionClientesDashboard.tsx`
- `src/config/version.ts`, `public/version.json`, `src/config/historialCambios.ts`, `code-notes.md`, `CAMBIOS-V00523.md`

## Pasos manuales
1. Aplica el zip encima de la V00522 (no hay archivos borrados) y haz el commit: el conteo debe dar **11**.
2. Push y publicar: `npm run build` y `npx wrangler deploy`.
3. Prueba: Corregir → "No guardó lo que cobró cada operación". Cada referencia debe traer "hoy $…" y el motivo, si cuadra con el costo de hoy. Clic en una fila → su Ficha.
