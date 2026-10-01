# V00405 — Reglas de Estatus: flujo con solo el Servicio

- Editor de Flujos: Tráfico y Carga son OPCIONALES ("Todos (opcional)"). "Guardar flujo" exige solo el
  Servicio y al menos un paso.
- El flujo se guarda como `{Servicio}_Todos_Todos` (o `_Todos` solo en lo que falte), con trafico/carga
  vacíos = COMODÍN.
- Cómo se aplica (formulario, Registrar Movimiento, botones de horario, cascada y peaje): primero el
  flujo exacto (servicio + tráfico + carga); si no hay, el más específico del mismo servicio con
  comodín (p. ej. servicio + tráfico con carga Todos, luego servicio Todos·Todos).
- La lista de flujos muestra "Todos" donde no se eligió tráfico o carga.

## Archivos
src/features/configuracion/components/ConfiguradorStatus.tsx + .css
src/features/operaciones/config/statusRules.ts
src/features/operaciones/components/FormularioOperacion.tsx
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint igual o menor que la base (Configurador 8, statusRules 32, Formulario 376); build OK.
