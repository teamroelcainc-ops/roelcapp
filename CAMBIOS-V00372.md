# V00372 — El candado del Verde SOLO al marcar Servicio Completado

## Archivos que cambian (respetar rutas)
- `src/features/operaciones/components/FormularioOperacion.tsx`
- `src/config/historialCambios.ts` + `src/config/version.ts` + `public/version.json` — V00372.

## Qué cambia
El candado de la V00371 estaba frenando CUALQUIER guardado del
formulario en operaciones ya completadas (por ejemplo, agregar $50 al
sueldo del operador). Corregido:
1. **El candado aplica ÚNICAMENTE al CAMBIAR el status a SERVICIO
   COMPLETADO.** Editar sueldos, gastos, combustible o cualquier otro
   dato guarda normal, esté como esté la operación.
2. **Operaciones que YA estaban completadas sin verde** (de antes de
   esta regla): al guardarlas sale el recordatorio
   "🌉 Recuerda que debes marcar Verde MX / Verde USA para que se
   descuente el saldo del puente de esta operación."
   — y el guardado procede sin traba.
3. En la ficha (SIGUIENTE PASO y Registrar Status manual) el candado
   sigue igual: ahí marcar completado siempre es un cambio de status.

## Verificación
- `tsc --noEmit` ✓ · eslint: Formulario 377 = baseline exacto ·
  `npm run build` ✓

## Al instalar
Reemplaza el archivo + versión, `npm run build` y publica.
