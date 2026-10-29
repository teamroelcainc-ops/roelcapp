# V00522 — Facturación de Clientes: importe de cada referencia · pestaña Corregir · sin "Corregir monedas y montos"

**Solo web.** Va encima de la V00521. Sin funciones, reglas, índices, banderas ni dependencias. **No escribe datos**: ningún total cambia.

## Qué cambia

### 1. Referencias con su importe
En Historial de Facturas → columna **Referencias**:
- Al lado de cada referencia sale lo que cobra en la factura, en la moneda de la factura. Por ejemplo, `TR-271026-026 $ 150.00`.
- Si las referencias no suman el total de la factura, aparece un aviso al final:
  - **Suman $…** en rojo: no suman el total;
  - **Suman $…** en amarillo: la diferencia es justo el IVA (16%), como en la A5510 (suman $415.00 y el total es $481.40);
  - **Sin importes**: la factura no guardó lo que cobró cada operación (facturas viejas importadas).
- Pasa el mouse sobre el aviso y dice la suma, el total y que está en la pestaña Corregir.
- Las canceladas no llevan aviso.

### 2. Pestaña Corregir
Está junto a Revisión.
- Lista **todas** las facturas cuya suma de operaciones no es igual a su total, sin importar los filtros del historial.
- Por cada una: invoice, fecha, cliente, moneda, número de operaciones, suma de operaciones, total, diferencia y el motivo.
- Los motivos son:
  - sus operaciones no suman el total;
  - la diferencia es el IVA (16%);
  - no guardó lo que cobró cada operación;
  - no tiene operaciones.
- Arriba hay filtros por motivo, con cuántas hay de cada uno.
- La pestaña dice cuántas son.
- **Revisar**:
  - la primera vez se revisa sola al abrir la pestaña;
  - **Revisar de nuevo** vuelve a buscar;
  - busca entre las facturas que ya están en pantalla (no lee nada más);
  - **no cambia ningún total**.
- **Ver factura** abre su Ficha para corregirla a mano.
- Las canceladas no se revisan.
- Se muestran de 300 en 300.

### 3. Sin "Corregir monedas y montos"
- Se quitó ese botón de la barra del Historial de **Facturación de Clientes**.
- En Facturación de Proveedores sigue.

## Archivos (12)
- `src/features/facturacion/services/cuadreFactura.ts` (nuevo) y `cuadreFactura.test.ts` (nuevo)
- `src/features/facturacion/components/CorregirTotalesFacturas.tsx` (nuevo) y `CorregirTotalesFacturas.css` (nuevo)
- `src/features/facturacion/components/FacturacionClientesDashboard.tsx` y `.css`
- `src/features/facturacion/components/AccionesHistorial.tsx` (el botón de corregir es opcional)
- `src/config/version.ts`, `public/version.json`, `src/config/historialCambios.ts`, `code-notes.md`, `CAMBIOS-V00522.md`

## Pasos manuales
1. Aplica el zip encima de la V00521 (no hay archivos borrados) y haz el commit: el conteo debe dar **12**.
2. Push y publicar: `npm run build` y `npx wrangler deploy`.
3. Prueba:
   1. Busca A5510 en el Historial: sus referencias traen su importe y el aviso amarillo "Suman $ 415.00".
   2. Abre la pestaña Corregir: debe salir A5510 con el motivo "La diferencia es el IVA (16%)".
