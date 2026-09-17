# V00275 — MOTOR RELACIONAL v1.1: cascada de montos Operación → Facturación → Pagos

## Archivos que cambian (respetar rutas)
- `functions/src/relacional.ts` — 3 triggers nuevos (motor v1.1).
- `src/config/version.ts` y `public/version.json` — bump a V00275.
(No cambia nada del front: la cascada es 100% server-side.)

## La regla, ahora automática
1) **Cambia un monto en la OPERACIÓN → cambia en FACTURACIÓN.**
   Trigger `operacionMontoCambiado`: si al guardar una operación cambió
   cualquier campo de dinero (monto del convenio, costo adicional, moneda
   de facturación/convenio, tipo de cambio, y de paso convenioNombre y
   Ref Cliente), busca las facturas de clientes Y de proveedores que la
   contienen (operacionesIds) y actualiza SU renglón en
   operacionesGuardadas (monto, subtotalBase, dol, pes) y los agregados
   subtotalFactura y subtotalMonedaFactura. Las fórmulas son espejo
   exacto de Facturación (calcularConversionCliente/Proveedor y
   totalNativoFactura) — si un día cambian allá, cambiarlas aquí.
2) **Cambia el total de una FACTURA → cambia en PAGOS.**
   Triggers `facturaClienteMontoCambiado` / `facturaProveedorMontoCambiado`:
   si la factura ya tiene pagos aplicados (montoPagado/saldoPendiente),
   recalculan saldoPendiente = total − montoPagado y statusPago
   (PAGADA/PARCIAL). Los documentos de pago aplicados NO se tocan: son
   historial; el módulo de Pagos lee el saldo vivo de la factura.
   Como (1) escribe la factura y eso dispara (2), la cadena completa
   Operación → Factura → Pagos corre sola.

## Anti-bucle y seguridad
Cada trigger escribe SOLO si algo difiere (tolerancia 0.005) — sin
ciclos. Facturas sin snapshot detallado (importadas sin
operacionesGuardadas por id) no se inventan: se dejan como están.
Borrar una operación NO altera facturas (snapshot histórico).

## Al instalar
1) Copiar `functions/src/relacional.ts` y desplegar:
   `firebase deploy --only functions`
   (aparecerán operacionMontoCambiado, facturaClienteMontoCambiado y
   facturaProveedorMontoCambiado junto a los del v1.0).
2) Probar: edita el costo adicional de una operación facturada → abre la
   factura en Facturación (el monto ya viene actualizado) → si esa
   factura tenía pagos, su saldo pendiente en Pagos ya está recalculado.

## Verificación
- `tsc` de functions: 0 errores. Build de la app: OK. Motor v1.0 intacto
  (los 5 triggers previos no se tocaron; solo se agregó el bloque v1.1).
