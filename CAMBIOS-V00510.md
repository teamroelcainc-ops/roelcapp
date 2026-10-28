# V00510 — Revisión de datos: marcar como facturadas las operaciones de F1

**Solo web.** Va encima de la V00509. Sin funciones, reglas, índices ni banderas. Cambia datos **solo** cuando tú lo autorizas desde la ventana.

## Qué es F1
F1 son las operaciones que ya están en la lista de una factura, pero no tienen Invoice ni la marca de facturada. En la revisión del 28-oct fueron **5,675**:
- 5,528 completadas, 145 en Falso y 2 canceladas;
- todas en una sola factura, del 2 de enero al 8 de julio de 2026;
- 113 en facturas "N/A" / No Aplica (Roelca Inc.), que **cuentan como activas**, como confirmaste.

Así como están, se ven como no facturadas: pueden aparecer otra vez para facturarse.

## Cómo se corrige
Operaciones → **Revisión de datos** → **Revisar** → grupo **F1**. Arriba de la lista aparece **Marcar como facturadas**, en tres pasos que no se pueden saltar:
1. **Descargar la prueba (Excel):** una fila por operación con su factura y lo que se le escribiría, y las que no se marcan con el motivo. Revísalo.
2. **Descargar el respaldo:** un archivo con lo que tiene cada operación hoy. Guárdalo; sirve para deshacer.
3. **Escribe APLICAR** y presiona **Marcar N operaciones**. Avisa el avance y al terminar dice cuántas se marcaron y cuáles no.

Después presiona **Revisar de nuevo**: F1 debe quedar solo con las que no se marcaron.

## Qué escribe y qué no
- A cada operación le escribe el Invoice y la marca de facturada de la factura que la lista, **lo mismo que hace Facturación al facturar**. También le pone la fecha y hora de esta corrección, para saber cuáles se marcaron aquí.
- **No cambia** montos, facturas ni pagos.
- **No marca:**
  - las **canceladas** (2 en producción);
  - las que estén en **dos o más facturas** (0 en producción).

  Esas se revisan a mano.
- Al escribir vuelve a leer cada operación y su factura. Si algo cambió desde la revisión, no la toca y dice por qué: ya se marcó, se canceló, la factura se canceló o ya no la lista.
- Si se corta la conexión a la mitad, lo marcado hasta ahí ya quedó. Vuelve a Revisar y aplicar: las ya marcadas no se repiten.
- Queda en la bitácora.

## Pasos manuales
1. Aplicar el zip (no hay archivos borrados).
2. No hay que desplegar funciones.
3. Mientras Cloudflare no pueda descargar el repositorio (la falla del 27-oct), publica después del push con `npm run build` y `npx wrangler deploy`.
4. En la app: Revisión de datos → F1 → prueba → respaldo → APLICAR. Hazlo en un horario con poca captura: son unas 5,700 escrituras, en tandas de 100.

## Técnico
- `revisionDatos.ts`: `marcasF1` lleva cada operación de F1 con su factura (el id real del documento, el folio, el status y cuántas facturas activas la listan). `revisionDatosLectura.ts` agrega `idDoc` a cada factura.
- `marcarFacturadasF1.ts`:
  - `planMarcarF1`, `filasPruebaF1`, `respaldoF1`, `facturaListaOperacion` y `motivoAlMarcar` son puros, con pruebas.
  - `aplicarMarcasF1` escribe con `runTransaction` en tandas de 100, releyendo la operación y la factura.
  - Escribe `facturaClienteId`, `facturaClienteInvoice`, `facturado: true` y `facturadoPorRevision`.
- `MarcarFacturadasF1.tsx` + `.css` (prefijo `mf1-`) dentro de `RevisionDatosModal`.
- Simulador:
  - Revisar dio 7,004 en F1. Se marcaron 6,489, entre ellas una en Falso y una en una factura "N/A" No Aplica. La de una factura de AppSheet quedó ligada con el id real de la factura, no con el id guardado de AppSheet.
  - Las 515 canceladas no se tocaron. Revisar de nuevo: F1 = 515.
  - El botón de marcar no se habilita sin la prueba, el respaldo y APLICAR.
- Para deshacer, si hiciera falta: las operaciones con `facturadoPorRevision` (o las del respaldo) regresan a `facturaClienteId` y `facturaClienteInvoice` vacíos y `facturado: false`.
