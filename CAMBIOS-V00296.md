# V00296 — La sincronización busca en TODOS los convenios de la empresa (caso UnitedLink)

## Archivos que cambian (respetar rutas)
- `src/features/tarifarioClientes/components/TarifarioClientesDashboard.tsx`
- `src/features/tarifarioProveedores/components/TarifarioProveedoresDashboard.tsx`
- `src/config/version.ts` y `public/version.json` — bump a V00296.

## La causa del caso UnitedLink (TARI-001: 3 líneas vs 4 CONV)
CONV-489 (Flete de Importación - Caja - Cargado, con 6 operaciones — el
ORIGINAL) vive en un convenio maestro ANTERIOR de UnitedLink, distinto al
convenio ligado a TARI-001. La sincronización solo consultaba los
detalles del convenio del tarifario, así que CONV-489 era INVISIBLE para
ella: nunca podía re-adoptarlo y el duplicado CONV-507 quedaba vivo.

## El arreglo
La búsqueda de equivalentes ahora abarca los detalles de **TODOS los
convenios maestros de la misma empresa** (clienteId/proveedorId), no solo
el ligado al tarifario. Con eso:
- la línea "Flete de Importación - Caja - Cargado" re-adopta **CONV-489**
  (el original, el que usan las 6 operaciones);
- el duplicado CONV-507 se elimina (fase de reparación + huérfanos);
- al adoptar un detalle de otro convenio, este NO se mueve de su convenio
  (las operaciones que lo usan no se tocan); solo se alinean status,
  tarifa y tarifarioId.
Aplica igual al botón de la ficha y a "⟳ Sincronizar TODOS".

## Cómo reparar UnitedLink
Abre TARI-001 → "⟳ Sincronizar convenios" (o corre "⟳ Sincronizar TODOS").
Resultado esperado: la línea vuelve a CONV-489, CONV-507 desaparece, y en
Convenios la empresa queda con 3 detalles — los mismos 3 del tarifario.

## Verificación
- `tsc --noEmit`: 0 errores. ESLint: ambos tarifarios 0.
- `npm run build`: OK (PWA generada).
