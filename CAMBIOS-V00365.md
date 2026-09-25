# V00365 — Modal de cruces más ancho · peaje por tráfico · sin "Registrar Status" en Completados

## Archivos que cambian (respetar rutas)
- `src/features/operaciones/components/TarjetaCasetas.css`
- `src/features/operaciones/components/OperacionesDashboard.tsx`
- `src/features/operaciones/components/ServiciosCompletados.tsx`
- `src/config/historialCambios.ts` + `src/config/version.ts` + `public/version.json` — V00365.

## 1) Modal de cruces más ancho
"Cruces de hoy" pasa a ~780px: las referencias y los montos ya no se
parten en dos líneas.

## 2) El peaje del Verde se cobra del puente del TRÁFICO
Al marcar Verde MX o Verde USA HOY, el descuento sale del puente que
corresponde al tráfico de la operación:
- **Importación** → Caseta AVI en dólares ($23.75), aunque el verde
  marcado sea "Verde Mx (Importación)".
- **Exportación** → Caseta Puente III en pesos ($144.00).
Así nunca se cruza la moneda. La fecha del cruce es el día en que se
marca el verde, y sigue sin cobrarse dos veces. (Los cruces ya
cobrados antes con "Completado" no se recalculan — por eso el listado
de hoy muestra esas operaciones con ✓ Completado; los nuevos saldrán
con ✓ Verde MX / ✓ Verde USA.)

## 3) Ficha de Completados sin "Registrar Status"
La fila "SIGUIENTE PASO … + Registrar Status" desapareció del Detalle
de Operación Completada — la operación ya terminó; la Bitácora sigue
disponible para consultar el historial.

## Verificación
- `tsc --noEmit` ✓ · eslint: Completados 163 y Operaciones 127 =
  baselines exactos · `npm run build` ✓

## Al instalar
Reemplaza los archivos + versión, `npm run build` y publica.
