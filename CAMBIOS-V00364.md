# V00364 — Base: TU proyecto actualizado (Roelca-app_5) + 4 arreglos

## ✅ Desde esta versión trabajo sobre tu proyecto actualizado
Este zip sale de tu Roelca-app_5.7z (V00363 con tu V00356 incluida) —
ya NO hay riesgo de pisar cambios de otras sesiones.

## Archivos que cambian (respetar rutas)
- `src/features/documentos/AlertaDocumentos.tsx`
- `src/features/operaciones/components/ServiciosCompletados.tsx`
- `src/features/operaciones/components/FormularioOperacion.tsx`
- `src/usuarios/components/RolesDashboard.tsx`
- `src/features/operaciones/components/OperacionesDashboard.tsx`
- `src/config/historialCambios.ts` + `src/config/version.ts` + `public/version.json` — V00364.

## 1) Las BÓDEGAS sin "⚠ Origen/Destino sin documentos"
Si la empresa elegida tiene el tipo Bódega, la alerta de documentos no
se muestra (en Origen, Destino ni en ningún otro lugar) — las bódegas
no manejan documentos.

## 2) Bitácora visible desde Servicios Completados
La "Bitácora de Movimientos" mostraba "-" en ESTATUS MARCADO: ahora
pinta el nombre del estatus guardado en cada movimiento (los horarios
lo traen desnormalizado). Movimientos muy viejos sin nombre guardado
siguen resolviéndose por catálogo.

## 3) "Caseta / Puente" del formulario, solo al marcar Verde
La tarjeta (Puente / Puente Monto en Unidad y Operador) aparece
únicamente cuando la operación ya marcó Verde MX o Verde USA (o el
peaje ya se cobró). La lógica interna no cambia: el puente se sigue
precalculando y NO se pierde al guardar antes del verde.

## 4) Roles conectados
- "Saldos de Puentes" aparece en el grupo Bases de Datos de Roles —
  asígnalo a los roles que deban verlo.
- Casilla NUEVA "Personalizar Vista (Operaciones)" en Permisos
  Especiales: habilita el botón ✎ Vista de Operaciones Activas (los
  Admin siempre pueden).

## Verificación
- `tsc --noEmit` ✓ · eslint (baselines del proyecto nuevo): Alerta 4,
  Completados 163, Formulario 377, Roles 17, Operaciones 127 — todos
  exactos · `npm run build` ✓

## Al instalar
Reemplaza los archivos + versión, `npm run build`, publica y marca las
casillas nuevas en Roles para quien corresponda.
