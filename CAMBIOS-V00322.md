# V00322 — Auditoría: más ancha, EN VIVO, con detalle/edición, problemas resaltables y monedas marcadas

## Archivos que cambian (respetar rutas)
- `src/features/facturacion/components/AuditoriaCadenaCliente.tsx` y `.css`
- `src/config/version.ts` + `public/version.json` — V00322.

## 1) Ventana más ancha
El modal crece a 1760px (98% del ancho en pantallas menores).

## 2) 👁 Detalle y ✎ Editar en cada tarjeta — y TODO EN VIVO
- Cada operación, factura y pago trae botones 👁 (detalle completo de
  todos sus campos) y ✎ (editar).
- **Operación** → abre el FORMULARIO REAL de edición de operaciones (el
  mismo de Pagos/Facturación).
- **Factura** → editor directo de invoice, fecha y total (valida que no
  quede debajo de lo ya pagado y recalcula el saldo solo). El desglose de
  operaciones se edita en Facturación.
- **Pago** → editor directo de fecha, método, referencia y observaciones.
  El monto y las facturas aplicadas se editan en Pagos (redistribuyen
  saldos).
- **BASE RELACIONAL EN VIVO**: el auditor ya no descarga una vez — se
  SUSCRIBE (onSnapshot) a las operaciones, facturas y pagos del cliente
  auditado. Cualquier edición (desde aquí o desde su módulo) recalcula
  los veredictos y montos AL MOMENTO, sin volver a presionar Auditar.

## 3) Clic en la tarjeta de problemas
La tarjeta "⚠ N problema(s)" ahora es un botón: al hacer clic se
RESALTAN en rojo, en las tres columnas, las operaciones con problema, sus
facturas involucradas, las facturas descuadradas y los pagos que
participan — el resto se atenúa. Otro clic lo apaga (y es excluyente con
el camino morado de una operación seleccionada).

## 4) Moneda que no concuerda con la del cliente
Si el cliente tiene moneda USD o MXN, todo chip de moneda distinto se
marca en ÁMBAR con ⚠ (operaciones, facturas y pagos), con la explicación
al pasar el mouse.

## Verificación
- `tsc --noEmit` ✓ · eslint del componente en 0 · `npm run build` ✓

## Al instalar
Reemplaza los 2 archivos + versión, `npm run build` y publica.
