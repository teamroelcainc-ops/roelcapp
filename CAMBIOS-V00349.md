# V00349 — Casetas del día EN el resumen + captura de saldos de puentes

## Archivos que cambian (respetar rutas)
- `src/App.tsx`  ⚠ LEE LA NOTA DE ABAJO ANTES DE REEMPLAZAR
- `src/features/operaciones/components/TarjetaCasetas.tsx` y `.css`
- `src/config/historialCambios.ts` + `src/config/version.ts` + `public/version.json` — V00349.

## ⚠ Nota sobre App.tsx
Este App.tsx YA INCLUYE integrados los renombres del menú de tu V00336
("Historial de Versiones" para el módulo de versiones y "Historial de
Cambios" para el de actividad — verificados contra tu captura) más la
tarjeta nueva. Si tu App.tsx tiene ALGÚN OTRO cambio propio que yo no
haya entregado, dímelo ANTES de reemplazar; si no, reemplázalo directo.

## 1) La tarjeta ya aparece (sin pasos manuales)
"🌉 CASETAS DEL DÍA" queda junto a la del diésel, con el saldo vigente
del **Puente AVI** (registro "Caseta AVI", Dólares) y del **Puente III**
("Caseta Puente III", Pesos), EN VIVO desde el catálogo Tipos de Gastos.

## 2) "+ Actualizar saldos" — como el tipo de cambio
El botón de la tarjeta abre el modal de captura: escribes el saldo de
cada puente (con su moneda visible) y Guardar. Lo capturado se escribe
en el catálogo `Tipos de Gastos` (los mismos registros que ya usan las
operaciones para los gastos de puente), así que TODA la app queda con el
saldo nuevo al momento — la tarjeta, los formularios y los cálculos.
Si algún registro no existiera, el modal lo avisa en ámbar.

## Verificación
- `tsc --noEmit` ✓ · eslint: App.tsx 72 = baseline exacto, tarjeta 0 ·
  `npm run build` ✓

## Al instalar
Reemplaza los archivos + versión, `npm run build` y publica.
