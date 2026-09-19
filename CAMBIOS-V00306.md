# V00306 — Ordenar la tabla de Convenios con clic en la columna (↑, ↓, original)

## Archivos que cambian (respetar rutas)
- `src/features/conveniosDetalles/components/DetallesConvenioDashboard.tsx` y `.css`
- `src/config/version.ts` y `public/version.json` — bump a V00306.

Aplica igual a Convenio de Clientes y Convenio de Proveedores (mismo
componente).

## Cómo funciona
Clic en el encabezado de cualquier columna:
1. **Primer clic** → flecha ▲: ordenamiento CRECIENTE por esa columna.
2. **Segundo clic** → flecha ▼: ordenamiento DECRECIENTE.
3. **Tercer clic** → se quita la flecha y la tabla REGRESA al orden
   original (el último convenio agregado primero).

Columnas ordenables: Consecutivo, Cliente/Proveedor, Tarifa, Origen,
Destino, Cotizado En, Status, Operaciones (por número de usos) y Costo de
la Tarifa. Consecutivo, Operaciones y Costo ordenan numéricamente; el
resto alfabéticamente (con acentos bien tratados). El orden por columna
se aplica DESPUÉS de pestañas, buscador y filtro de entidad, así que
ordena exactamente lo que estás viendo; las filas agrupadas ("N costos" /
"N montos") conservan su agrupado.

El botón "Consecutivo ↑↓" de la barra sigue existiendo y, al usarlo,
quita el orden por columna para que no haya dos mandos a la vez.

## Verificación
- `npx tsc --noEmit -p tsconfig.app.json` ✓
- eslint del archivo ✓ 0 problemas
- `npm run build` completo ✓

## Al instalar
Reemplaza los archivos, publica y prueba: clic en CLIENTE (▲ A→Z), otro
clic (▼ Z→A), tercer clic (sin flecha, regresa CONV-640 arriba).
