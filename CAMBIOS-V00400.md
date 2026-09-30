# V00400 — Saldos de Diesel (Referencias del Diesel)

- Nueva pestaña "Saldos" (entre Asignar Operaciones e Historial) con "+ Agregar saldo".
- Formulario y columnas: Fecha, Hora, Proveedor (proveedores de diesel), Saldo inicial y Moneda.
  Se guarda en la colección nueva `saldos_diesel` (con quién lo registró, oculto).
- Descuento: las referencias del Historial del MISMO proveedor desde la fecha del saldo; el monto de
  cada una es su Total Cargado (galones cargados × costo del diesel). Primero se consume el saldo más
  antiguo; balance negativo = sobregiro.
- Columnas por saldo: Cargas (N ref. · galones), Monto cargado, Balance y Alcanza para
  (balance ÷ costo más reciente de ese proveedor = galones).
- Clic en la fila → ASIENTO contable: resumen + tabla Fecha · # Referencia · Unidad · Galones ·
  Cargo (−) · Abono (+) · Saldo corrido, con totales. Clic en una referencia → sus operaciones
  (ref, fecha de servicio, tipo, convenio, diesel).
- El Historial ahora lee hasta 3,000 referencias (antes 400) para que los saldos cuadren.

## Nota
Firestore: la colección nueva `saldos_diesel` necesita las mismas reglas de lectura/escritura que
`saldos_puentes`.

## Archivos
src/features/diesel/components/ReferenciasDieselDashboard.tsx + .css
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint igual a la base (86); build OK.
