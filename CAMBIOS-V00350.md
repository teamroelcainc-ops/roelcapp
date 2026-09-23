# V00350 — Módulo "Saldos de Puentes" (Bases de Datos)

## Archivos que cambian (respetar rutas)
- `src/features/saldosPuentes/components/SaldosPuentesDashboard.tsx` y `.css` (NUEVOS)
- `src/App.tsx` (registro del módulo — parte del App.tsx ya alineado en V00349)
- `src/features/operaciones/components/TarjetaCasetas.tsx` (la tarjeta alimenta la tabla)
- `src/config/historialCambios.ts` + `src/config/version.ts` + `public/version.json` — V00350.

## El módulo (Bases de Datos → Saldos de Puentes, bajo Tipo de Cambio)
Registro DIARIO del saldo de cada puente, con los tres datos que pediste:
- **Fecha** (default: hoy).
- **Puente** — RELACIONAL: se elige del catálogo Tipos de Gastos (solo
  los de categoría "Puente": Caseta AVI, Caseta Puente III y los demás);
  se guarda su ID y el nombre/moneda desnormalizados.
- **Saldo** (con la moneda del puente visible).
Tabla EN VIVO ordenada por fecha (buscador, ✎ editar, 🗑 eliminar);
un registro por puente y fecha (capturar dos veces el mismo día lo
actualiza, no duplica).

## Relacional de punta a punta
- El **saldo más reciente** de cada puente actualiza el `importe` del
  catálogo Tipos de Gastos → la tarjeta "Casetas del día", los gastos de
  puente de las operaciones y toda la app quedan al momento.
- La tarjeta **"+ Actualizar saldos"** ahora también REGISTRA el día en
  esta tabla (colección `saldos_puentes`): capturar desde la tarjeta o
  desde el módulo es lo mismo.

## Activar en Roles
El módulo usa el permiso "Saldos de Puentes". Los ADMIN lo ven ya; para
asignarlo a otros roles, en TU `RolesDashboard.tsx` agrega
`'Saldos de Puentes'` al grupo de Bases de Datos en GRUPOS_MODULOS
(una línea) — o mándame el archivo y lo integro en la siguiente.

## Verificación
- `tsc --noEmit` ✓ · eslint: módulo nuevo 0, tarjeta 0, App.tsx 72 =
  baseline exacto · `npm run build` ✓

## Al instalar
Copia/reemplaza los archivos + versión, `npm run build` y publica.
