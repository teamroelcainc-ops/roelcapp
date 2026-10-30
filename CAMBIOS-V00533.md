# V00533 — Facturación de Clientes: el subtotal se puede escribir en Editar factura y avisa si coincide con el subtotal del documento

**Solo web.** Va encima de la V00532. Sin funciones, reglas, índices, banderas ni dependencias.

## Qué pasaba (E48, sustituye a la A5506)
- La factura guardó **$481.40**: es el TOTAL del CFDI, con IVA.
- Sus operaciones (TR-190126-4 $105 + TR-190126-5 $310) suman **$415.00**: es el SUBTOTAL del CFDI.
- En Editar factura el monto no se podía cambiar: desde la V00519 salía fijo de sus operaciones.

## Qué cambia en Editar factura (Clientes)
- El campo se llama **Subtotal facturado (sin IVA)** y se puede escribir.
- Al abrir, la app lee el PDF o XML de la factura (primero el XML) y avisa debajo del campo:
  - ✅ en verde: **Coincide con el subtotal del documento**.
  - ⚠️ en amarillo: no coincide; dice el subtotal del documento y la diferencia. Si escribiste el total con IVA, lo dice.
  - ℹ️ si no es lo que suman hoy sus operaciones: la factura saldría en Corregir.
  - Sin PDF ni XML, o si no se pudo leer, lo dice.
- **Solo avisa**: Actualizar guarda lo que escribiste.
- Al guardar, la factura se relee en el servidor:
  - no deja un subtotal por debajo de lo ya pagado;
  - el saldo y su status se recalculan;
  - la conversión a pesos se ajusta;
  - queda como capturado a mano, para que no se regrese solo.
- Queda en la bitácora.
- En un folio con varios registros el subtotal sigue fijo. Proveedores no cambia.

## Archivos (12)
- `src/features/facturacion/services/subtotalManual.ts` y `subtotalManual.test.ts` (nuevos)
- `src/features/facturacion/hooks/useLecturasDocumentos.ts` (nuevo)
- `src/features/facturacion/components/SubtotalFacturaEdicion.tsx` y `.css` (nuevos)
- `src/features/facturacion/components/FacturacionClientesDashboard.tsx` y `.css`
- `src/config/version.ts`, `public/version.json`, `src/config/historialCambios.ts`, `code-notes.md`, `CAMBIOS-V00533.md`

## Pasos manuales
1. Aplica el zip encima de la V00532 (no hay archivos borrados) y haz el commit. El conteo debe dar **12**.
2. Publica la web.
3. Prueba con la E48:
   1. Abre Editar factura.
   2. Debajo del subtotal dice que 481.40 es el TOTAL del documento.
   3. Escribe 415: dice ✅ Coincide.
   4. Presiona Actualizar.
