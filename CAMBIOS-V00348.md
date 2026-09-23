# V00348 — Tarjeta "CASETAS DEL DÍA" (Puente AVI y Puente III) en el resumen

## Archivos del zip (respetar rutas)
- `src/features/operaciones/components/TarjetaCasetas.tsx` y `.css` (NUEVOS)
- `src/config/historialCambios.ts` + `src/config/version.ts` + `public/version.json` — V00348.

## ⚠ IMPORTANTE — 2 líneas a mano en TU App.tsx
El resumen del día vive en `App.tsx`, que la V00336 modificó en otra
sesión — para NO pisar tus renombres del menú, ese archivo NO va en el
zip. Agrégale tú estas 2 líneas a TU App.tsx actual:

1) Arriba, con los demás imports:
   `import { TarjetaCasetas } from './features/operaciones/components/TarjetaCasetas';`

2) En el bloque de tarjetas del resumen del día, busca la tarjeta del
   DIÉSEL (el texto "Por galón (USA)") y justo DESPUÉS del `</div>` que
   cierra esa tarjeta, agrega:
   `<TarjetaCasetas />`

(Si prefieres, mándame tu App.tsx y RolesDashboard.tsx actuales y en la
siguiente entrega los integro yo — también dejo conectada la casilla de
"personalizar vista" en Roles que quedó pendiente.)

## Qué hace la tarjeta
- Muestra el SALDO VIGENTE de las dos casetas marcadas: **Puente AVI**
  (registro "Caseta AVI") y **Puente III** (registro "Caseta Puente III"),
  cada uno con su importe y moneda (Dólares/Pesos).
- EN VIVO: se suscribe al catálogo `Tipos de Gastos` — al editar el
  importe ahí, la tarjeta cambia al momento, sin recargar.
- Mismo estilo de las demás tarjetas del resumen (morado, con su ícono).

## Verificación
- `tsc --noEmit` ✓ · eslint 0 · `npm run build` ✓

## Al instalar
Copia los archivos nuevos + versión, agrega las 2 líneas a App.tsx,
`npm run build` y publica.
