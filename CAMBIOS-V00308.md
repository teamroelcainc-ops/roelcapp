# V00308 — Convenios: CHECK, ACCIONES y CONSECUTIVO fijos en el scroll horizontal

## Archivos que cambian (respetar rutas)
- `src/features/conveniosDetalles/components/DetallesConvenioDashboard.tsx` y `.css`
- `src/config/version.ts` y `public/version.json` — bump a V00308.

Aplica igual a Convenio de Clientes y Convenio de Proveedores.

## Qué cambia
Al desplazarte horizontalmente por la tabla (hacia STATUS, OPERACIONES o
COSTO), las tres columnas de la izquierda se quedan FIJAS y siempre a la
vista:
1. **CHECK** — puedes marcar filas para unir o eliminar en bloque desde
   cualquier punto del scroll.
2. **ACCIONES** — el lápiz ✏ y el bote 🗑 siempre a la mano.
3. **CONSECUTIVO** — siempre sabes en QUÉ convenio estás ajustando, con
   una sombra que separa la zona fija del resto de la tabla.

Las celdas fijas conservan el color de la fila (también al pasar el
mouse) y en el encabezado quedan por encima de todo, combinadas con el
encabezado fijo y la barra horizontal siempre visible de la V00307.

## Verificación
- `npx tsc --noEmit -p tsconfig.app.json` ✓
- eslint del archivo ✓ 0 problemas
- `npm run build` completo ✓

## Al instalar
Reemplaza los archivos, publica y desplázate a la derecha en Convenio de
Clientes: check, acciones y CONV-### no se mueven.
