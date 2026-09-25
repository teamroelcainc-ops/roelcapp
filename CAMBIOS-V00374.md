# V00374 — Gasto de PUENTE controlado en Tarifas de Referencia

## Archivos que cambian (respetar rutas)
- `src/features/catalogos/components/CatalogosDashboard.tsx` y `.css`
- `src/config/historialCambios.ts` + `src/config/version.ts` + `public/version.json` — V00374.

## 1) El puente precarga su saldo del catálogo
En "Agregar/Editar Detalle" de los Gastos Incluidos, al elegir el
GASTO se precarga el MONTO con el importe guardado en Tipos de Gastos
(tu ejemplo: Trompo Puente III → $65.00). Puedes ajustarlo a mano si
esa tarifa lleva otro monto.

## 2) Solo UN gasto de puente por tarifa
Al intentar guardar un segundo gasto de categoría "Puente" en la misma
tarifa aparece: "⛔ Esta tarifa ya tiene un gasto de PUENTE… Solo puede
haber UNO por tarifa — edita o elimina el existente." (editar el
existente sí se permite).

## 3) Avisos en la tabla de Tarifas de Referencia
Junto a la descripción de cada tarifa CON ADUANA:
- **🌉⚠ Sin gasto de puente** (ámbar) si no tiene ninguno — agrégalo
  para que el peaje se descuente correcto (V00373).
- **⛔ N gastos de puente** (rojo) si tiene más de uno — deja solo uno.
Las tarifas con exactamente uno no muestran nada. Pasa el mouse sobre
el aviso para el detalle.

## Verificación
- `tsc --noEmit` ✓ · eslint: Catálogos 113 = baseline exacto ·
  `npm run build` ✓

## Al instalar
Reemplaza los archivos + versión, `npm run build` y publica.
