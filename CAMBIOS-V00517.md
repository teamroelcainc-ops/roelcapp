# V00517 — Revisión de datos: corregir el status de las operaciones de D3

**Solo web.** Va encima de la V00516. Sin funciones, reglas, índices, banderas ni dependencias. **Escribe datos solo cuando tú lo autorizas** (con los mismos tres pasos de F1).

## Qué cambia

### Operaciones → Revisión de datos → D3 (Sin status)
- **D3** lista las operaciones cuyo status no se encuentra en el catálogo de status. La mayoría tiene el **nombre** del status escrito de otra forma:
  - con otros espacios, acentos o mayúsculas;
  - o con un **nombre viejo**: por ejemplo "3. Documentado" cuando en el catálogo ya se llama "3. Documentado (Asignado)".
- El grupo tiene ahora la corrección **Corregir status**. Busca el status del catálogo de cada operación, primero con su `status` y luego con su `statusNombre`:
  1. **Mismo nombre** (sin importar espacios, acentos ni mayúsculas).
  2. **Nombre anterior:** el del catálogo es el mismo con algo más al final ("… (Asignado)").
  3. **Mismo número:** un solo status del catálogo empieza con ese número ("3.").
- Si hay **uno solo**, se le pone ese status, igual que con los botones de status de Operaciones: el id del catálogo en `status`, su nombre en `statusNombre` y la fecha en `statusCorregidoPorRevision`.
- Si no se parece a ninguno, o se parece a varios (por ejemplo, los dos "4.1"), **no se toca**: se corrige a mano. Las que no tienen nada de status tampoco.
- Antes de aplicar, el panel muestra qué se va a cambiar, agrupado: "3. Documentado" → **3. Documentado (Asignado)** (5).
- Va en tres pasos que no se pueden saltar:
  1. Descargar la prueba (Excel): qué status se le pondría a cada una y cómo se encontró.
  2. Descargar el respaldo: el status que tiene cada una hoy, para deshacerlo.
  3. Escribir **APLICAR** y corregir.
- Al aplicar, cada tanda de 100 va en una transacción que relee la operación y el status del catálogo. Si la operación cambió de status desde la revisión, no se toca.
- Al terminar, las corregidas salen de D3 sin volver a revisar y queda en la bitácora.

## Por qué pasa
- Al crear una operación, el formulario guarda el **nombre** del paso del flujo (Reglas de Estatus) en el status. Si ese nombre no es exactamente el del catálogo (o el status se renombró después en Catálogos), la operación queda sin status del catálogo.
- Los botones de status de Operaciones sí guardan el id, por eso la mayoría no tiene el problema.
- Esta versión corrige las que ya están así; no cambia cómo guarda el formulario (ver code-notes, V00517).

## Archivos (12)
- `src/features/operaciones/services/corregirStatusD3.ts` (nuevo) y `corregirStatusD3.test.ts` (nuevo)
- `src/features/operaciones/components/CorregirStatusD3.tsx` (nuevo) y `CorregirStatusD3.css` (nuevo)
- `src/features/operaciones/components/RevisionDatosModal.tsx`
- `src/features/operaciones/services/revisionDatos.ts` y `revisionDatos.test.ts`
- `src/config/version.ts`, `public/version.json`, `src/config/historialCambios.ts`, `code-notes.md`, `CAMBIOS-V00517.md`

## Pasos manuales
1. Aplica el zip encima de la V00516 (no hay archivos borrados) y haz el commit: el conteo debe dar **12**.
2. Push y publicar: `npm run build` y `npx wrangler deploy`.
3. En Revisión de datos → **Revisar de nuevo** → D3 → Corregir status: baja la prueba, revísala, baja el respaldo (guárdalo), escribe APLICAR y corrige.
