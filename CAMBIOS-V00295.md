# V00295 — Nueva pestaña sin re-descarga y "⟳ Sincronizar TODOS" los tarifarios

## Archivos que cambian (respetar rutas)
- `src/utils/cacheMemoria.ts`
- `src/features/tarifarioClientes/components/TarifarioClientesDashboard.tsx`
- `src/features/tarifarioProveedores/components/TarifarioProveedoresDashboard.tsx`
- `src/config/version.ts` y `public/version.json` — bump a V00295.

## 1) "Ver en nueva pestaña" ya no espera la descarga
Causa: el caché de operaciones vivía en sessionStorage, que NO se
comparte entre pestañas — la nueva llegaba "en frío" y descargaba todo.
El respaldo del caché pasa a **localStorage** (sí compartido): la pestaña
nueva pinta AL INSTANTE con los mismos datos, y los TTL de cada módulo
siguen decidiendo cuándo refrescar. Beneficia a todos los módulos que
usan este caché (Completados, Cancelados, etc.).

## 2) Convenios = Tarifario, sin duplicados — "⟳ Sincronizar TODOS"
Botón nuevo en la barra de Tarifario Clientes y Proveedores (junto a
⇪ Importar Convenios). Con un confirm previo, recorre TODOS los
tarifarios con convenio y en cada uno:
- liga las líneas sin # a su CONV **original** (por tarifa del catálogo,
  descripción y monto — el número más antiguo siempre gana);
- repara los duplicados creados por error (la línea vuelve a su CONV
  original y el duplicado se elimina);
- **elimina los duplicados huérfanos** (detalles creados por la
  sincronización errónea que ya nadie usa y cuyo gemelo original sí está
  ligado);
- crea un CONV nuevo SOLO cuando de verdad no existe.
Al final muestra el resumen global (revisados, ligadas, reparados,
creados, huérfanos eliminados). El botón por-tarifario de la ficha sigue
ahí y ahora también limpia huérfanos.

Con esto Detalles del Convenio y los tarifarios quedan diciendo lo mismo:
ejecuta "⟳ Sincronizar TODOS" una vez en Clientes y otra en Proveedores
y los CONV-5xx duplicados de la pantalla desaparecen.

## Verificación
- `tsc --noEmit`: 0 errores. ESLint: ambos tarifarios 0, cacheMemoria 0.
- `npm run build`: OK (PWA generada).
