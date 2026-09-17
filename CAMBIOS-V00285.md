# V00285 — El formulario de edición abierto desde Nómina ya no queda congelado

## Archivos que cambian (respetar rutas)
- `src/features/nominas/components/ReferenciasNominaDashboard.tsx` y `.css`
- `src/config/version.ts` y `public/version.json` — bump a V00285.

## La causa exacta
`FormularioOperacion` se monta con **createPortal directo en el body**
(su propio overlay, z-index 1000). Nómina lo envolvía en un contenedor
`.rnd-x98` fijo a TODA la pantalla con **z-index 3000**: como el portal
"teletransporta" el formulario fuera de ese div, el contenedor quedaba
**vacío pero cubriendo todo el viewport POR ENCIMA del formulario** — un
escudo transparente que capturaba todos los clics. El formulario se veía
perfecto, pero pestañas, Cancelar, campos: nada respondía.

## El arreglo
El formulario se monta ahora DIRECTO (sin contenedor), exactamente igual
que en Servicios Cancelados y Completados, donde siempre ha funcionado.
La regla CSS `.rnd-x98` se retiró con nota. Revisé Puentes y Diesel: no
tienen este patrón (sus overlays son modales reales con fondo), así que
el bug era exclusivo de Nómina.

## Verificación
- `tsc --noEmit`: 0 errores. ESLint: ReferenciasNominaDashboard 136 —
  idéntico a su base.
- `npm run build`: OK (PWA generada).

## Prueba sugerida
Nómina → Asignar Operaciones → clic en cualquier referencia: el
formulario debe abrir y responder (pestañas, edición, Guardar, Cancelar).
Recuerda que esta prueba necesita la versión desplegada y una recarga
(desde V00284 la app se recarga sola al llegar versión nueva).
