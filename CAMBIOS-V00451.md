# V00451 — Facturas que se quedaban "pendientes" y carga de varios archivos en toda la app

**Web** (deploy de hosting de siempre). Sin reglas, índices ni banderas nuevas.
**Opcional, Cloud Functions**: una línea en `functions/src/relacional.ts` (ver §4). La web funciona igual sin desplegarla.

## 1. Facturas de Clientes y Proveedores: "la facturé con documento y sigue pendiente" (LO-081026-004)

Se encontraron cinco caminos que llevaban a ese síntoma (todos con la bandera `dineroPorServidor` apagada, que es como está producción):

| # | Qué pasaba | Corrección |
|---|---|---|
| 1 | Facturar decidía con la lista cargada. Si otra persona/pestaña ya había facturado la operación, o ya existía una factura con ese número que no estaba en la lista, se creaba **otra factura con el mismo folio** y el documento se subía a esa segunda, escondida detrás de la primera en el Historial. | `services/facturarSeguro.ts`: antes de facturar se pregunta al **servidor** (`operacionesYaFacturadas`: campos de la operación + facturas con la operación en `operacionesIds`; `facturaExistenteFresca`: el folio en varias escrituras). Si ya está facturada: aviso, no se crea nada, se cierra la ventana y se refresca. Lo mismo al **mover** una operación a otro folio y al **agregar** una referencia a una factura. |
| 2 | "Editar factura" precargaba `subtotalFactura` (la conversión a pesos). Abrirla solo para adjuntar el documento y guardar cambiaba el total de una factura en dólares → en Pagos quedaba saldo pendiente. | El editor precarga el total **en la moneda de la factura** (el mismo de la tabla) y solo escribe el total si se cambió; entonces queda como capturado a mano (`totalManualCentavos`) para que el recálculo del servidor no lo regrese a la suma de renglones. En grupos (varios documentos con el mismo folio) el total ya no cuenta dos veces los renglones de los documentos puestos en 0 (`totalDeFilaFactura`). |
| 3 | Operaciones con un campo `id` guardado distinto al ID del documento (importadas): facturar escribía en el ID equivocado → "Error al guardar la factura." (o un documento suelto) y la operación seguía pendiente. | Toda escritura a la operación desde Facturación usa el **ID real** (`idRealOp`). |
| 4 | El formulario de la operación guardaba su copia (vieja) de los campos de factura: editar la operación después de facturar podía "desfacturarla". | `services/camposAjenos.ts`: el formulario ya no escribe campos de otros módulos (factura cliente/proveedor, nómina, diésel, puentes, confirmación de tarifa, revisión de Ref). La bitácora se agrega con `arrayUnion`. |
| 5 | Quitar una referencia de una factura agrupada escribía la lista combinada en el primer documento. Servicios Completados mostraba "Factura: Pendiente" con la lista descargada antes. | Quitar referencia trabaja documento por documento con datos frescos. La ficha de Completados lee los campos de factura del servidor al abrirse y recibe los cambios de Facturación al momento. |

Además: si al quitar/mover una operación se borra un documento de factura que tenía archivos y queda otro documento con el mismo folio, **los archivos pasan a ese otro** (antes se perdían). Pagos (Editar pago) tampoco cambia el total si no se tocó.

### Revisar en la consola de Firebase el caso LO-081026-004 (lo ya guardado NO lo arregla el código)
1. **Firestore → `operaciones`**, filtro `ref == LO-081026-004`: ¿cuántos documentos? Anota el **ID del documento** y si tiene un campo `id` distinto. Revisa `status`, `facturaClienteId`, `facturaClienteInvoice`, `facturado`, `facturaProveedorId`, `facturaProveedorFolio`, `facturadoProveedor`.
2. **`facturas_clientes`** (y `facturas_proveedores`), filtro `operacionesIds array-contains <ID de la operación>` (prueba también con el valor del campo `id` si es distinto): 0 = se perdió la liga; 2 o más = factura duplicada.
3. **`facturas_clientes`**, filtro `invoice == <folio>`: si hay 2 documentos, compara `clienteId`, `fecha`, `docFacturaUrl`, `subtotalFactura` vs `subtotalMonedaFactura`, `montoPagado`, `saldoPendiente`, `statusPago`, `totalManualCentavos`, `pagosIds`.
4. **Storage** → `facturas_documentos/facturas_clientes/<id de cada factura>/`: dónde quedó el PDF.
5. **`historial_actividad`** desde el 2026-10-08 con la referencia o el folio; y pregunta a quien facturó si vio "Error al guardar la factura.".

