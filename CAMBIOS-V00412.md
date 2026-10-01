# V00412 — Detalle de referencia de puentes

1. Ventana del Detalle de Referencia más ancha (hasta 1400 px / 96% de la pantalla).
2. Botón **Sacar** por operación (referencias del Historial de referencias): la quita de la referencia,
   recalcula totales y la regresa a "Operaciones sin asignar". Si la referencia queda vacía, se elimina.
3. Clic en la fila de una operación → se abre su formulario (el mismo de Operaciones / Servicios
   Completados); al cerrarlo vuelve el detalle de la referencia.
4. **Sin mezclar puentes**:
   - El puente lo decide la ADUANA de la tarifa: Colombia siempre va a PTC (caseta + Puente Mx
     Colombia), aunque la operación tuviera cobrada otra caseta; una caseta de Colombia en otra aduana
     se vuelve a calcular.
   - Cada referencia solo acepta operaciones de su puente (automático y al enviar desde Operaciones
     sin asignar). En el envío, Colombia se agrupa por su convenio.
   - Las operaciones que YA estaban en un puente equivocado se marcan en rojo con "Otro puente":
     usa "Sacar" y vuelve a enviarlas para que caigan en su referencia.

## Archivos
src/utils/historialCalculadoPuentes.ts, src/utils/puenteColombia.ts
src/features/puentes/components/ReferenciasPuentesDashboard.tsx + .css
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint igual que antes (49); build OK.
