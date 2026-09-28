# V00384 — Siguiente paso pide fecha y hora · ficha sin Proveedores en flota propia

## 1. Botones de SIGUIENTE PASO piden fecha y hora
- Nuevo componente ModalFechaStatus (.tsx/.css): "Registrar Movimiento" con el estatus del botón
  y Fecha y Hora precargadas con la hora actual (se pueden cambiar). Enter = Guardar.
- Guardar registra el estatus (con su cascada automática) usando ESA fecha/hora en la bitácora.
- El cruce del puente (Verde / paso que descuenta) queda con la fecha capturada; lo mismo en el
  Registrar Movimiento manual (antes tomaba siempre la fecha de hoy).
- Aplica en Operaciones Activas y Servicios Cancelados (donde existen esos botones).

## 2. Ficha sin la parte de Proveedores en flota propia
- Transfer, y Logística de Cruces con Proveedor de Transporte Roelca: en la pestaña
  "Unidad y Operador" se ocultan Proveedor de Transporte, Facturado En, Convenio Proveedor, Monto a
  Pagar, Costos Adicionales, Subtotal y la conversión. Se sigue viendo Flota Operativa (Roelca).
- Operaciones Activas y Servicios Completados. (El formulario ya lo ocultaba.)

## Archivos
src/features/operaciones/components/{ModalFechaStatus.tsx, ModalFechaStatus.css (nuevos),
OperacionesDashboard.tsx, ServiciosCancelados.tsx, ServiciosCompletados.tsx}
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint igual a la base (Activas 126, Completados 163, Cancelados 139; modal 0); build OK.
