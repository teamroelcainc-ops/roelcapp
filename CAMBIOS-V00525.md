# V00525 — Facturación de Clientes: Actualizar guarda lo que cobra cada operación en las facturas que no lo tenían

**Solo web.** Va encima de la V00524. Sin funciones, reglas, índices, banderas ni dependencias. Escribe una factura a la vez, al presionar Actualizar.

## El problema
En la factura 35539 la operación TR-080126-13 sale en **$ 0.00** en la Ficha, aunque la operación cobra $140.00. La factura (de AppSheet) no guardó lo que cobró cada operación. Editar la operación y guardar no la cambiaba, y **Actualizar** en Editar factura no hacía nada con esas facturas (la V00520 las dejaba fuera a propósito).

## Qué cambia
- **Editar factura**, en una factura sin importes:
  - cada operación dice "Sin importe en la factura · hoy $140.00 USD";
  - el aviso dice: "Al presionar **Actualizar** se guarda lo que cobra hoy cada una: suman $…; el total ($…) no cambia";
  - **Actualizar** se activa y, al presionarlo, guarda el desglose. Usa la misma regla que Completar importes, para esta factura sola: el total no cambia y, si no lo tenía guardado, se guarda el mismo;
  - si no suman el total, lo avisa: después la verás en Corregir con la diferencia;
  - si no se puede (solo guardó referencias, la operación está en otra factura, etc.), lo dice en lugar del aviso.
- **Ficha de Factura**: en esas facturas, arriba de las referencias sale el aviso "Esta factura no guardó lo que cobró cada operación (por eso salen en $0.00)…" con un enlace a **Editar factura**.
- No se hace con la bandera dineroPorServidor encendida, ni si en la misma edición se está cancelando la factura.

## Archivos (8)
- `src/features/facturacion/components/FacturacionClientesDashboard.tsx` y `.css`
- `src/features/facturacion/components/OperacionesFacturaEdicion.tsx`
- `src/config/version.ts`, `public/version.json`, `src/config/historialCambios.ts`, `code-notes.md`, `CAMBIOS-V00525.md`

## Pasos manuales
1. Aplica el zip encima de la V00524 (no hay archivos borrados) y haz el commit: el conteo debe dar **8**.
2. Push y publicar: `npm run build` y `npx wrangler deploy`.
3. Prueba con la 35539:
   1. Ficha → Editar factura → Actualizar.
   2. La operación debe quedar en $140.00 y el total en $140.00.
