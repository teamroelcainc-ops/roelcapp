# V00282 — Sincronización tarifario ⇄ convenios (motor v1.2), # de tarifario en el editor y alta rápida de Cliente (Mercancía)

## Archivos que cambian (respetar rutas)
- `src/features/tarifarioClientes/components/TarifarioClientesDashboard.tsx`
- `src/features/tarifarioProveedores/components/TarifarioProveedoresDashboard.tsx`
- `src/features/conveniosDetalles/components/DetallesConvenioDashboard.tsx`
- `src/features/operaciones/components/FormularioOperacion.tsx`
- `functions/src/relacional.ts` — motor relacional **v1.2** ⚠️ requiere deploy
- `src/config/version.ts` y `public/version.json` — bump a V00282.

## 1) CONV-502 Pendiente vs TARI-072 Aprobado — la causa y el cierre
**Causa raíz:** al aprobar un pre convenio, cada detalle nace con el status
de SU línea (`t.status`) — si la línea estaba Pendiente al aprobar, el
detalle nacía Pendiente. Y la rama de RE-aprobación (tarifario que ya tenía
convenio ligado) actualizaba el tarifario pero **no tocaba los detalles**:
por ahí quedó CONV-502 desincronizado.

**Cierre en dos capas:**
- **Front:** al aprobar un tarifario que ya tiene convenio, ahora también
  se aprueban sus detalles (clave = consecutivo de cada línea) y se les
  repara el `tarifarioId`. Clientes y proveedores.
- **Motor relacional v1.2 (server):** triggers nuevos
  `tarifarioClienteEscrito` y `tarifarioProveedorEscrito` — CUALQUIER
  escritura de un tarifario sincroniza el status de cada línea con su
  detalle de convenio y repara el `tarifarioId` faltante. Anti-bucle:
  solo escribe si algo difiere. Con esto, el camino que sea (aprobación,
  edición, cambio de status por línea) deja ambas colecciones iguales.

**⚠️ Para activar el motor v1.2:** `firebase deploy --only functions`
(si Eventarc marca error de permisos, reintenta en 10-15 min).
**Para reparar CONV-502 hoy:** entra a TARI-072 y vuelve a ponerle
Aprobado (o re-guárdalo) — la sincronización lo corrige al instante.

## 2) El # de tarifario del editor de detalles ya aparece siempre
"Editar detalle CONV-###" solo mostraba el tarifario si el detalle traía
`tarifarioId` guardado — los migrados quedaban con el campo vacío. Ahora
se resuelve con LAS TRES relaciones, en orden: (1) `tarifarioId` del
detalle; (2) el tarifario cuyas tarifas[] contienen el consecutivo de ese
detalle — la relación más directa, igual que en V00281; (3) el tarifario
ligado al mismo convenio. Además, al guardar (o al pasar el motor v1.2),
el `tarifarioId` queda reparado en el detalle para la próxima.

## 3) Alta rápida de Cliente (Mercancía)
El botón "+" volvió — SOLO en el campo Cliente (Mercancía) de la pestaña
Pedimento y CT. Abre la misma alta rápida de empresas con el tipo
"Cliente (Mercancía)" preseleccionado y al crear queda elegido en el campo.

## Verificación
- `tsc --noEmit` app y functions: 0 errores. ESLint: TarifarioClientes 0,
  TarifarioProveedores 0, DetallesConvenio 0, FormularioOperacion 377 —
  todos idénticos a su base.
- `npm run build`: OK (PWA generada).
