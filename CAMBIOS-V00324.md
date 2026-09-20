# V00324 — Auditoría: rango de fechas · editar al frente (y regresar donde ibas) · detalle legible de la operación

## Archivos que cambian (respetar rutas)
- `src/features/facturacion/components/AuditoriaCadenaCliente.tsx` y `.css`
- `src/config/version.ts` + `public/version.json` — V00324.

## 1) Auditar por rango de fechas
Junto al buscador: "Servicio de [fecha] a [fecha]". El rango aplica a la
FECHA DE SERVICIO de las OPERACIONES (como pediste); facturas y pagos del
cliente se muestran completos. Acepta también las fechas d/m/aaaa de las
operaciones migradas. El botón ✕ quita el rango. El filtro es en vivo:
cambiar las fechas recalcula columnas, totales y problemas al momento.

## 2) Editar ya queda AL FRENTE — y la auditoría te espera donde ibas
El formulario de edición de operaciones vive en su propia capa (portal) y
quedaba DETRÁS de la auditoría. Ahora, al presionar ✎, la auditoría se
hace a un lado (baja su capa) para que el formulario quede al frente; al
cerrarlo, la auditoría reaparece EXACTAMENTE donde la dejaste — con tu
cliente, rango, selección y scroll intactos (nunca se desmonta), y los
cambios guardados ya reflejados en vivo.

## 3) 👁 de la operación = el mismo detalle que en operaciones
El ojo de la operación ya no muestra la tabla técnica de campos crudos:
muestra el DETALLE LEGIBLE con los mismos datos del módulo de operaciones
(referencia, fecha, status, tipo, cliente, convenio, C/V, Impo/Expo,
aduana, origen → destino, remolque, operador, montos de cliente y
proveedor con conversiones y TC, observaciones, creado por) — nombres, no
ids. El botón "Ver todos los campos" alterna a la vista técnica completa
si la necesitas. Facturas y pagos conservan su detalle de campos.

## Verificación
- `tsc --noEmit` ✓ · eslint del componente en 0 · `npm run build` ✓

## Al instalar
Reemplaza los 2 archivos + versión, `npm run build` y publica.
