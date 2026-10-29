# V00516 — Facturación de Clientes: Analizar el documento de una factura ya subida

**Solo web.** Va encima de la V00515. Sin funciones, reglas, índices, banderas ni dependencias, y no cambia datos.

## Qué cambia

### Ficha de Factura (Facturación de Clientes)
- La tarjeta del documento tiene un botón nuevo, **Analizar documento** (o **Analizar documentos** si hay varios), al lado de Ver documentos.
- Descarga el PDF o XML que **ya está subido** y lo compara con lo que tiene la factura en la app, con la misma revisión de la V00514:
  - número de factura o invoice;
  - cliente;
  - moneda;
  - las operaciones (referencias);
  - el costo de cada operación;
  - el subtotal.
- Debajo de la tarjeta dice "✅ El documento coincide con la factura" o qué no coincide ("El costo no concuerda…", "Ese subtotal no concuerda con la factura…", "Esas no son las operaciones…", "El cliente no es el mismo…").
- **Ocultar análisis** (u **Ocultar**) lo cierra. Al abrir otra factura empieza cerrado.
- Cada documento se descarga una vez por sesión. Si falla la descarga, se reintenta al volver a analizar.
- Las imágenes no se pueden leer: solo los PDF y XML. Si la factura solo tiene imágenes, no aparece el botón.
- Funciona también con los registros viejos que guardaron el documento sin nombre ni extensión (se reconoce por su contenido).
- Solo revisa: no cambia la factura ni el documento.

### Mensajes si no se puede analizar
- "El documento ya no está en el almacenamiento…": el archivo se borró o su enlace ya no sirve. Vuelve a subirlo en Ver documentos.
- "No se pudo descargar el documento guardado… falta permitir que la app lea el almacenamiento (CORS)": ver el paso 3.

## Archivos (13)
- `src/features/facturacion/services/leerDocumentoFactura.ts`
- `src/features/facturacion/components/DocumentoFichaCliente.tsx` (nuevo) y `DocumentoFichaCliente.test.tsx` (nuevo)
- `src/features/facturacion/components/RevisionDocumentosFactura.tsx` y `.css`
- `src/features/facturacion/components/TarjetaDocumentoFactura.tsx` y `.css`
- `src/features/facturacion/components/FacturacionClientesDashboard.tsx`
- `src/config/version.ts`, `public/version.json`, `src/config/historialCambios.ts`, `code-notes.md`, `CAMBIOS-V00516.md`

## Pasos manuales
1. Aplica el zip encima de la V00515 (no hay archivos borrados) y haz el commit: el conteo debe dar **13**.
2. Push y publicar: `npm run build` y `npx wrangler deploy`.
3. **Solo si** al analizar sale el mensaje de CORS con todos los documentos: el almacenamiento (bucket) no deja que la app descargue los archivos. Se configura una sola vez desde tu computadora, con el `cors.json` que ya está en el repo:
   ```bash
   gcloud storage buckets describe gs://roelcaapp.firebasestorage.app --format="default(cors_config)"
   gcloud storage buckets update gs://roelcaapp.firebasestorage.app --cors-file=cors.json
   ```
   - El primero muestra si ya hay CORS. Si ya aparece una regla con `GET`, no hagas el segundo y mándame el mensaje exacto.
   - `cors.json` permite solo lectura (`GET`). Cada enlace de Storage ya lleva su propia llave, así que no abre archivos a quien no tenga el enlace. Si prefieres cerrarlo más, cambia `"*"` por la dirección de tu app.
   - No cambia las reglas de seguridad ni los datos.
