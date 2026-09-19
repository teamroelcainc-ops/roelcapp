# V00320 — Auditoría en TRES COLUMNAS con el camino de la operación iluminado + monedas

## Archivos que cambian (respetar rutas)
- `src/features/facturacion/components/AuditoriaCadenaCliente.tsx` y `.css`
- `src/config/version.ts` + `public/version.json` — V00320.

## Qué cambia
El resultado de la auditoría ahora se divide en TRES COLUMNAS lado a
lado, cada una con su PROPIO scroll vertical:
**Operaciones | Facturación | Pagos**

- **Clic en una operación** → se ilumina EL CAMINO que tomó: su(s)
  factura(s) en la columna de Facturación y los pagos que las cubrieron
  en la de Pagos (marco morado); lo que no pertenece al camino se atenúa.
  Otro clic en la misma operación deselecciona.
- **Monedas a la vista**:
  · La MONEDA DEL CLIENTE (de su ficha) aparece junto al buscador al
    elegirlo, y va también en el Excel.
  · Cada operación muestra su moneda (la del convenio del cliente).
  · Cada factura muestra su moneda de facturación (y su conversión).
  · Cada pago muestra su moneda.
- Cada tarjeta conserva su semáforo por veredicto (verde/ámbar/rojo en el
  borde izquierdo) y su explicación.
- El Excel ahora trae 4 hojas: Operaciones, Facturación, Pagos y Totales
  (con la moneda del cliente), con la moneda en cada hoja.
- En pantallas angostas las columnas se apilan (cada una conserva su
  scroll).

## Verificación
- `tsc --noEmit` ✓ · eslint del componente en 0 · `npm run build` ✓

## Al instalar
Reemplaza los 2 archivos + versión, `npm run build` y publica.
