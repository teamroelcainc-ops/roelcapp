# V00430 — Grupos de convenios más claros y cancelar referencias sin reglas de estatus

## 1. Convenios desplegados de un grupo (Convenio de Clientes / Proveedores)
Al abrir un grupo "N costos", sus convenios ya no se confunden con el resto:
- Fondo azul oscuro (también en las columnas fijas Check/Acciones/Consecutivo).
- Barra azul a la izquierda y la fila del grupo abierto marcada igual.
- Sangría con conector └ en Consecutivo, Cliente y Tarifa; letra un poco más chica.
- Separadores punteados entre ellos y una línea azul que cierra el grupo.

## 2. Cancelar referencia sin reglas de estatus (Operaciones Activas → Detalle)
- Si la operación (Servicio + Tráfico + Carga) no tiene flujo en Reglas de Estatus, junto a
  "Registrar Status" aparece "✕ Cancelar referencia" (también dentro del modal Registrar Movimiento).
- Pide el motivo (obligatorio) y guarda status Cancelado (7607f692), observacionCancelacion, canceladoPor,
  canceladoPorUid, fechaCancelacion y un registro en la bitácora (horarios) — igual que el formulario.
- La operación pasa a Servicios Cancelados.

## Archivos
src/features/conveniosDetalles/components/DetallesConvenioDashboard.tsx + .css
src/features/operaciones/components/OperacionesDashboard.tsx + .css
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint igual que antes (Operaciones 126, Convenios 0); build OK.
