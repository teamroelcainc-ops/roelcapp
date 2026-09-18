# V00301 — "Sincronizar convenios" idempotente: ya NO crea convenios nuevos en cada clic

## Archivos que cambian (respetar rutas)
- `src/features/tarifarioClientes/components/TarifarioClientesDashboard.tsx`
- `src/features/tarifarioProveedores/components/TarifarioProveedoresDashboard.tsx`
- `src/config/version.ts` y `public/version.json` — bump a V00301.

## La causa
La sincronización creaba los detalles PRIMERO y guardaba el tarifario (con
los consecutivos asignados a las líneas) hasta EL FINAL. Si algo fallaba a
la mitad — un permiso, la conexión, cerrar la ficha — los detalles nuevos
quedaban en Firestore pero las líneas NO recordaban su número: el
siguiente clic las veía "sin consecutivo" y creaba OTRO juego de
convenios. Además, las líneas VACÍAS (sin tarifa del catálogo, sin
descripción y sin monto) nunca matchean nada y generaban un convenio
nuevo en cada pasada.

## El arreglo (la operación ahora es IDEMPOTENTE: N clics = mismo resultado)
1. **La línea guarda su consecutivo EN FIRESTORE ANTES de crear el
   detalle** (guardado incremental, línea por línea). Si algo falla a la
   mitad, nada queda "a medias" del lado del tarifario.
2. **FASE 0 nueva — reconstrucción**: si una línea YA tiene consecutivo
   pero su detalle no existe (residuo de una pasada interrumpida), el
   detalle se reconstruye con ESA MISMA clave — jamás se reserva un
   número nuevo.
3. **Re-uso de residuos**: antes de reservar un número nuevo, se busca un
   detalle propio equivalente (misma descripción, creado por este
   tarifario, sin línea que lo use) dejado por un clic anterior — se
   re-usa en lugar de crear otro.
4. **Las líneas vacías NO generan convenios**: se saltan y el resumen las
   reporta ("⚠ N línea(s) VACÍA(S)… complétalas o elimínalas con 🗑").
5. **Limpieza ampliada**: los huérfanos propios SIN contenido (residuos
   vacíos de pasadas anteriores) también se eliminan en la fase final.

El resumen del botón ahora incluye "Detalles reconstruidos" y el aviso de
líneas vacías. Aplica al botón de la ficha y a "⟳ Sincronizar TODOS"
(usa la misma función). Ejecuta la sincronización una vez más: eliminará
los residuos que dejaron los clics anteriores y, a partir de ahí, podrás
presionarla las veces que quieras sin que invente convenios.

## Verificación
- `tsc --noEmit`: 0 errores. ESLint: ambos tarifarios 0. `style={{`: 0.
- `npm run build`: OK (PWA generada).
