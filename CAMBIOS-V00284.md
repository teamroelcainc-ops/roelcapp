# V00284 — Módulos que se recargan solos, Colaboradores que sí guarda, pestaña Firmas, confirmación al salir y arreglo del editor de tarifas

## Archivos que cambian (respetar rutas)
- `src/main.tsx` — recarga automática al llegar una versión nueva
- `src/services/employeeService.ts` — guardado robusto de colaboradores
- `src/features/empleados/components/EmpleadosDashboard.tsx` y `.css` — pestaña Firmas + carga sin exclusiones
- `src/features/empleados/components/EmployeeForm.tsx` — confirmación al salir
- `src/features/tarifarioClientes/components/TarifarioClientesDashboard.tsx` y `.css`
- `src/features/tarifarioProveedores/components/TarifarioProveedoresDashboard.tsx` y `.css`
- `src/features/conveniosDetalles/components/DetallesConvenioDashboard.tsx` — confirmación al salir
- `src/config/version.ts` y `public/version.json` — bump a V00284.

## 1) Módulos "desordenados" al entrar
Causa: la app es PWA — cuando un service worker nuevo tomaba control a
mitad de sesión, quedaba HTML viejo con assets nuevos (o al revés) y los
módulos se veían rotos hasta recargar a mano. Ahora, en cuanto la versión
nueva toma control, **la app se recarga sola una única vez**. (Por eso el
pie decía V00282 con pantallas de V00283: mezcla de versiones.)

## 2) Colaboradores no guardaba / editar–detalle no aparecía
Dos causas reales:
- **Guardado:** Firestore RECHAZA cualquier campo `undefined` — un solo
  campo vacío tiraba el guardado completo. Además el consecutivo dependía
  de la colección `_contadores` vía transacción: si las reglas no la
  permiten, TODA alta fallaba. Ahora los `undefined` se limpian siempre y
  el consecutivo (Col-###) sale del último registro, sin `_contadores`.
  Si algo falla, el alert muestra el motivo técnico real.
- **Listado:** la carga usaba `orderBy('employeeId')` de Firestore, que
  EXCLUYE los documentos sin ese campo — los registros guardados a medias
  no aparecían ni al editar ni en el detalle. Ahora se descarga sin
  orderBy y se ordena en memoria: aparecen todos.

## 3) Pestaña "Firmas" en Colaboradores
Nueva pestaña Directorio | **Firmas**: alta, edición y eliminación de
firmas con exactamente los tres campos pedidos — **Nombre de la firma,
Correo, Cargo o departamento** (colección `firmas_colaboradores`, guarda
también quién la creó). Los tres campos son obligatorios al guardar.

## 4) "¿Seguro que quieres salir?" en los formularios
Al presionar **Cancelar**, la **✕** o hacer **clic fuera** del modal, se
pregunta antes de cerrar (se pierden los cambios sin guardar). Aplicado en:
formulario de Colaboradores, editor de Firmas, formularios Nuevo/Editar de
ambos tarifarios, mini-editor de tarifa, y alta/edición de Detalles del
Convenio.

## 5) "Agregar tarifa" y ✏ del detalle del tarifario — arreglado
La causa: el mini-editor se montaba SIN la clase global `modal-overlay` —
quedaba sin posicionamiento, invisible al fondo de la página. Ahora abre
como modal real ENCIMA del detalle (z-index propio). También el lápiz ✏
(que en Windows se veía como "—") ahora es un ícono SVG, en el detalle del
tarifario y en Firmas.

## Verificación
- `tsc --noEmit`: 0 errores. ESLint vs base: EmpleadosDashboard 9=9,
  EmployeeForm 19 (base 20, mejora), employeeService 0, main 0,
  tarifarios 0, DetallesConvenio 0. `style={{` en Empleados: 8=8 (todos
  preexistentes).
- `npm run build`: OK (PWA generada).
