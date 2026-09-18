# V00293 — Prefijo FL- para Fletes y tarjetas-filtro con "abrir en otra pestaña" (Servicios Completados)

## Archivos que cambian (respetar rutas)
- `src/utils/generarReferencia.ts`
- `src/features/operaciones/components/ServiciosCompletados.tsx` y `.css`
- `src/App.tsx`
- `src/config/version.ts` y `public/version.json` — bump a V00293.

## 1) Fletes SIEMPRE con FL-
Causa: "Logística Fletes" contiene LOGIST y FLETE, y la regla evaluaba
LOGIST primero → salía LO-. Ahora **FLETE manda**: cualquier tipo que
contenga "flete" genera FL-. Para las operaciones YA creadas con LO-:
ábrelas y guarda — el formulario detecta que el prefijo no corresponde al
tipo y las renumera solo (conserva la fecha de la referencia).

## 2) Tarjetas del resumen = filtros, con "abrir en otra pestaña"
Piloto en Servicios Completados, como pediste:
- **Clic** en cualquier tarjeta (Servicios, Completados, Falsos, Diésel,
  Nómina, Facturados/Pendientes Cliente y Proveedor) filtra la tabla ahí
  mismo; clic de nuevo la desactiva. La tarjeta activa se marca en
  naranja y arriba de la tabla aparece el chip "Filtro por tarjeta: … ·
  N resultado(s)" con ✕ para quitarlo.
- **Ctrl+clic, clic con la rueda o "Abrir en una pestaña nueva"** (las
  tarjetas son enlaces reales): abre la app en otra pestaña YA parada en
  Servicios Completados con ese filtro aplicado, vía
  `?modulo=serviciosCompletados&tarjeta=…` — App.tsx ahora respeta
  `?modulo=` por encima del módulo persistido (deep-link).
Nota: la pestaña nueva abre con los filtros de fecha por defecto del
módulo; el filtro de la tarjeta se aplica sobre ellos.
Si te convence el comportamiento, lo replico en los demás módulos.

## Verificación
- `tsc --noEmit`: 0 errores. ESLint: ServiciosCompletados 163 = base,
  App 72 = base, generarReferencia 0.
- `npm run build`: OK (PWA generada).
