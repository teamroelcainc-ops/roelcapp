# V00304 — Borrar un convenio LIMPIA el tarifario, ficha ancha con "+ Agregar tarifa" arriba, y UN convenio con VARIOS montos

## Archivos que cambian (respetar rutas)
- `src/features/conveniosDetalles/components/DetallesConvenioDashboard.tsx` y `.css`
- `src/features/tarifarioClientes/components/TarifarioClientesDashboard.tsx` y `.css`
  (el CSS lo comparte también Tarifario Proveedores)
- `src/features/tarifarioProveedores/components/TarifarioProveedoresDashboard.tsx`
- `src/config/version.ts` y `public/version.json` — bump a **V00304**
  (la V00303 es el arreglo del arranque "Cargando Roelca Inc…" ya entregado).

Todo aplica igual a CLIENTES y a PROVEEDORES.

## 1) "Borré convenios y siguen en el detalle del tarifario"
La causa: eliminar el detalle mandaba el CONV a la Papelera pero NO quitaba
su línea del arreglo `tarifas[]` del tarifario — la ficha y la columna
TARIFAS leen ese arreglo (que sí es en vivo), por eso ni la lista ni el
conteo cambiaban.

Ahora, al eliminar un convenio (individual, masivo o los descartados de
⚭ Unir), **su línea del tarifario se quita también** (relación por
consecutivo, con búsqueda de respaldo si el detalle no trae tarifarioId).
Como la ficha ya escucha en vivo, la línea desaparece y el número de
TARIFAS baja al instante, sin recargar.

## 2) Ficha del tarifario
- Más ancha: 1000 → **1240 px**.
- El botón **"+ Agregar tarifa" vive ARRIBA**, en el hueco que marcaste
  (junto a Creado por / Aprobado por), ya no en el pie.

## 3) UN convenio con VARIOS montos (tu aclaración)
El convenio es UNO y conserva UN solo número CONV-###; los costos viven en
el campo nuevo `montos[]` del MISMO convenio, y `tarifa` sigue siendo el
monto **VIGENTE** — el que leen operaciones, facturación y el motor
relacional (compatibilidad total, sin tocar Cloud Functions).

- **Unificar los repetidos de hoy:** en las filas agrupadas (chip "N
  costos") hay un botón nuevo **"⇒ 1 convenio"**: preselecciona el grupo y
  abre el modal de Unir con el conservado sugerido (el de más
  operaciones). Al confirmar: las operaciones se reapuntan (como siempre),
  el conservado **absorbe todos los montos**, los CONV sobrantes van a la
  Papelera y sus líneas del tarifario se **consolidan en UNA** (la del
  conservado, con los montos).
- **Elegir el monto:** un convenio con varios montos muestra chip "N
  montos" y un **desplegable en COSTO** con sus montos (un solo CONV);
  elegir uno lo hace el VIGENTE — se escribe en el detalle y en la línea
  del tarifario. En la **ficha del tarifario**, la celda TARIFA de esa
  línea también es desplegable y hace lo mismo.
- Los duplicados EXACTOS (mismo costo) siguen separados con ⚠ para unirlos.

NOTA: si capturas una multi-tarifa nueva desde el tarifario, hoy nace como
antes (líneas separadas) y la unificas con un clic en "⇒ 1 convenio". En la
siguiente entrega puedo hacer que la captura y la sincronización nazcan ya
consolidadas en un solo CONV, si quieres.

## Verificación
- `npx tsc --noEmit -p tsconfig.app.json` ✓
- eslint de los 3 .tsx ✓ 0 problemas
- `npm run build` completo ✓

## Al instalar
1. Reemplaza los archivos respetando rutas y publica (sin cambios en
   Functions ni reglas).
2. Prueba: elimina un CONV desde Convenio de Clientes → su línea y el
   conteo del tarifario cambian solos; abre una fila "2 costos" → "⇒ 1
   convenio" → Unir → queda UN CONV con desplegable de montos, y en la
   ficha del tarifario una sola línea con el mismo desplegable.
