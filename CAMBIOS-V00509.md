# V00509 — Convenio de Falso al marcar Falso · Botón Actualizar en Empresas

**Solo web.** Va encima de la V00508. Sin funciones, reglas, índices ni banderas.

## 1. Operaciones: el convenio cambia al de Falso
Cuando una operación pasa a un estatus **Falso** (por ejemplo "7. Falso"), su convenio del cliente cambia solo al **convenio Falso del mismo cliente**:
- si el convenio era de **exportación**, pasa al Falso de exportación;
- si era de **importación**, pasa al Falso de importación.

Pasa en todos los lugares donde se cambia el estatus:
- **Operaciones Activas:** Siguiente paso y Registrar movimiento.
- **Canceladas.**
- **Completadas:** Regresar estatus.
- **Editar operación**, al guardar.
- **Mis Operaciones.**

Qué cambia y qué no:
- Cambian también el **monto y la moneda** del convenio, y el **Por Cobrar** (dólares, pesos, conversión y utilidad).
- El sueldo del operador se sigue pagando a la mitad, como ya pasaba.
- Si la operación **sale de Falso** (con Regresar estatus, o deshaciendo la marca en Mis Operaciones), **regresa a su convenio de antes** con su monto.
- **No se cambia:**
  - si la operación ya está **facturada al cliente**, porque su factura ya salió con ese monto;
  - si ya tiene un convenio Falso.
- **Si el cliente no tiene convenio Falso** de importación o de exportación, o si el convenio no dice cuál de los dos es, la app lo avisa y deja el convenio como estaba.
- Cada cambio sale en un aviso, por ejemplo: "TR-271026-028: el convenio cambió a 'Cruce de Importacion - Falso' ($60.00 USD)".
- Solo cambia el convenio del cliente; el del proveedor no se toca.
- **Límite:** la app móvil (Roelca Móvil) tampoco aplica esto, igual que el sueldo de Falso. Si un operador marca Falso desde el teléfono, cámbialo en Editar.

## 2. Empresas: botón Actualizar
El botón **↻ Recargar catálogos** ahora es **↻ Actualizar**:
- Vuelve a contar las operaciones de cada empresa (columna Cantidad de Operaciones) sin recargar la página. Antes ese número se guardaba en el navegador y no cambiaba ni recargando: no veía operaciones nuevas ni las que se pasaron a otra empresa.
- Mientras cuenta dice "Actualizando…".
- Las empresas, monedas y tipos ya llegan en vivo; si alguno falló, Actualizar lo vuelve a leer.
- Para la ficha de una empresa sigue el botón Actualizar de su pestaña Referencias.

## Pasos manuales
1. Aplicar el zip (no hay archivos borrados).
2. No hay que desplegar funciones.
3. Mientras Cloudflare no pueda descargar el repositorio (la falla del 27-oct), publica después del push con `npm run build` y `npx wrangler deploy`.

## Técnico
- `features/operaciones/services/convenioFalso.ts` (puro, con pruebas):
  - `conveniosDelCliente`: misma relación que el formulario (maestros, detalles y líneas de tarifario).
  - `sentidoDeOperacion`, `convenioFalsoPara`, y `ajusteConvenioPorStatus`, que entra o sale de Falso usando el respaldo `convenioAntesFalso`. El Por Cobrar se calcula con `conversionOperacion`.
- `convenioFalsoDatos.ts`: solo si entra o sale de Falso, relee la operación y los convenios (`fresco`). Si algo falla, avisa y no detiene el cambio de estatus.
- Se usa en los mismos 9 lugares que `ajusteSueldoPorStatus`. En Regresar estatus va dentro de su transacción.
- Empresas:
  - `CLAVE_CONTEO_OPS` se borra al Actualizar, junto con la consulta `usos`.
  - `recuentoOps` / `recuentoUsos` vuelven a correr el conteo.
  - `reintentarCatalogo` es nuevo en `shared/data/catalogos.ts`.
- Simulador:
  - Una completada se regresó a "7. Falso": el convenio pasó de 120 USD al "Cruce de Importacion - Falso" de 60 USD. El Por Cobrar quedó en 60 / 1,080 y el sueldo bajó de 400 a 200, con su aviso. Al regresarla a Completado volvió todo como estaba.
  - Empresas: con 3 operaciones nuevas la columna seguía en 54; con Actualizar pasó a 57.
- No probado contra datos reales: que cada cliente tenga sus convenios "... - Falso" con "Importacion" o "Exportacion" en el nombre.
