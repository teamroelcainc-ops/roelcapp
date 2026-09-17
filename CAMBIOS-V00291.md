# V00291 — "Sincronizar convenios" corregido: liga el CONV original y repara los duplicados

## Archivos que cambian (respetar rutas)
- `src/features/tarifarioClientes/components/TarifarioClientesDashboard.tsx`
- `src/features/tarifarioProveedores/components/TarifarioProveedoresDashboard.tsx`
- `src/config/version.ts` y `public/version.json` — bump a V00291.

## La causa (grave, corregida de raíz)
La sincronización V00289 buscaba el detalle por `tipoConvenioId ===
tarifaReferenciaId` — y las líneas MIGRADAS no traen ese id. Como nunca
encontraba el CONV correcto (p. ej. CONV-048/049), reservaba consecutivos
NUEVOS (CONV-519/520) y creaba detalles duplicados. Eso rompía la
relación en vez de repararla.

## El arreglo
1. **Match en cascada** (del criterio más fuerte al más débil):
   (1) id de la tarifa del catálogo + monto; (2) **DESCRIPCIÓN
   normalizada + monto** — la relación real de los migrados; (3)
   descripción única aunque el monto difiera (la línea manda y el monto
   del detalle se alinea). Siempre se prefiere el CONV **más antiguo**
   (número menor).
2. **Reparación de los duplicados ya creados** (fase automática al
   presionar el botón): si una línea quedó apuntando a un detalle que la
   propia sincronización creó (tarifarioId = este tarifario) y EXISTE el
   detalle original equivalente con número menor, la línea **vuelve a su
   CONV original**, ese original se alinea (status/tarifa/tarifarioId) y
   el duplicado se **elimina**. El resumen final dice: ligadas,
   duplicados reparados y creadas.
3. Crear un consecutivo nuevo queda como ÚLTIMO recurso, solo cuando de
   verdad no existe ningún detalle equivalente.

## Cómo reparar lo de Auto Fletes Omega
Abre TARI-004 y presiona "⟳ Sincronizar convenios" otra vez: las líneas
CONV-519/520 volverán a CONV-048/049 y los duplicados se eliminan. Haz lo
mismo en cualquier tarifario donde la V00289 haya creado consecutivos de
más.

## Verificación
- `tsc --noEmit`: 0 errores. ESLint: ambos tarifarios 0.
- `npm run build`: OK (PWA generada).
