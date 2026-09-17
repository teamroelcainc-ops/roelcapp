# V00271 — Operación: razón social, convenio elegido desde el modal con # Tarifario / # Convenio (cliente Y proveedor)

## Archivos que cambian (respetar rutas)
- `src/features/operaciones/components/FormularioOperacion.tsx` y `.css`
- `src/config/version.ts` y `public/version.json` — bump a V00271.

## 1) Razón social en los buscadores
Cliente (Paga) y Proveedor de Transporte muestran la RAZÓN SOCIAL
(`nombre` de Empresas), no el nombre corto — en la lista del buscador y
en el campo al seleccionar. De pilón mejora el respaldo por nombre del
V00252: los matches contra tarifarios usan el nombre completo.

## 2) Clientes con convenios (regla V00252 vigente)
La lista sigue trayendo a TODO cliente/proveedor con tarifario aprobado
o detalle de convenio activo (con respaldo por nombre) — sin exigir el
tipo marcado en Empresas.

## 3-6) El convenio se ELIGE desde el modal
- El campo Convenio (Tarifa) y Convenio Proveedor YA NO son buscadores:
  son de solo lectura y muestran el convenio elegido. Clic en el campo
  (o en "Ver / editar") abre el modal de convenios.
- El modal tiene DOS columnas nuevas: **# Tarifario** (TARI-###/TARP-###)
  y **# Convenio** (CONV-###), antes de Tarifa y Monto.
- CLIC EN LA FILA = seleccionar: el convenio se coloca automático en el
  campo y el modal se cierra. La fila elegida queda marcada en verde.
  Los botones Editar/Eliminar de cada fila siguen igual (no seleccionan).
- Bonus: las multi-tarifas de un mismo convenio ahora se ven como filas
  separadas CON SU MONTO a la vista (antes había que entrar a un submodal).

## 7) Aplica a ambos lados
Todo lo anterior es idéntico en cliente (Convenios del Cliente) y en
proveedor (Convenios del Proveedor).

## Verificación
- `tsc --noEmit`: 0 errores. ESLint: 379 — BAJÓ de 385 (se retiraron los
  dropdowns viejos del convenio y su código huérfano).
- `npm run build`: OK (PWA generada).
