# V00527 — Facturación de Clientes: cada operación cuenta con su TOTAL, no con el subtotal

**Solo web.** Va encima de la V00526. Sin funciones, reglas, índices, banderas ni dependencias. Escribe solo al presionar Actualizar (una factura) o con Completar importes (prueba → respaldo → APLICAR).

## El caso (factura 39802)
- La operación **TR-241026-005** tiene Subtotal **$140** y Cargos adicionales **$250** ("Servicio de Grúa"): su **Total** es **$390**.
- La factura 39802 dice **$390**, pero la Ficha mostraba la referencia en **$140**. La factura guardó el subtotal de la operación antes de que se capturaran los cargos.
- Peor: con la V00520, Actualizar habría **sumado otra vez** los $250 y la factura habría quedado en $640.

## Qué cambia
1. **Ficha de Factura**:
   - si el total de hoy de una operación no es el que guardó la factura, sale **$140.00 tachado → hoy $390.00**;
   - arriba aparece el aviso con el enlace a **Editar factura**.
2. **Editar factura → Actualizar**: guarda el **total de hoy de cada operación** (con sus cargos adicionales). El total de la factura:
   - **no cambia** si ya lo incluía (caso 39802). Lo dice: "El total de la factura ($390.00) no cambia: ya lo incluía";
   - sube o baja la diferencia si la factura cuadraba con sus renglones (o con su IVA), como en la V00520;
   - **no cambia** si la factura no cuadraba con sus operaciones ni cuadra con lo de hoy: se guardan los importes y sigue en Corregir con la diferencia real.
3. **Corregir → Completar importes** también **pone al día** las facturas que guardaron importes viejos, **solo si con el total de hoy de sus operaciones cuadran** con su total. Las demás se quedan para revisarlas a mano.
   - Mismos tres pasos: prueba → respaldo → APLICAR.
   - La prueba trae "Referencias antes (en la factura)" y "Referencias (total de hoy)".
   - El respaldo guarda los renglones de antes para poder deshacer.
   - La tabla de Corregir dice "Con el total de hoy, cuadra".
4. **Datos para la Factura** y **Reporte por facturar**: el importe dice **"Total (sin IVA)"** en lugar de "Subtotal". Siempre fue el total de la operación con sus cargos adicionales; ahora lo dice.

## Archivos (17)
- `src/features/facturacion/services/sincronizarFactura.ts` y `sincronizarFactura.test.ts`
- `src/features/facturacion/services/completarImportes.ts` y `completarImportes.test.ts`
- `src/features/facturacion/services/reportePorFacturar.ts` y `reportePorFacturar.test.ts`
- `src/features/facturacion/components/OperacionesFacturaEdicion.tsx`
- `src/features/facturacion/components/CompletarImportes.tsx`
- `src/features/facturacion/components/CorregirTotalesFacturas.tsx`
- `src/features/facturacion/components/DatosSitModal.tsx`
- `src/features/facturacion/components/FacturacionClientesDashboard.tsx` y `.css`
- `src/config/version.ts`, `public/version.json`, `src/config/historialCambios.ts`, `code-notes.md`, `CAMBIOS-V00527.md`

## Pasos manuales
1. Aplica el zip encima de la V00526 (no hay archivos borrados) y haz el commit: el conteo debe dar **17**.
2. Publica la web (`npm run build` y `npx wrangler deploy`).
3. Prueba con la 39802:
   1. La Ficha dice "$140.00 → hoy $390.00".
   2. Editar factura → Actualizar: TR-241026-005 queda en $390.00 y el total sigue en $390.00.
4. Después, en Corregir → Completar importes, la prueba dice cuántas facturas se ponen al día así.
