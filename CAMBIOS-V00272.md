# V00272 — Modal de convenios: # de Tarifario correcto, sin "+ Nuevo" y sin Eliminar

## Archivos que cambian (respetar rutas)
- `src/features/operaciones/components/FormularioOperacion.tsx`
- `src/config/version.ts` y `public/version.json` — bump a V00272.
(El CSS del V00271 no cambia.)

## 1) # de Tarifario ahora sí sale (relación completa)
Los detalles viejos/importados no traen `tarifarioId`, por eso la columna
salía con "—". Ahora el TARI/TARP se RESUELVE por la relación real, en
este orden: (a) tarifarioId directo del detalle, (b) el tarifario cuyo
`convenioId` apunta al maestro del detalle, (c) como último respaldo, el
único tarifario Aprobado del cliente/proveedor cuando tiene uno solo.
Aplica en el modal del cliente (TARI-###) y del proveedor (TARP-###).

## 2) Se retiró "+ Nuevo" y la acción Eliminar
El modal es ahora SOLO para elegir (clic en la fila) y consultar/editar
la tarifa. El alta y la eliminación de convenios viven donde deben:
Convenio de Clientes / Convenio de Proveedores. También se retiraron las
4 funciones huérfanas del formulario (alta rápida y borrado).

## 3) Ambos lados
Idéntico en Convenios del Cliente y Convenios del Proveedor.

## Verificación
- `tsc --noEmit`: 0 errores. ESLint: 377 — siguió BAJANDO (V00271: 379;
  base histórica: 385).
- `npm run build`: OK (PWA generada).
