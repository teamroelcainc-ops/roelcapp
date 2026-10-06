# V00427 — Carta de Instrucciones según el tipo de operación

1. FECHA DE CITA y HORA DE CITA: solo en Logística Fletes.
2. NÚMERO ECONÓMICO: solo lo que va ANTES del primer espacio ("672243 PA45396" → 672243);
   lo de DESPUÉS va en PLACAS (PA45396). Si la operación ya trae placas, se respetan.
   (Antes salía "undefined" en Placas.)
3. "FACTURAR A" (ROELCAINC…) y el bloque INSTRUCCIONES (no mostrar talón, firmar prueba de entrega,
   teléfono): solo en Logística Fletes. En Transfer, Logística Cruces y Rentas la carta queda como el
   modelo: encabezado con referencias, Cliente, Transporte, Mercancía y Origen/Destino.

## Archivos
src/utils/pdfGenerator.ts
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint igual que antes (2); build OK.
