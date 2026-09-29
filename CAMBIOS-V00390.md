# V00390 — Documento de la factura visible en el historial al confirmar

## Causa
1. En "Generar Factura" el documento SÍ se subía y se guardaba en Firestore, pero la fila nueva del
   historial se agregaba DESPUÉS con los datos de la factura sin el documento → la fila salía
   "Sin doc" y parecía que había que cargarlo de nuevo.
2. El historial se guarda en la caché de la sesión solo al descargarlo; los cambios posteriores
   (facturas nuevas, documentos, status) no se guardaban, así que al volver al módulo se veía la
   versión vieja.

## Cambio (Facturación Clientes y Proveedores)
- La fila nueva (o la factura unida por el mismo invoice) ya incluye docFacturaUrl/Nombre/Fecha/Por.
- La caché de sesión del historial se actualiza con cada cambio del estado.
- Generar Factura: la tarjeta del documento ocupa todo el ancho del formulario.

## Archivos
src/features/facturacion/components/{FacturacionClientesDashboard.tsx, FacturacionProveedoresDashboard.tsx, TarjetaDocumentoFactura.css}
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint igual que antes (308 / 335); build OK.
