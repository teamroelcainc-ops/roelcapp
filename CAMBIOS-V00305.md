# V00305 — 🔗 Reparar relación: llave foránea en TODOS los convenios y un solo detalle (tarifario = convenio)

## Archivos que cambian (respetar rutas)
- `src/features/conveniosDetalles/components/DetallesConvenioDashboard.tsx` y `.css`
- `src/config/version.ts` y `public/version.json` — bump a V00305.

Aplica igual a CLIENTES y a PROVEEDORES (mismo componente; el botón repara
el lado que tengas abierto).

## Tu diagnóstico era correcto
El detalle del tarifario lee `tarifas[]` (copia dentro del doc del
tarifario) y el detalle del convenio lee la colección
`convenios_*_detalles`. Deben ser LO MISMO, pero los datos históricos se
desalinearon por dos vías:
- Convenios creados con "+ Agregar" en Detalles del Convenio: nacían con
  su llave foránea pero SIN línea en el tarifario (caso CONV-240 de Auto
  Express Aguila: 4 en Detalles, 3 en la ficha). **Ese hoyo quedó
  cerrado**: el alta ahora escribe también su línea en `tarifas[]`.
- Líneas guardadas cuyo detalle se perdió (sincronizaciones interrumpidas
  pre-V00301; caso ATA: 13 líneas y menos convenios).

## El botón nuevo: "🔗 Reparar relación" (en Convenio de Clientes / Proveedores)
Al presionarlo, en un solo paso:
1. **Llave foránea**: escribe `tarifarioId` en TODOS los convenios que no
   la tengan o la tengan rota — se resuelve por su consecutivo en las
   líneas guardadas o por el convenio maestro del tarifario.
2. **Líneas reconstruidas**: todo convenio con llave que no aparezca en la
   ficha de su tarifario recupera su línea (con tarifa, moneda, costo,
   ruta, status y montos).
3. **Convenios reconstruidos**: toda línea guardada cuyo convenio no
   exista se recrea con SU MISMO consecutivo (nunca se inventa un número).
4. **VERIFICACIÓN**: al final reporta, con sus CONV-###, los convenios que
   queden SIN llave foránea (irresolubles), SIN tarifa del catálogo, SIN
   moneda de cotización o SIN costo — esos se corrigen con el ✏ (las
   pestañas "No identificados", "Sin cotización" y "Vacíos" los listan).

Como ambos módulos son en vivo, al terminar la ficha del tarifario y el
detalle del convenio muestran EXACTAMENTE lo mismo, y los flujos ya
entregados los mantienen así: alta (ahora sí), edición (motor v1.3 en los
dos sentidos), borrado (V00304 quita la línea), Unir (consolida) y monto
vigente (escribe en ambos).

## Al instalar
1. Reemplaza los archivos y publica (sin cambios en Functions ni reglas).
2. En **Convenio de Clientes** presiona **🔗 Reparar relación**; repite en
   **Convenio de Proveedores**.
3. Verifica tus dos casos: TARI-061 (Auto Express Aguila) debe mostrar 4
   líneas = 4 convenios, y TARI-022 (ATA) el mismo número en ambos lados.

## Verificación técnica
- `npx tsc --noEmit -p tsconfig.app.json` ✓
- eslint del archivo ✓ 0 problemas
- `npm run build` completo ✓

## Nota (siguiente paso opcional)
Con la llave foránea ya en todos, el paso final hacia "una sola colección"
es que la FICHA del tarifario deje de leer `tarifas[]` y consulte
directamente los detalles por `tarifarioId` (y `tarifas[]` quede solo como
respaldo del PDF). Es un refactor mediano de la ficha y sus acciones por
línea; dime si lo quieres como entrega aparte.
