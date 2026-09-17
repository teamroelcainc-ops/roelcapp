# V00283 — Edición completa de tarifas en la ficha, moneda obligatoria, razón social fija y "subido por" en documentos

## Archivos que cambian (respetar rutas)
- `src/features/tarifarioClientes/components/TarifarioClientesDashboard.tsx` y `.css`
- `src/features/tarifarioProveedores/components/TarifarioProveedoresDashboard.tsx` y `.css`
- `src/features/conveniosDetalles/components/DetallesConvenioDashboard.tsx`
- `src/features/documentos/DocumentosLista.tsx` y `DocumentoUploadModal.tsx`
- `src/features/facturacion/components/FacturacionClientesDashboard.tsx` y `FacturacionProveedoresDashboard.tsx`
- `src/config/version.ts` y `public/version.json` — bump a V00283.

## 1-3) La fila del convenio en la ficha del tarifario ahora se edita completa
En "Detalle del Pre Convenio" (clientes Y proveedores), cada línea trae:
- **✏ Editar** — abre el mini-editor de la tarifa: costo, moneda de
  cotización y status, con **Cancelar / Guardar cambios** (verde). Al
  guardar también actualiza el DETALLE del convenio ligado (tarifa,
  moneda y status por consecutivo) — todo queda sincronizado.
- **🗑 Eliminar** — quita la tarifa del pre convenio con confirmación; si
  la línea ya tiene CONV-###, también elimina su detalle en Convenios
  (el confirm lo avisa).
- **+ Agregar tarifa** (en el pie de la ficha) — abre el mismo editor en
  modo nuevo: tarifa del catálogo, costo, moneda y status. Si el
  tarifario YA tiene convenio, la línea nace con su consecutivo CONV-###
  reservado y su detalle creado al instante; si aún no, el consecutivo
  llega al aprobar (flujo normal).

## 4) Moneda de cotización OBLIGATORIA
- En el alta del pre convenio (clientes y proveedores) el select de cada
  tarifa ahora inicia en "— Elegir —" y **no se puede guardar** sin
  elegir USD o MXN (el aviso dice exactamente qué tarifa falta). Aplica
  también a las tarifas adicionales (+).
- En el mini-editor de línea: el botón Guardar se bloquea sin moneda.
- En Detalles del Convenio: el alta ya la exigía y ahora la EDICIÓN
  también valida "Cotizado En" antes de guardar.

## 5) El nombre del cliente/proveedor ES la razón social
En la tabla y en la ficha de ambos tarifarios, el nombre mostrado se
resuelve SIEMPRE por el id de la empresa contra Empresas (razón social
actual); el texto guardado queda solo de respaldo. Si se renombra la
empresa, todos los tarifarios lo reflejan al momento.

## 6) "Subido por" en todos los documentos
- **Tarifario firmado:** al subir se guarda `docFirmadoPor` (correo del
  usuario) y la ficha muestra "Documento subido por … · fecha".
- **Documento de la factura** (clientes y proveedores): se guarda
  `docFacturaPor` y el tooltip del indicador 📄 lo muestra.
- **Documentos de operación** (Subir Documento): se guarda `subidoPor` y
  la lista muestra "Subido: fecha · por correo".
Los documentos ya subidos no traen el dato (se registra de aquí en
adelante).

## Verificación
- `tsc --noEmit`: 0 errores. ESLint idéntico a la base en TODOS:
  TarifarioClientes 0, TarifarioProveedores 0, DetallesConvenio 0,
  DocumentosLista 10, DocumentoUploadModal 9, FacturaciónClientes 308,
  FacturaciónProveedores 335. `grep style={{}}` en tarifarios: 0.
- `npm run build`: OK (PWA generada).
