# V00526 — Facturación de Clientes: Reporte por facturar

**Solo web.** Va encima de la V00525 (Actualizar guarda lo que cobra cada operación). Sin funciones, reglas, índices, banderas ni dependencias nuevas (ExcelJS ya estaba).

> El código llegó en `correcciones_roelca.zip` como "V00525", hecho encima de la V00524. Se integró encima de nuestra V00525 y se mejoró (abajo, "Mejoras al integrar").

## Qué hace
Facturación de Clientes → Asignar Operaciones → **Reporte por facturar**. Descarga un Excel para imprimir con lo pendiente por facturar.
- **Por omisión, todo lo pendiente.** Si pones Filtros (fechas, cliente, tipo, búsqueda), sale solo eso y el encabezado del Excel dice qué se filtró. Las que están en Revisión no salen.
- **Una fila por referencia**, agrupado por cliente: Cliente, Ref. Roelca, Ref. Cliente, Fecha, Caja, Servicio, **Datos para la Factura**, Moneda, importe y **# Factura**.
  - **Datos para la Factura:** la leyenda que se copia al SIT o a QuickBooks. Lleva referencia, fecha, caja, Ref Cliente, **el ejecutivo que pidió el servicio** (de Obs. Ejecutivo, en mayúsculas y sin el correo) y, si se convirtió, el TC.
  - **Importe:** ya convertido a la moneda del cliente. El IVA lo pone el SIT.
  - **# Factura:** vacía, para anotar el folio al facturar.
- Al final de cada cliente, su **total**; al final del reporte, el **total general en dólares y en pesos**.
- Impresión: hoja horizontal, ajustada al ancho, encabezados repetidos en cada página y pie con fecha y número de página.

También:
- **Datos para el SIT** ahora se llama **Datos para la Factura** (sirve igual para QuickBooks).
- **Subir XML** ahora se llama **Subir PDF y XML**.
- La leyenda (también en la ventana Datos para la Factura) agrega el **nombre del ejecutivo**. Si Obs. Ejecutivo trae una nota en lugar de un nombre, no se incluye.

## Mejoras al integrar
- Los avisos ("no hay pendientes", "no se pudo generar") usan los avisos de la app (`avisar`) en lugar de `alert`.
- El encabezado del reporte dice también el **tipo** y la **búsqueda** filtrados (antes solo fechas y cliente).
- La descarga usa la misma función de los demás Excel (`descargarBuffer`), en lugar de una copia.
- El nombre del ejecutivo es más estricto. Antes, una nota corta como "URGENTE 2 CAJAS" salía como nombre. Ahora solo se toma si tiene hasta 4 palabras y solo letras.
- Se quitó de la prueba la línea que escribía un archivo de depuración.

## Archivos (12)
- `src/features/facturacion/services/reportePorFacturar.ts` (nuevo) y `reportePorFacturar.test.ts` (nuevo)
- `src/features/facturacion/services/datosParaSit.ts` y `datosParaSit.test.ts`
- `src/features/facturacion/components/DatosSitModal.tsx`
- `src/features/facturacion/components/FacturacionClientesDashboard.tsx` y `.css`
- `src/config/version.ts`, `public/version.json`, `src/config/historialCambios.ts`, `code-notes.md`, `CAMBIOS-V00526.md`

## Pasos manuales
1. Aplica el zip encima de la V00525 (no hay archivos borrados) y haz el commit: el conteo debe dar **12**.
2. No hay que desplegar funciones. Publica la web como siempre (`npm run build` y `npx wrangler deploy`).
3. Prueba: Asignar Operaciones → Reporte por facturar. Abre el Excel e imprímelo a PDF para revisar el formato.
