# V00279 — FIX guardar tras reemplazar el documento + el documento NO es obligatorio en facturación

## Archivos que cambian (respetar rutas)
- `src/features/facturacion/components/FacturacionClientesDashboard.tsx`
- `src/features/facturacion/components/FacturacionProveedoresDashboard.tsx`
- `src/config/version.ts` y `public/version.json` — bump a V00279.

## 1) "Guardar cambios" ya no depende del documento
La subida del documento estaba ANTES del guardado en el editor: si
Storage tardaba o rechazaba la subida (reglas), el guardado se quedaba
atorado detrás. Ahora los CAMBIOS DE LA FACTURA SE GUARDAN PRIMERO,
siempre, y el documento se sube después. Si la subida falla, verás un
aviso con el MOTIVO EXACTO (p. ej. `storage/unauthorized`) y podrás
reintentar desde la fila (⚠) — los cambios ya quedaron guardados.
Aplica al editor y al facturar, en clientes y proveedores.

## 2) El documento NO es obligatorio (regla confirmada)
Se quitó la pregunta "¿Facturar sin el documento?" al confirmar la
factura: ahora se factura directo, sin fricción. El icono ⚠ ámbar de la
fila se queda como recordatorio visual (Historial y Pagadas), y el 📄
aparece cuando lo subas. Nada bloquea por falta de documento.

## 3) MUY PROBABLE CAUSA DE FONDO: reglas de Storage
Si al subir te aparece "storage/unauthorized", agrega a tus reglas de
Storage (Firebase Console → Storage → Rules) los bloques:

    match /facturas_documentos/{resto=**} {
      allow read, write: if request.auth != null;
    }
    match /tarifarios_firmados/{resto=**} {
      allow read, write: if request.auth != null;
    }

y publica. Con eso las subidas de facturación Y de tarifarios quedan
permitidas para usuarios autenticados.

## Verificación
- `tsc --noEmit`: 0 errores. ESLint: 308 y 335 — idénticos a su base.
- `npm run build`: OK (PWA generada).
