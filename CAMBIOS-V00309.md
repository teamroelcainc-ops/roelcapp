# V00309 — Tarifarios: ordenar con clic en la columna + encabezado fijo y scroll siempre visible

## Archivos que cambian (respetar rutas)
- `src/features/tarifarioClientes/components/TarifarioClientesDashboard.tsx` y `.css`
  (el CSS lo comparte también Tarifario Proveedores)
- `src/features/tarifarioProveedores/components/TarifarioProveedoresDashboard.tsx`
- `src/config/version.ts` y `public/version.json` — bump a V00309.

Aplica igual a Tarifario Clientes y Tarifario Proveedores.

## 1) Ordenar con clic en el encabezado (mismo patrón que Convenios, V00306)
Clic en cualquier columna del listado de pre convenios:
1. **Primer clic** → flecha ▲: ordenamiento CRECIENTE.
2. **Segundo clic** → flecha ▼: ordenamiento DECRECIENTE.
3. **Tercer clic** → se quita la flecha y la tabla REGRESA al orden
   original (el último tarifario capturado primero).

Columnas ordenables: CONSECUTIVO, EMISIÓN, VENCE, CLIENTE/PROVEEDOR,
MONEDA, CRÉDITO, TARIFAS (por número de tarifas) y STATUS. Consecutivo,
Crédito y Tarifas ordenan numéricamente; fechas por su valor real; el
resto alfabéticamente con acentos bien tratados. El orden se aplica sobre
lo filtrado (buscador + cliente + status + moneda), así que ordenas
exactamente lo que ves.

## 2) Encabezado fijo y barra horizontal siempre visible (patrón V00307)
El listado ahora vive en su propio marco con scroll INTERNO (alto máximo
a la pantalla): la fila de columnas queda pegada arriba al bajar, y la
barra de scroll horizontal está al pie del marco, siempre a la vista —
también permanente en Chrome/Edge de macOS y delgada visible en Firefox.
La ficha del pre convenio y la captura no cambian.

## Verificación
- `npx tsc --noEmit -p tsconfig.app.json` ✓
- eslint de ambos .tsx ✓ 0 problemas
- `npm run build` completo ✓

## Al instalar
Reemplaza los archivos, publica y prueba en Tarifario Clientes: clic en
CLIENTE (▲ A→Z), otro clic (▼), tercer clic (regresa TARI-072 arriba);
baja con la rueda y el encabezado no se mueve.
