# V00302 — Detalles del Convenio EN VIVO (relacional de verdad), desplegables de Status/Moneda y desplegable de costos

## Archivos que cambian (respetar rutas)
- `src/features/conveniosDetalles/components/DetallesConvenioDashboard.tsx` y `.css`
- `src/features/tarifarioClientes/components/TarifarioClientesDashboard.tsx`
- `src/features/tarifarioProveedores/components/TarifarioProveedoresDashboard.tsx`
- `src/config/version.ts` y `public/version.json` — bump a V00302.

Todo aplica igual a CLIENTES y a PROVEEDORES.

## 1) La causa de "tarda en aparecer / la moneda vieja / no se elimina"
El tarifario SÍ escribía los cambios en la base (la cascada existe desde
la V00299), pero Detalles del Convenio leía TODO con una sola consulta y
lo guardaba en un caché de 5 minutos — la tabla pintaba lo viejo hasta
presionar "Actualizar". Eso rompía la sensación de base relacional.

## 2) El arreglo: escuchas EN VIVO (onSnapshot)
Detalles del Convenio ahora ESCUCHA las colecciones de detalles y de
convenios maestros en tiempo real:
- Agregas una tarifa en el detalle del tarifario → aparece SOLA en el
  detalle del convenio, al instante.
- Editas la moneda (Cotizado En) en el tarifario → el convenio la
  actualiza SOLO.
- Eliminas un convenio → la fila desaparece sola al confirmarse.
El botón "Actualizar" queda únicamente para refrescar catálogos y el
conteo de operaciones (las filas ya no lo necesitan). El pie de la tabla
lo dice: "la tabla se actualiza sola en tiempo real".

## 3) Aviso mientras se elimina
Al eliminar (individual, masivo o al ⚭ Unir), la fila se atenúa y
muestra "⏳ Eliminando…" mientras el registro viaja a la Papelera; al
confirmarse, desaparece sola. Ya no hay confusión de "le di eliminar y
sigue ahí".

## 4) Mismo nombre, distinto costo → UNA fila con desplegable
Cuando un convenio se repite con el MISMO nombre (misma tarifa, origen,
destino y moneda) y solo cambia el costo, la tabla ya no repite el
nombre: muestra UNA fila con un chip "N costos" y, en la columna COSTO,
un DESPLEGABLE "$1,500.00 · CONV-486" para elegir qué costo ver — la
fila entera cambia a esa variante (consecutivo, status y operaciones).
Para cambiar el monto en sí se usa el lápiz ✏ de esa variante.
Los duplicados EXACTOS (mismo costo) siguen en filas separadas con su
chip "⚠ duplicado", para poder unirlos con ⚭.

## 5) Status y Moneda como listas desplegables (ambos tarifarios)
- En "Agregar / Editar tarifa" del tarifario, el STATUS ya es lista
  desplegable (Pendiente · Aprobado · Inactivo · Cancelado); antes era
  un texto con sugerencias.
- La MONEDA de la cabecera del tarifario ya es lista desplegable: se
  propone la registrada en Empresas y puedes cambiarla SOLO para ese
  tarifario. Se guarda al crear y también con "Guardar cambios" en
  edición, y se propaga al convenio maestro (el respaldo que muestran
  los Detalles cuando el detalle no trae moneda propia).

## Verificación
- `npx tsc --noEmit -p tsconfig.app.json` ✓ sin errores
- eslint de los 3 archivos ✓ 0 problemas
- `npm run build` completo ✓

## Al instalar
1. Reemplaza los archivos del zip respetando las rutas.
2. Publica. No hay cambios en Cloud Functions ni en reglas.
3. Prueba la cadena: agrega una tarifa desde el detalle del tarifario y
   mira el Convenio SIN tocar nada (debe aparecer sola); edita el
   Cotizado En de una línea y confirma que el convenio cambia solo;
   elimina un convenio y observa el "⏳ Eliminando…".
