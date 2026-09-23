# V00341 — Los documentos de la operación SÍ se guardan… y ahora SÍ se consultan

## Archivos que cambian (respetar rutas)
- `src/features/operaciones/components/FormularioOperacion.tsx`
- `src/features/facturacion/components/AuditoriaCadenaCliente.tsx` y `.css`
- `src/config/historialCambios.ts` (entrada automática de esta versión)
- `src/config/version.ts` + `public/version.json` — V00341.

## Lo que encontré
Los PDF SÍ se estaban guardando: al presionar "Guardar Operación" se
suben al almacenamiento (carpeta de la referencia) y se registran en la
colección `documentos`. El problema era que NINGUNA pantalla los
mostraba para operaciones — por eso parecía que se perdían. (Ojo: los
PDF de la pestaña Pedimento se suben AL GUARDAR la operación; si el
guardado se convierte en solicitud de autorización, los archivos hay que
adjuntarlos al aprobarse, con el botón Documentos.)

## Lo que cambia
1) **En el formulario de la operación** (pestaña "Pedimento y CT"), bajo
   la tarjeta de Documentación aparece ahora "Documentos guardados de
   esta operación": la lista de todo lo subido (Carta Porte, DODA,
   Manifiesto, Entry's y lo que agregues con el botón Documentos), para
   abrirlos o administrarlos ahí mismo. Visible al editar una operación
   ya guardada.
2) **En el detalle de la operación de la Auditoría** (👁), al final del
   resumen aparece "📎 Documentos de la operación" con la misma lista
   (solo consulta).

## Verificación
- `tsc --noEmit` ✓ · eslint: Formulario 377 = baseline exacto, Auditoría
  en 0 · `npm run build` completo ✓

## Al instalar
Reemplaza los archivos + versión, `npm run build` y publica.
