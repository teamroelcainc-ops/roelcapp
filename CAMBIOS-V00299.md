# V00299 — Relación bidireccional real: editar el CONVENIO actualiza la línea del TARIFARIO (motor v1.3)

## Archivos que cambian (respetar rutas)
- `src/features/conveniosDetalles/components/DetallesConvenioDashboard.tsx`
- `functions/src/relacional.ts` — motor relacional **v1.3** ⚠️ requiere deploy
- `src/config/version.ts` y `public/version.json` — bump a V00299.

## Tu regla, implementada tal cual
"# de tarifario" es la LLAVE FORÁNEA. Tarifario → Convenios ya existía
(motor v1.2 + botones de sincronización). Faltaba el otro sentido:

### 1) Editar el detalle del convenio SE REFLEJA en el tarifario
- **Front (inmediato):** al Guardar en "Editar detalle CONV-###", además
  del detalle se actualiza LA LÍNEA del tarifario (por consecutivo):
  costo, moneda de cotización, status, ORIGEN y DESTINO, y la tarifa del
  catálogo si se cambió. Tu caso: agregar "Nuevo Laredo" a CONV-508 ahora
  aparece también en la línea de TARI-001.
- **Motor v1.3 (server):** triggers nuevos `convenioClienteDetalleEscrito`
  y `convenioProveedorDetalleEscrito` — CUALQUIER escritura de un detalle
  (edición masiva "Guardar cambios (N)", selects de la tabla, apps
  futuras) sincroniza su línea del tarifario. Anti-bucle en ambos
  sentidos: los triggers solo escriben si algo difiere, así el par
  detalle↔línea converge y se detiene.
  ⚠️ Activar con: `firebase deploy --only functions`.

### 2) El editor ya no abre con "Tarifa (catálogo)" vacía
CONV-507 mostraba tarifa en la tabla pero el editor la perdía: el detalle
no traía el ID de la tarifa (creado por sincronización/migrado). Ahora la
tarifa se resuelve también por su NOMBRE contra el catálogo — el campo y
la Descripción (automática) abren completos.

## Verificación
- `tsc --noEmit` app y functions: 0 errores. ESLint: DetallesConvenio 0.
- `npm run build`: OK (PWA generada).
