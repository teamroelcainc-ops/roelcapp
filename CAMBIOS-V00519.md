# V00519 — Facturación: el documento se compara con el total y la diferencia va a costos adicionales · cliente y monto fijos en Editar factura

**Solo web.** Va encima de la V00518. Sin funciones, reglas, índices, banderas ni dependencias. Escribe datos solo cuando tú confirmas poner una diferencia (una factura a la vez).

## Qué cambia

### 1. El documento se compara con el TOTAL
Aplica al subir un PDF o XML y a **Analizar documento**.
- El monto de la factura en la app se compara con el **total** del documento.
- Si la factura de la app **no lleva los impuestos** y coincide con el **subtotal**, también está bien. Por ejemplo, F1072: subtotal $135,000 y total $156,600 con IVA. Así no se sugiere el IVA como diferencia.
- Si no coincide con ninguno, la diferencia se calcula contra el más cercano y lo dice: "Ese total no concuerda…" o "Ese subtotal no concuerda…".
- El costo de cada operación también acepta el importe con impuestos (el concepto del SIT viene sin IVA).
- Se leen también las **referencias viejas** como **TR46028-05**. Antes salía "el documento no trae números de referencia".

### 2. Poner la diferencia en costos adicionales
En la Ficha de Factura → Analizar documento.
- Cuando el monto no coincide, aparece **"Diferencia de +X con el total del documento"** y el botón **Poner la diferencia en costos adicionales**.
- Escribes cuánto va a **cada operación**, en la moneda de la factura. Viene puesto en la operación cuyo costo no cuadra. La suma debe dar la diferencia; puede ir con signo menos.
- La **observación** viene escrita ("Diferencia con la factura I8663 (29/10/2026): el documento dice … y la app …") y se puede cambiar.
- **Revisar los cambios** muestra cómo quedan:
  - por operación, sus costos adicionales y lo que cobra;
  - el total de la factura.
- **Confirmar y guardar**, en una sola transacción:
  - en cada operación:
    - suma la diferencia a **Cargos Adicionales**, en la moneda de su convenio; se convierte con su T.C. para que en la factura dé justo lo escrito;
    - agrega la observación en **Observaciones de costos adicionales**;
    - actualiza su **Por Cobrar**;
    - guarda de dónde salió (`diferenciaFacturaAplicada`);
  - en la factura: su renglón de esas operaciones, su **total** (se le suma la diferencia: respeta un total que ya traía IVA), su saldo y su status de pago.
- La factura no puede quedar por debajo de lo ya pagado. Si pasa, lo dice y no guarda nada.
- No se ofrece cuando:
  - la factura está cancelada;
  - está en varios registros con el mismo folio;
  - solo tiene las referencias (sin sus operaciones ligadas);
  - o está encendida la bandera **dineroPorServidor** (el servidor no deja escribir la factura desde la web).
- Queda en la bitácora.

### 3. Editar factura: cliente / proveedor y monto ya no se cambian ahí
En Clientes y en Proveedores.
- El **cliente** (o **proveedor**) se muestra fijo, con la nota "Para cambiarlo, cámbialo primero en cada operación de la factura". Solo se puede elegir si la factura todavía no tiene uno.
- El **Total facturado** se muestra fijo: sale de sus operaciones. Para cambiarlo, corrige el costo en cada operación (en Clientes, también con la diferencia de Analizar documento).
- Lo demás (número, fecha, status, CCP, documentos) se sigue editando igual.

## Archivos (21)
- `src/features/facturacion/services/diferenciaEnCargos.ts` (nuevo) y `diferenciaEnCargos.test.ts` (nuevo)
- `src/features/facturacion/components/DiferenciaEnCargos.tsx` (nuevo) y `DiferenciaEnCargos.css` (nuevo)
- `src/features/facturacion/services/documentoFactura.ts` y `documentoFactura.test.ts`
- `src/features/facturacion/services/leerCfdi.ts` y `leerCfdi.test.ts`
- `src/features/facturacion/services/leerFacturaPdf.ts`
- `src/features/facturacion/components/RevisionDocumentosFactura.tsx`
- `src/features/facturacion/components/DocumentoFichaCliente.tsx` y `DocumentoFichaCliente.test.tsx`
- `src/features/facturacion/components/FacturacionClientesDashboard.tsx` y `.css`
- `src/features/facturacion/components/FacturacionProveedoresDashboard.tsx` y `.css`
- `src/config/version.ts`, `public/version.json`, `src/config/historialCambios.ts`, `code-notes.md`, `CAMBIOS-V00519.md`

## Pasos manuales
1. Aplica el zip encima de la V00518 (no hay archivos borrados) y haz el commit: el conteo debe dar **21**.
2. Push y publicar: `npm run build` y `npx wrangler deploy`.
3. Prueba con una factura que no cuadre (por ejemplo la I8663): Analizar documento → Poner la diferencia en costos adicionales → Revisar los cambios → Confirmar. Debe quedar ✅.
