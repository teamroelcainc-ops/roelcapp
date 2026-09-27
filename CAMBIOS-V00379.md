# V00379 — Registrar Movimiento encuentra la regla de Logística Fletes

## Causa
`statusRules.ts → construirConfigId()` armaba el id del flujo con `formatTitleCase`,
que deja en minúsculas todo menos la primera letra: **"Logistica Fletes" → "Logistica fletes"**.
Los ids de Firestore distinguen mayúsculas, así que buscaba
`Logistica fletes_Importación_Cargado` y el flujo guardado es
`Logistica Fletes_Importación_Cargado`. Además, cuando la carga se infería del convenio,
solo reconocía "Cargada/Llena" y no "Cargado/Vacio".
El formulario sí funcionaba porque su `buildConfigId` ya resolvía por índice normalizado.

## Cambio (solo `src/features/operaciones/config/statusRules.ts`)
- `buscarFlujoPorIndice()`: si los intentos por id fallan, lee `config_flujos_operacion`
  (índice en memoria 5 min) y compara tipoServicio / trafico / carga normalizados
  (sin acentos ni mayúsculas; Cargado=Cargada=Llena, Vacio=Vacía). Prefiere lo capturado
  en la operación; el texto del convenio solo completa lo que falte.
- `limpiarCacheFlujos()` también limpia el índice.
- Aplica a todo lo que usa `obtenerDocFlujo`: Registrar Movimiento, botones de horario,
  cascada automática y el descuento del puente.

## Archivos
- src/features/operaciones/config/statusRules.ts
- src/config/historialCambios.ts
- public/version.json

Verificación: tsc 0 errores; eslint statusRules 32 (baseline exacto); build OK.
