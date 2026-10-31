# V00537 — Reglas de Estatus: los movimientos vuelven a no llevar aduana

**Solo web.** Va encima de la V00536. Sin funciones, reglas, índices, banderas ni dependencias.
**Tipo:** fix (cambia lo que se ve).

## Por qué
La V00474 (22-oct) decidió que los movimientos no cruzan aduana. En tu `main` ese cambio sí está en el formulario de operación, pero se perdió en Reglas de Estatus. Por eso:
- en Reglas de Estatus podías darle aduana a un flujo de Transfer con tráfico de movimiento;
- una operación de movimiento nueva nunca lo usaría: el formulario ya no le pide aduana, y el flujo se elige por la aduana de la operación.

Ahora las dos pantallas usan la misma regla.

## Qué cambia en pantalla (igual que la V00474)
- **Configuración → Reglas de Estatus**, en un flujo de Transfer cuyo tráfico es un movimiento (*Movimiento LDO*, *Movimiento NLD*…):
  - no aparece el selector **Aduana**;
  - en la lista dice **—** si no tiene aduana;
  - si cambias el tráfico a un movimiento, la aduana elegida se quita.
- Un flujo de movimiento que **ya tenga** aduana sigue mostrándola en la lista y sigue funcionando para las operaciones viejas que la traen. Si lo **editas**, se guarda sin aduana.

## Archivos (7)
`src/features/configuracion/components/ConfiguradorStatus.tsx`, versión, historial, `CAMBIOS-V00537.md`, `code-notes.md` y `refactor-progress.md`.

## Pasos manuales
1. Aplica el zip encima de la V00536 (no hay archivos borrados):
   ```
   git add src public/version.json CAMBIOS-V00537.md code-notes.md refactor-progress.md
   ```
   El conteo debe dar **7**.
2. Antes de editar flujos, revisa en Reglas de Estatus si hay alguno de **Transfer + Movimiento** con una aduana en la columna Aduana. Si hay, mándame cuáles y no los edites todavía.

## Qué revisar en el navegador
1. **Flujo de Exportación:** en Reglas de Estatus, abre un flujo Transfer · Exportación. Aparece Aduana.
2. **Cambio a movimiento:** cámbiale el tráfico a Movimiento NLD. El selector de Aduana desaparece. Cancela sin guardar.
3. **Formulario:** en el formulario de una operación de movimiento, sigue sin aparecer Aduana.

## Lo que no pude probar en el navegador real
tsc y ESLint pasan, y `style={{` no sube (46). Es el mismo código de la V00474, que se probó en el banco de pruebas el 22-oct. Esta vez no lo volví a abrir en el simulador.
