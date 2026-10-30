# V00531 — Facturación: "Ver documento" abre la factura en otra pestaña · "Editar factura" en la Ficha

**Solo web.** Va encima de la V00530. Sin funciones, reglas, índices, banderas ni dependencias.

## 1. "Ver documento" abre la factura en otra pestaña
- En la tarjeta del documento de la Ficha (Clientes y Proveedores), **Ver documento** abre la factura en **otra pestaña** del navegador. Abre el PDF; si no hay, la imagen; si no, el primer archivo.
- Antes, el botón abría la ventana para agregar o quitar documentos. Esa ventana ahora está en **Agregar o cambiar** (agregar, reemplazar o quitar, como siempre).
- Los nombres de los archivos de la tarjeta siguen abriendo cada uno en otra pestaña.
- Los documentos viejos guardados en base64 también se abren: se convierten a un archivo local al momento, porque el navegador no deja abrirlos directo.

## 2. "Editar factura" en la Ficha
- Arriba de la Ficha de Clientes, junto a Remisión, está **✎ Editar factura**.
- Abre Editar factura con todo: número, fecha, status, cliente, total, documentos y sus operaciones. Al guardar, la Ficha se queda abierta con los cambios.

## Archivos (13)
- `src/features/facturacion/components/TarjetaDocumentoFactura.tsx`
- `src/features/facturacion/services/documentosFactura.ts` (`documentoPrincipal`)
- `src/features/facturacion/services/leerDocumentoFactura.ts` (el aviso nombra "Agregar o cambiar")
- `src/shared/archivos/adjuntos.ts` (`urlParaPestana`)
- `src/features/facturacion/components/DocumentosFacturaModal.test.tsx` y `DocumentoFichaCliente.test.tsx`
- `src/features/facturacion/components/FacturacionClientesDashboard.tsx` y `.css`
- `src/config/version.ts`, `public/version.json`, `src/config/historialCambios.ts`, `code-notes.md`, `CAMBIOS-V00531.md`

## Pasos manuales
1. Aplica el zip encima de la V00530 (no hay archivos borrados) y haz el commit. El conteo debe dar **13**.
2. Publica la web.
3. Prueba con la E4542:
   1. **Ver documento** abre el PDF en otra pestaña.
   2. **Agregar o cambiar** abre la ventana de documentos.
   3. **✎ Editar factura** abre Editar factura.
