# V00307 — Convenios: encabezado FIJO y scroll horizontal SIEMPRE visible

## Archivos que cambian (respetar rutas)
- `src/features/conveniosDetalles/components/DetallesConvenioDashboard.css`
  (solo CSS — sin cambios de lógica)
- `src/config/version.ts` y `public/version.json` — bump a V00307.

Aplica igual a Convenio de Clientes y Convenio de Proveedores.

## Qué cambia
La tabla ahora vive en su propio marco con scroll INTERNO (alto máximo a
la pantalla, mínimo 300 px). Con eso:

1. **Encabezado fijo**: al bajar por los convenios, la fila de columnas
   (TARIFA, COTIZADO EN, STATUS, COSTO…) se queda pegada arriba — el
   sticky que ya traía la app por fin tiene un contenedor con scroll al
   cual fijarse. Queda por encima de los selects de las filas.
2. **Barra horizontal siempre a la vista**: la barra de scroll horizontal
   está al pie del marco, visible sin tener que llegar al final de la
   página; además se estiliza para que sea PERMANENTE también en
   Chrome/Edge de macOS (donde el sistema la oculta) y delgada y visible
   en Firefox.

Las flechas de ordenamiento (V00306), los filtros y todo lo demás quedan
igual — solo mejora la revisión y los ajustes desde la tabla.

## Verificación
- `npx tsc --noEmit -p tsconfig.app.json` ✓ (sin cambios de TS)
- `npm run build` completo ✓

## Al instalar
Reemplaza el CSS, publica y abre Convenio de Clientes: baja con la rueda
(el encabezado no se mueve) y revisa el pie del marco (la barra
horizontal siempre está ahí).
