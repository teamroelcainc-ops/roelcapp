# V00524 — Facturación de Clientes: Completar importes en la pestaña Corregir

**Solo web.** Va encima de la V00523. Sin funciones, reglas, índices, banderas ni dependencias.
**Escribe datos solo cuando tú lo autorizas** (paso 3, APLICAR). Es una escritura masiva: unas 4,290 facturas.

## Qué hace
En **Corregir**, arriba de la tabla, está el botón **Completar importes (N)** para las facturas que "no guardaron lo que cobró cada operación".
- A cada una le guarda su **desglose**: un renglón por operación con lo que cobra **hoy**. Es el mismo renglón que guarda Facturar.
- **El total no cambia:**
  - si la factura ya tenía su total guardado, se queda igual;
  - si no lo tenía (las de AppSheet, que solo traen el total en otro campo), se guarda **el mismo total que ya muestra**. Así, al tener renglones, no se calcula de ellos;
  - antes de escribir se comprueba que el total que se ve sea el mismo después. Si no, esa factura no se completa.
- Después:
  - las que cuadran salen de Corregir;
  - las demás pasan a **"Sus operaciones no suman el total"**, con la diferencia por referencia.

## Los tres pasos (no se pueden saltar)
1. **Descargar la prueba (Excel)**:
   - lee una vez las operaciones de esas facturas;
   - por cada factura dice si se completa, sus referencias con lo que cobra hoy cada una, cuánto suman, la diferencia con el total, si cuadra y si se guarda el mismo total;
   - las que no se pueden salen con su motivo;
   - lo que se aplica es exactamente lo de esta prueba.
2. **Descargar el respaldo** (JSON): para deshacer, en cada factura se quitan `operacionesGuardadas` e `importesCompletados`. Si `fijoTotal` es true, también `subtotalMonedaFactura`.
3. **Escribir APLICAR** → **Completar N facturas**:
   - va en transacciones de 20 que releen cada factura y sus operaciones;
   - lo que cambió desde la prueba no se toca y se dice.

## No se completan (quedan para revisarlas a mano)
- Solo guardaron las **referencias**, no las operaciones ("sin monto").
- Una operación **no existe** o **está en otra factura** (otro folio).
- La factura **no tiene moneda**, **no tiene total** o tiene su total guardado en $0.00.
- Sus operaciones hoy cobran $0.00.
- Con la bandera **dineroPorServidor** encendida el botón no se ofrece: las reglas no dejan escribir los renglones desde la web.

## Archivos (11)
- `src/features/facturacion/services/completarImportes.ts` (nuevo) y `completarImportes.test.ts` (nuevo)
- `src/features/facturacion/components/CompletarImportes.tsx` (nuevo) y `CompletarImportes.css` (nuevo)
- `src/features/facturacion/components/CorregirTotalesFacturas.tsx`
- `src/features/facturacion/components/FacturacionClientesDashboard.tsx`
- `src/config/version.ts`, `public/version.json`, `src/config/historialCambios.ts`, `code-notes.md`, `CAMBIOS-V00524.md`

## Pasos manuales
1. Aplica el zip encima de la V00523 (no hay archivos borrados) y haz el commit: el conteo debe dar **11**.
2. Push y publicar: `npm run build` y `npx wrangler deploy`.
3. Corregir → Completar importes:
   1. Descarga la prueba y revísala. Fíjate sobre todo en "Total (no cambia)" y en las que "no cuadran".
   2. Descarga el respaldo y guárdalo.
   3. Escribe APLICAR.
   4. Al terminar, **Revisar de nuevo**: "No guardó…" debe quedar solo con las que no se pueden.
4. Lecturas: la prueba lee una vez las operaciones (unas 5 mil). Aplicar relee cada factura y sus operaciones (unas 9 mil lecturas en total) y escribe unas 4,290 facturas.
