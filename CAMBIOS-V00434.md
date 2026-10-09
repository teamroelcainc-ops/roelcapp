# V00434 — Trompos de Roelca no cobrables

Regla: un TROMPO (convenio o carga con "trompo") cuyo **Cliente (Paga) es Roelca** es NO COBRABLE.

## Formulario de la operación
- El Subtotal (montoConvenioCliente) se pone en $0 automáticamente y se guarda en $0, con
  noCobrable: true y motivoNoCobrable: 'Trompo de Roelca'.
- Aviso ámbar bajo el Subtotal: "🚫 Trompo de Roelca: NO COBRABLE".

## Resumen Diario de Operaciones (Transfer, Logística y Fletes)
- Esos trompos ya NO cuentan en "TROMPO"; cuentan en "OTROS NO COBRABLES" (antes siempre 0).
- Se restan de "REF. COBRABLES".
- "OTROS NO COBRABLES" también suma operaciones con status "No cobrable" que no estén canceladas.

## Nota
Las operaciones YA guardadas toman el $0 cuando se abren y se guardan desde el formulario. El reporte
las clasifica bien desde ya, sin tocarlas.

## Archivos
src/features/operaciones/components/FormularioOperacion.tsx + .css
src/features/reportes/components/ResumenDiarioOperaciones.tsx
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint igual que antes (Formulario 376, Resumen 37); build OK.
