# V00265 — Corrige el acomodo al regresar a un módulo y las monedas infladas

## Archivos que cambian (respetar rutas)
- `src/App.css`
- `src/features/operaciones/components/FormularioOperacion.css`
- `src/features/facturacion/components/FacturacionClientesDashboard.tsx`
- `src/config/version.ts` y `public/version.json` — bump a V00265.

## 1) El módulo se veía desordenado al regresar (culpa del V00264)
- El envoltorio de los módulos "vivos" usaba display:contents y al volver
  el acomodo se rompía (chips y tarjetas apilados). Ahora es un bloque
  normal al 100% — el módulo regresa viéndose EXACTAMENTE igual.
- Además, con el formulario de operación ahora persistente entre módulos,
  en estado MINIMIZADO asomaban fragmentos encima de otras pantallas
  ("Flete de Importacion…", "$0.00"). Regla nueva: minimizado solo se ve
  la píldora flotante; todo lo demás del formulario queda oculto.

## 2) Totales USD/MXN inflados (culpa del V00262) — y cómo se recuperan
El V00262 clasificaba cada factura por la moneda del CLIENTE en Empresas.
Eso mezclaba monedas: una factura emitida en PESOS de un cliente que hoy
cotiza en DÓLARES se sumaba al total USD con su monto en pesos → totales
inflados. Corrección:
- La factura manda con su MONEDA DE EMISIÓN (canónica: Dólares/Pesos);
  la de Empresas queda solo de respaldo para facturas sin moneda.
- El botón "⇄ Sincronizar con Empresas" ya NO sustituye la moneda de
  emisión: solo la canoniza. Y como el campo viejo `moneda` quedó intacto,
  al CORRERLO DE NUEVO recupera las facturas a las que la corrida anterior
  les puso la moneda del cliente. → IMPORTANTE: tras publicar, corre
  "⇄ Sincronizar con Empresas" UNA vez para reparar.
- Las tarjetas redondean a 2 decimales (ya no $1,179,697.4065).

## Al publicar
1. Publica V00265. 2. Facturación → "⇄ Sincronizar con Empresas" (repara
las monedas). 3. Verifica que Total USD + Total MXN se vean razonables y
las tarjetas (clic) muestren solo facturas de su moneda.

## Verificación
- `tsc --noEmit`: 0 errores. ESLint: 308 idéntico. `npm run build`: OK.
