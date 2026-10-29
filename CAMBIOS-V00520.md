# V00520 — Facturación de Clientes: abrir la factura desde Facturas Listadas · editar sus operaciones desde la factura · Editar factura más ancha y con Actualizar

**Solo web.** Va encima de la V00519. Sin funciones, reglas, índices, banderas ni dependencias. Escribe datos solo cuando presionas Actualizar (una factura a la vez).

## Qué cambia

### 1. Abrir la factura desde Facturas Listadas
En Historial de Facturas → la tarjeta **Facturas Listadas** (y Ops. Facturadas, Total USD y Total MXN).
- Cada factura de la lista es un botón: con un clic se abre su **Ficha de Factura**.
- La Ficha se abre encima de la lista; al cerrarla vuelves a la lista.

### 2. Editar las operaciones desde la factura
- En la Ficha, cada operación tiene **✎ Editar**: abre el formulario completo de la operación, con la Ficha detrás.
- Sigue igual el clic en la operación (su detalle) y su botón **✎ Editar operación**.
- Las operaciones guardadas solo con su referencia (sin la operación ligada) no tienen ✎ Editar.
- Al guardar la operación desde la Ficha sale el aviso: "Si cambió su costo, abre Editar factura: ahí se ve el cambio y al presionar Actualizar la factura se pone al día".

### 3. Editar factura
- Es más ancha: 1040 px (antes 640 px).
- Abajo dice **Operaciones de la factura (N)**:
  - cada una con su referencia, su convenio, lo que cobra en la factura y **✎ Editar** (el formulario completo, encima);
  - al guardar la operación, la lista se pone al día sola.
- El botón **Guardar cambios** ahora se llama **Actualizar**:
  - nada se guarda hasta presionarlo;
  - solo se activa cuando algo cambió (número, fecha, status, CCP, documentos, cancelación, o el costo de una operación). Si regresas un campo a como estaba, se vuelve a apagar.

### 4. Actualizar pone la factura al día con sus operaciones
- Si el costo de una operación de la factura ya no es el de su renglón, Editar factura lo marca: "En la factura 70.00 → hoy 75.00 USD".
- Abajo dice "1 operación cambió de costo. Al presionar Actualizar, la factura toma el costo de hoy: total 270.00 → 275.00 USD".
- Al presionar **Actualizar**, en una sola transacción que relee la factura y sus operaciones:
  - el renglón de esa operación toma lo que cobra hoy;
  - el total sube o baja la **misma diferencia**. Así un total que ya traía IVA lo conserva;
  - también se ajustan la conversión, el total manual (si lo tenía), el saldo y el status de pago.
- La factura no puede quedar en 0 ni por debajo de lo ya pagado. Si pasa, lo dice y no guarda ese ajuste.
- Queda en la bitácora.
- No se pone al día desde aquí (lo dice en lugar del total nuevo):
  - con la bandera **dineroPorServidor** encendida;
  - en un folio con varios registros;
  - en una factura que no guardó lo que cobró cada operación (las viejas sin renglones). Para esas, Recalcular montos en Pagos.

### Lo que no cambió
- Facturación de Proveedores. Solo tiene los bloqueos de la V00519.
- Una factura emitida sigue sin cambiar sola cuando se edita una operación en otro lado. Cambia solo al presionar Actualizar en Editar factura.

## Archivos (13)
- `src/features/facturacion/services/sincronizarFactura.ts` (nuevo) y `sincronizarFactura.test.ts` (nuevo)
- `src/features/facturacion/hooks/useOperacionesDeFactura.ts` (nuevo)
- `src/features/facturacion/components/OperacionesFacturaEdicion.tsx` (nuevo) y `OperacionesFacturaEdicion.css` (nuevo)
- `src/features/facturacion/services/diferenciaEnCargos.ts` (exporta `importeRenglon`)
- `src/features/facturacion/components/FacturacionClientesDashboard.tsx` y `.css`
- `src/config/version.ts`, `public/version.json`, `src/config/historialCambios.ts`, `code-notes.md`, `CAMBIOS-V00520.md`

## Pasos manuales
1. Aplica el zip encima de la V00519 (no hay archivos borrados) y haz el commit: el conteo debe dar **13**.
2. Push y publicar: `npm run build` y `npx wrangler deploy`.
3. Prueba:
   1. Historial → Facturas Listadas → clic en una factura: se abre su Ficha.
   2. ✎ Editar en una operación, cambia su costo y guarda.
   3. Abre Editar factura: debe marcar el cambio. Presiona Actualizar y revisa el total nuevo.
