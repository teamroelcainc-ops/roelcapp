# V00345 — "Ver documentos" abre un MODAL

## Archivos que cambian (respetar rutas)
- `src/features/operaciones/components/OperacionesDashboard.tsx` y `.css`
- `src/config/historialCambios.ts` + `src/config/version.ts` + `public/version.json` — V00345.

## Qué cambia
El botón "Ver documentos" del Detalle de Operación ya no despliega la
lista dentro de la ficha: abre un MODAL centrado, por encima de la
ficha, con el título "📎 Documentos de [referencia]", la lista completa
de documentos (Carta Porte, DODA, Entry's, Manifiesto y los subidos con
el botón Documentos) y en cada uno su botón **Ver / Descargar** que abre
el archivo en otra pestaña. Se cierra con la ✕ o haciendo clic fuera.

## Verificación
- `tsc --noEmit` ✓ · eslint: 127 = baseline exacto · `npm run build` ✓

## Al instalar
Reemplaza los archivos + versión, `npm run build` y publica.
