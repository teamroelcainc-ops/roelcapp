# V00373 — La CASETA de los Gastos Incluidos manda en el peaje

## Archivos que cambian (respetar rutas)
- `src/features/operaciones/components/OperacionesDashboard.tsx`
- `src/features/operaciones/components/FormularioOperacion.tsx`
- `src/config/historialCambios.ts` + `src/config/version.ts` + `public/version.json` — V00373.

## Qué cambia
Al descontar el saldo del puente (Verde MX/USA o el respaldo al
completar), primero se busca la **caseta agregada en los GASTOS
INCLUIDOS de la tarifa** de la operación (Tarifas de Referencia →
Gastos Incluidos):
- Se cobra **ese puente** con el **monto del vínculo** (tu ejemplo:
  Caseta Puente III $144.00 de "Cruce de Exportación - Caja - Cargado
  - 240 Nuevo Laredo") y su moneda del catálogo.
- El camino: operación → su convenio → tarifa base → gastos incluidos
  → el gasto con categoría "Puente" (acepta las variantes legacy de la
  relación, igual que el sueldo automático).
- Si la tarifa NO trae caseta en sus gastos (o no tiene convenio), se
  cobra el puente que corresponde al tráfico, como hasta ahora
  (Importación → AVI · Exportación → Puente III).
Aplica en la ficha (status rápido y Registrar Status manual) y en el
formulario. Las reglas vigentes no cambian: solo Transfer y Logística
de Cruces con Roelca, sin doble cobro, fecha del día del verde.

Nota: el botón 🧮 (retroactivo masivo) sigue usando la tarifa del
catálogo por tráfico; si quieres que también resuelva la caseta de la
tarifa operación por operación, dímelo y lo extiendo.

## Verificación
- `tsc --noEmit` ✓ · eslint: Operaciones 127, Formulario 377 —
  baselines exactos · `npm run build` ✓

## Al instalar
Reemplaza los archivos + versión, `npm run build` y publica.