**Cómo dejarlo bien con la V00451 publicada**: si la operación no está en ninguna factura, facturarla de nuevo (si el folio ya existe, se agrega a esa factura y el documento se suma a sus documentos). Si hay dos documentos con el mismo folio, abrir la fila (ya muestra los archivos de ambos) y "Editar factura" → Guardar consolida los documentos en el primero. Si el total quedó en pesos, corregirlo en "Editar factura" (queda como capturado a mano).

## 2. Carga de archivos: la misma en toda la app
Componente único `src/shared/components/AdjuntosArchivos.tsx` (el del comprobante de Pagos de la V00450, ahora para varios archivos):
- Zona punteada: clic o **arrastrar uno o varios**. Un renglón por archivo: nombre, tamaño, *Guardado* / *Se sube al guardar*, **Ver**, **Reemplazar**, **×**.
- **Vista previa en el mismo formulario** (PDF en visor, imagen tal cual). Nada se sube hasta **Guardar**.
- PDF o imagen (o cualquier archivo donde antes se aceptaba cualquiera), **máx. 20 MB** por archivo. Nombre único en Storage + caché de un año.

| Dónde | Máximo | Dónde se guarda |
|---|---|---|
| Pagos — comprobantes | 10 | `pagos.comprobantes[]` + `pdfUrl`/`pdfNombre` = el primero |
| Facturación Clientes y Proveedores — documentos de la factura (Generar, Editar, píldora "Doc ✓ (n)" y ficha → ventana "Documentos de la factura") | 10 | `docsFactura[]` + `docFacturaUrl/Nombre/Fecha/Por` = el primero |
| Tarifario Clientes y Proveedores — documento firmado (botón de la fila, detalle, Aprobar, formulario) | 10 | `docsFirmados[]` + `docFirmadoUrl/…` = el primero (la aprobación sigue revisando que haya al menos uno) |
| MTTO — archivos del gasto (**antes no se guardaban**) | 10 | `archivos[]` + `archivoPdfUrl`/`archivoPdfNombre` |
| Herramientas del colaborador | 10 | `DOCUMENTOS[]` + `DOCUMENTO` |
| Diésel — fotos de la referencia (nueva y en el detalle) | 10 | `fotos[]` (igual que antes) en `referencias_diesel/<id>/` |
| Expedientes (Subir Documento: colaboradores, empresas, unidades, operaciones…) | **sin límite** | un documento de `documentos` por archivo; "Tipo (2)", "Tipo (3)"… |
| Formulario de la operación — Carta Porte, DODA, cada Entry's, Manifiesto | **sin límite** | se **agregan** a los documentos de la operación (antes el nuevo pisaba al anterior) |
| Foto del colaborador, logo de la empresa, Mi Perfil, foto de usuario | 1 | igual que antes (las de usuario siguen en base64) |

- **Expedientes**: al elegir el tipo se ven los archivos que ya tiene; se pueden agregar, reemplazar o quitar. En la lista de documentos cada renglón tiene **Ver** (vista previa debajo) y **Reemplazar**. Un archivo de Storage nunca se borra si otro documento lo usa.
- Lo que solo lee un archivo (portal de clientes, Roelca Móvil, aprobación del tarifario) sigue leyendo el **primero** en los campos de siempre. En un folio repetido, los demás documentos del grupo guardan también el primero en `docFacturaUrl` (el portal los muestra por separado).
- Los registros viejos (un solo archivo) se leen igual y se convierten a lista al guardarlos.

