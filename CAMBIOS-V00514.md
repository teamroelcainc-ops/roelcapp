# V00514 — Facturación de Clientes: el PDF / XML de la factura se revisa al subirlo

**Solo web.** Va encima de la V00513. Sin funciones, reglas, índices ni banderas. **Trae una librería nueva** (`pdfjs-dist`): después de aplicar el zip hay que correr `npm install` una vez.

## Qué hace
Al subir el documento de una factura, la app lo lee y lo compara con la factura. Funciona en dos lugares:
- **Generar Factura** (Asignar Operaciones): contra lo que tiene el formulario, es decir, las operaciones seleccionadas, el número de invoice y el total.
- **Documentos de una factura ya registrada** (la píldora Doc / Sin doc, o la Ficha): contra esa factura.

Lee los **PDF del SIT** (CFDI en pesos o dólares), los **Invoice de Roelca Inc** y el **XML** del CFDI.

Debajo de los archivos aparece **Revisión del documento**. Primero dice qué leyó (número, cliente, subtotal y cuántas referencias). Luego compara:

| Revisa | Aviso si no coincide |
|---|---|
| Número de factura / invoice | "El número no es el mismo: el documento es la factura I8664 y en el formulario dice I8663." |
| Cliente (RFC; extranjeros por Tax ID; Invoice por nombre) | "El cliente no es el mismo: el documento es para … y la factura es de …" |
| Moneda | "La moneda no es la misma: el documento está en USD y la factura en MXN." |
| Operaciones (referencias) | "Esas no son las operaciones que van en esa factura: el documento trae …, que no está en la factura; la factura tiene …, que no está en el documento." |
| Costo de cada operación (al centavo) | "El costo no concuerda: TR-271026-014: el documento cobra 75.00 USD y la factura 70.00 (diferencia +5.00)." En pesos, también avisa si el documento usa otro TC. |
| Subtotal | "Ese subtotal no concuerda con la factura: el documento dice 275.00 USD y la factura 270.00 USD." |

- Si un concepto junta dos referencias (como F1072), compara la suma de esas dos operaciones.
- Compara el **subtotal**: los impuestos los controla el SIT. Si el documento trae IVA, muestra el total con impuestos solo como información.
- **Solo avisa:** no impide guardar.
- Un PDF escaneado (una imagen, sin texto) no se puede revisar, y lo dice.

## Pasos manuales
1. Aplica el zip encima de la V00513 (no hay archivos borrados) y haz el commit: el conteo debe dar **20**. Trae `package.json` y `package-lock.json`: agrégalos al commit.
2. Corre **`npm install`** para bajar `pdfjs-dist` 6.4.299. Sin esto el build falla.
3. No hay que desplegar funciones.
4. Publica como siempre: `npm run build` y `npx wrangler deploy`.

## Probado
- **Pruebas automáticas:** usan el texto real que pdf.js sacó de tus 5 PDF, con los clientes cambiados. Los cinco se leen bien.
- **Simulador, Generar Factura:** se seleccionaron TR-271026-026, TR-271026-010 y TR-271026-014 (esta última con $70 en la app) con el invoice I8663, y se subieron I8663.pdf e I8664.pdf.
  - I8663: el número, el cliente (por Tax ID) y las operaciones coinciden. Avisa la diferencia de +5.00 en TR-271026-014 y en el subtotal.
  - I8664: avisa que el número no es el mismo, que esas no son las operaciones y que el subtotal no coincide.
  - Al cambiar el número del formulario, lo vuelve a comparar al momento.
- **Simulador, Documentos de la factura 39838:** se subió el Invoice_39838.pdf de Roelca Inc y dio ✅ en todo.

## Técnico
- `services/leerFacturaPdf.ts`: puro y probado.
- `services/documentoFactura.ts`: puro y probado. Usa la misma regla de dinero que Generar Factura y que Subir XML (`importeEn`).
- `services/textoPdf.ts`: pdf.js con import dinámico; el worker es un `.mjs` aparte.
- `services/leerDocumentoFactura.ts`: lee cada archivo una sola vez.
- `components/RevisionDocumentosFactura.tsx` y su `.css` (prefijo `rdf-`). Están en Generar Factura y en `DocumentosFacturaModal` (con el prop opcional `esperado`, solo en Clientes).
- `cotejoCfdi.ts` exporta `importeEn`, `mismoNombre`, `soloAlfanumerico` y `RFC_GENERICOS`.
- `leerCfdi.ts` lee también "TC: 18.6670".
- Solo se revisan los archivos nuevos. Los ya guardados no se descargan.
