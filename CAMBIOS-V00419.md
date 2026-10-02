# V00419 — Carta de Instrucciones / Prueba de Entrega: datos siempre completos

## Causas
1. "Aparecen y desaparecen": al generar el PDF se esperaba a que se cargaran los catálogos, pero se leía
   la copia del estado de React de ANTES de cargarlos (no se actualiza dentro del mismo clic). Si la
   pantalla aún no tenía empresas/direcciones (primer uso, caché vencida, otra carga en curso), origen y
   destino salían N/A; la siguiente vez sí salían.
2. Servicios Completados: la Carta de Instrucciones tenía las direcciones fijas en 'N/A'.
   Servicios Cancelados: usaba campos de la empresa que casi nunca existen (ciudad/colonia/cp).
3. La Carta nunca imprimía la Descripción de la Mercancía (solo la barra amarilla vacía).

## Cambios
- NUEVO src/utils/docPorId.ts: si la empresa/remolque no está en memoria, se lee por id de Firestore
  (Activas, Completados y Cancelados; Carta, Prueba de Entrega, Check List, etc.).
- NUEVO src/utils/direccionPdf.ts: desglose de dirección (catálogo `direcciones` fresco con caché de 5 min
  + parser de texto), usado por la Carta en Completados y Cancelados.
- Prueba de Entrega en Activas: usa el catálogo de direcciones fresco.
- Carta de Instrucciones: la descripción de la mercancía se imprime en la franja amarilla
  (si la operación no la tiene capturada, la franja queda vacía; el campo está en la pestaña Pedimento).

## Archivos
src/utils/{docPorId.ts, direccionPdf.ts} (nuevos), src/utils/pdfGenerator.ts
src/features/operaciones/components/{OperacionesDashboard, ServiciosCompletados, ServiciosCancelados}.tsx
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint igual o menor que antes; build OK.