## 3. Otros
- `operacionesBus`: el aviso puede decir qué campos cambiaron (`campos`); Facturación y Completados aplican solo esos (una copia vieja ya no pisa datos más nuevos).
- `DataImportView` (importar CSV) no cambia: no es un documento.
- Archivos quitados: se borran de Storage solo en expedientes y el logo. En los demás (facturas, pagos, tarifarios, MTTO, diésel, herramientas) el archivo quitado o reemplazado se queda en Storage (como el comprobante de Pagos de la V00450).

## 4. Opcional: Cloud Functions
`functions/src/relacional.ts`: `'docsFactura'` agregado a `CAMPOS_SIN_DINERO_FACTURA` para que, cuando se encienda `dineroPorServidor`, adjuntar documentos no dispare un recálculo de dinero. Con la bandera apagada no hace falta. Si se quiere publicar: `firebase deploy --only functions` (nunca sin `--only`).

## Archivos
- Nuevos: `src/shared/archivos/adjuntos.ts` (+ pruebas), `subirAdjuntos.ts`; `src/shared/components/AdjuntosArchivos.tsx/.css`, `VistaPreviaArchivo.tsx`; `src/shared/hooks/useUrlArchivo.ts`; `src/features/facturacion/services/facturarSeguro.ts`, `documentosFactura.ts`, `guardarDocsFactura.ts` (+ pruebas); `components/DocumentosFacturaModal.tsx/.css` (+ prueba); `src/features/tarifarioClientes/components/ModalDocsFirmados.tsx/.css` (+ prueba), `services/docsFirmados.ts`; `src/features/documentos/expediente.ts` (+ pruebas), `expedienteServicio.ts`; `src/features/operaciones/services/camposAjenos.ts` (+ pruebas).
- **Borrados** (los reemplaza el componente compartido): `src/features/pagos/components/AdjuntoComprobante.tsx`, `AdjuntoComprobante.css` (pasó a `src/shared/components/AdjuntosArchivos.css`), `src/features/pagos/services/comprobante.ts`, `comprobante.test.ts`.
- Cambian: Facturación Clientes/Proveedores (+ `TarjetaDocumentoFactura`), Pagos, Tarifarios, `DocumentoUploadModal`, `DocumentosLista`, `CampoArchivo`, `documentosOperacion.ts`, `FormularioOperacion`, `ServiciosCompletados`, MTTO (formulario y tablero), Herramientas, `EmployeeForm`, Diésel, `ConfiguracionEmpresa`, `MiPerfil`, `UsuariosDashboard`, `operacionesBus`, `totalesFactura.ts`.

## Pruebas
- `npm run verificar`: 33 archivos, 342 pruebas; Cloud Functions: build + 49 pruebas.
- Revisión independiente del cambio (agente aparte): 13 hallazgos; corregidos los de datos (comprobantes al editar pago, total de grupo, modal tras "ya facturadas", documentos al borrar un documento del grupo, mover/agregar con revisión en servidor, avisos parciales, slots de la operación que pisaban, archivo compartido, portal, folio en más escrituras, fotos base64, claves repetidas).
- Banco de pruebas en navegador (Firebase simulado), dos corridas: todos los lugares de carga (agregar, ver, reemplazar, quitar, arrastrar, límites de tipo/tamaño/cantidad, error de Storage), facturar con 2 documentos, "ya facturadas" (operación marcada y factura con la operación), folio existente en el servidor, totales de grupo, rescate de documentos en los tres caminos, operación con `id` distinto, consolidación de grupo. Sin errores de consola.

## Límites conocidos
- El folio se busca en el servidor en varias escrituras (como se capturó, sin espacios, MAYÚSCULAS, minúsculas, Primera mayúscula, Cada Palabra, número). Una mezcla rara (p. ej. `iNv-SRV`) de una factura que no esté en la lista cargada no se encuentra; la forma completa es un campo normalizado escrito por el servidor (requiere deploy de functions).
- El portal de clientes muestra solo el primer documento de cada factura.
- Una versión vieja de la app (sin recargar) que suba un documento a una factura que ya tiene lista `docsFactura` no lo verá en la lista hasta que esa computadora se actualice.
