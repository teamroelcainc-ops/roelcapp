# V00251 — El pie del tarifario usa TU logo: public/ctat.png

## Archivos que cambian (respetar rutas)
- `src/utils/logoCtpat.ts` — ahora exporta `LOGO_CTPAT_SRC = '/ctat.png'`
  (se retiró la recreación en base64 del V00250).
- `src/features/tarifarioClientes/components/TarifarioClientesDashboard.tsx`
- `src/features/tarifarioProveedores/components/TarifarioProveedoresDashboard.tsx`
- `src/config/version.ts` y `public/version.json` — bump a V00251.

## Qué hace
- El logo bajo el recuadro de firma en ambos tarifarios ahora es tu archivo
  `public/ctat.png` (el zip NO lo incluye para no pisar el tuyo).
- Al ser un recurso del mismo origen, html2canvas lo captura sin problema y
  `exportarPDF` ya espera a que la imagen cargue antes de generar el PDF.
- Para cambiar el logo en el futuro basta con reemplazar `public/ctat.png`
  (mismo nombre), sin tocar código.

## Nota
- Si el PNG tuviera fondo transparente y llegara a verse con fondo raro en el
  PDF, avísame: el html2canvas ya fuerza fondo blanco (#ffffff), así que no
  debería, pero es el único punto a vigilar.

## Verificación
- `tsc --noEmit`: 0 errores. ESLint de los 3 archivos tocados: 0 problemas.
- `npm run build`: OK (PWA generada).
