# V00268 — Empresas (2 de 3): DIRECCIONES MÚLTIPLES etiquetadas por tipo

## Archivos que cambian (respetar rutas)
- `src/features/empresas/components/FormularioEmpresa.tsx` y `.css`
- `src/config/version.ts` y `public/version.json` — bump a V00268.

## Qué hace (el caso de tu captura: MOBIL KRAFT)
En la pestaña CONTACTO, debajo de la dirección de la empresa, aparece la
sección "Direcciones por tipo de empresa": un bloque por CADA tipo
seleccionado en Información General. Si la empresa es Cliente (Mercancía)
y Bódega, verás:
- **Dirección Cliente (Mercancía)** — con su propia lista
- **Dirección Bódega** — con la suya
En cada bloque puedes AGREGAR TANTAS direcciones como necesites
(buscador del Directorio de Direcciones + botón "+ Agregar") y quitar
cualquiera con ✕. No permite duplicar la misma dirección en el mismo tipo.
Si la dirección aún no existe, se crea con "+ Añadir Nueva" (el botón de
arriba, que ya alimenta el Directorio) y luego se agrega al bloque.

## Relacional (regla "el ID es la verdad")
Cada dirección se guarda en la empresa como
`{ tipoId, tipoNombre, direccionId, direccionNombre }` — el ID del tipo
(catálogo Tipo de Empresa) y el ID de la dirección (Directorio) son la
fuente de verdad; los nombres son caché regenerable, listos para que el
motor relacional los mantenga al día.
Las empresas guardadas antes de esta versión simplemente muestran sus
bloques vacíos, listos para capturar — nada se rompe.

## Pendiente (3 de 3, siguiente entrega)
Formulario relacional completo: auditar que Tipo(s) de Empresa, Régimen
Fiscal, Moneda (solo Dólares/Pesos), Tipo de Factura y Servicios
Ofrecidos se alimenten 100% de sus catálogos, y renombrar la dirección
única actual como "Dirección de Facturación". Sigue abierta la pregunta:
¿"Servicios Ofrecidos" tiene catálogo propio o lo creamos?

## Verificación
- `tsc --noEmit`: 0 errores. ESLint: 21, idéntico al original.
- Sin inline styles nuevos (la sección usa clases fe-dirtipo*).
- `npm run build`: OK (PWA generada).
