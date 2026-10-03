# V00420 — Referencias de puentes: solo manuales · Sacar sin error · Colombia en su puente

1. **Sin referencias automáticas**: marcar Verde ya NO crea ni completa referencias. Las operaciones
   quedan en "Operaciones sin asignar" y se envían con "Enviar al Historial" a la referencia elegida
   (o nueva). Se quitó "Recalcular hoy". (Interruptor REFERENCIAS_AUTOMATICAS_ACTIVAS = false en
   src/utils/historialCalculadoPuentes.ts.)
2. **"Connection failed" al Sacar**: se usaba una transacción, que exige conexión directa con el
   servidor y fallaba. Ahora Sacar, Agregar, Enviar y Eliminar escriben en lote: el cambio se ve al
   instante (caché local) y se sincroniza solo; los botones ya no se quedan en "Eliminando…".
3. **Aduana Colombia**: al enviar o agregar operaciones se pasa el convenio para detectar la aduana
   Colombia siempre → van a PTC con caseta + puente. En el detalle de una referencia, botón
   "Sacar las de otro puente (N)" para regresar de un clic las que ya estaban mal (p. ej. 800 Colombia
   dentro de AVI o PT3) y reenviarlas a su referencia de Colombia.

## Archivos
src/utils/historialCalculadoPuentes.ts
src/features/puentes/components/ReferenciasPuentesDashboard.tsx
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint igual que antes (49; utilidad 0); build OK.
