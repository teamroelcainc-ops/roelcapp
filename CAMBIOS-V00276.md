# V00276 — Documento de la factura en Facturación (clientes y proveedores)

## Archivos que cambian (respetar rutas)
- `src/features/facturacion/components/FacturacionClientesDashboard.tsx` y `.css`
- `src/features/facturacion/components/FacturacionProveedoresDashboard.tsx` y `.css`
- `src/config/version.ts` y `public/version.json` — bump a V00276.

## 1) Al FACTURAR se pide el documento
En el modal de Confirmar Factura (Asignar Operaciones) hay un campo nuevo
"DOCUMENTO DE LA FACTURA": eliges el PDF/imagen y SE SUBE AL CONFIRMAR,
ya con el id real de la factura (Storage `facturas_documentos/…`, campos
docFacturaUrl/Nombre/Fecha — relación 1:1, mismo patrón del tarifario
firmado). Si no lo adjuntas, la app pregunta "¿Facturar sin el
documento?" — puedes continuar, pero la factura queda marcada con ⚠.

## 2) También en la FICHA y en EDITAR
- Ficha (👁): botón 📄/⚠ "Documento" en la cabecera — clic ve el
  documento (Ctrl+clic reemplaza) o lo sube si falta.
- Editar (✎): campo "DOCUMENTO DE LA FACTURA" — muestra el subido con
  opción de reemplazar; el archivo elegido se sube al guardar.

## 3) Icono de alerta en la tabla — Historial Y Pagadas
Al inicio de las acciones de cada fila: ⚠ ámbar pulsante si la factura
no tiene documento (hoy: todas), 📄 verde si ya lo tiene (clic ve,
Ctrl+clic reemplaza), ⏳ mientras sube. Historial de Facturas y Pagadas
comparten la misma tabla, así que el indicador aplica a ambas pestañas.
Cada subida queda en el log del módulo.

## Verificación
- `tsc --noEmit`: 0 errores. ESLint: FacturacionClientes 308 y
  FacturacionProveedores 335 — IDÉNTICOS a su base.
- `npm run build`: OK (PWA generada).

## Nota
Igual que con los tarifarios: si Storage rechaza la subida, hay que
permitir la ruta `facturas_documentos/` en las reglas. Si quieres
después un filtro "Sin documento" para cazar las ⚠, es un cambio corto.
