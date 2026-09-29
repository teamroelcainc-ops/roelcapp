# V00394 — Hora del verde corregida · referencias por puente

## 1. Hora (Verde)
- Causa: la bitácora se consultaba en lotes secuenciales y CUALQUIER actualización de la lista de
  operaciones (llegan en vivo) cancelaba la carga completa; con muchas operaciones nunca terminaba.
- Ahora: lotes de 30 en paralelo (6 a la vez), cada lote se guarda en cuanto llega y no se vuelve a
  pedir. Si la bitácora no trae el nombre del estatus, se toma del catálogo por su id.
- Formato 12 h igual que la bitácora (03:57 p.m.), con la etiqueta Verde MX / Verde USA.

## 2. Referencias por puente
- Generar Referencia crea UNA referencia por puente con su consecutivo (fecha de GENERACIÓN):
  AVI-DDMMAA-001 (Puente AVI) · PT3-DDMMAA-001 (Puente III) · PTC-DDMMAA-001 (Colombia: caseta + puente).
  Si seleccionas operaciones de varios puentes, se generan varias referencias a la vez (vista previa
  en el modal con consecutivo, # operaciones, total y refs de cada una).
- Exige que todas las seleccionadas tengan monto de puente (si no, avisa cuáles y pide usar
  "Asignar monto del puente").
- Se guardan: consecutivo, puente, fechaGeneracion, horaGeneracion, operaciones (refs),
  operacionesGuardadas (hora verde, unidad, convenio, puente, caseta, piso, montos), total y total por moneda.
- Historial: # Referencia · Puente · Fecha · Hora · Referencias seleccionadas (número y refs) ·
  Total a pagar (por moneda) · Status. Las referencias viejas (PUENTES-…) se muestran con lo que tienen.
- Detalle: Referencia, Fecha, Hora (Verde), Unidad, Convenio, Puente y Monto (caseta y puente).

## Archivos
src/features/puentes/components/ReferenciasPuentesDashboard.tsx + .css
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint igual que antes (51); build OK.
