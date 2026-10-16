# V00460 — Últimas capturas de diesel: descuento y costo real

**Solo web.** Sin funciones, reglas, índices ni banderas.

## Qué cambia
- Operaciones Activas → tarjeta **Diesel** → *Últimas capturas de diesel*: dos columnas nuevas después de *Por galón*:
  - **Descuento**: Murphy descuenta **$0.20 por galón**; los demás proveedores muestran —.
  - **Costo real**: por galón − descuento (lo que de verdad cuesta el galón).
- La etiqueta **más bajo** marca el **costo real** más bajo de cada día (antes, el precio de lista). Ejemplo: La Noria $5.50 y Murphy $5.60 → más bajo Murphy ($5.40 real).
- *Por litro* sigue siendo sin descuento. La tarjeta Diesel sigue mostrando el precio de lista más bajo de hoy.

## Pasos manuales
Ninguno además de aplicar el zip (va encima de la V00459).

## Técnico
- `features/operaciones/services/resumenDia.ts`: `FilaDiesel` con `descuento` y `costoReal`; `filasDiesel` usa `DESCUENTO_MURPHY_POR_GALON` y `esCargaMurphy` de `shared/dominio/cobroDiesel.ts` (Murphy por el nombre guardado en `combustibles.proveedor`). El descuento se muestra en todas las fechas: es información de precio y no mueve saldos (el estimado de las cargas sigue empezando el 17-oct). Prueba nueva en `resumenDia.test.ts`.
- `ModalHistorialResumen.tsx/.css`: columnas, nota del modal y ancho máximo 1080 px (en pantallas chicas la tabla se desliza dentro del marco).
- Banco de pruebas: columnas y montos correctos (5.59 → 5.39), más bajo por costo real (12-oct: Murphy aunque su precio de lista es mayor), cabe a 1280 px, sin errores de consola.
