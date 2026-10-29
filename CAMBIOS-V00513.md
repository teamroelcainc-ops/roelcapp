# V00513 — Facturación de Clientes: Subir XML y PDF de facturas fiscales · Datos para el SIT

**Solo web.** Va encima de la V00512. Sin funciones, reglas, índices, banderas ni dependencias nuevas.

> Lo hizo otra sesión, con los números V00511, V00512 y V00513, que chocaban con la V00511 (Falso al 50%) y la V00512 (Revisión de datos) de aquí. Se unió como **una sola versión, V00513**. Solo toca Facturación de Clientes. **No apliques el zip de la otra sesión**: este ya lo trae.

## Pasos manuales
1. Aplica el zip encima de la V00512 (no hay archivos borrados) y haz el commit: el conteo debe dar **22**.
2. No hay que desplegar funciones.
3. Publica como siempre: `npm run build` y `npx wrangler deploy`.

## Probado aquí, dentro de la app (simulador)
- **Datos para el SIT** con LO-211026-008 (US$170) y TR-211026-033 (US$225), TC 18.42, cliente en pesos: $3,131.40 + $4,144.50 = **$7,275.90**, con `TC 18.4200` en la descripción.
- **Subir XML** con dos XML y un PDF:
  - A5745 sale ✅ Cuadra, con 📄 PDF.
  - A5744 sale ⚠️ No cuadra. TR-211026-033 trae −4.50: "El XML usa TC 18.4 y la operación 18.42". También avisa que la suma no da el subtotal.
- **Registrar factura** abre Generar Factura ya llenado: invoice A5745, fecha 22/10/2026, total $7,275.90, y los documentos en orden (A5745.pdf primero, luego A5745.xml). La confirmación es la de siempre y no se probó aquí.

## Datos para el SIT
### Qué hace
Facturación de Clientes → Asignar Operaciones → selecciona las operaciones de un cliente → **Datos para el SIT**. Por cada operación muestra:
- **Servicio:** el convenio, como guía para elegir el producto en el SIT.
- **Descripción** lista para pegar, un dato por renglón:
  ```
  LO-211026-008
  21/10/2026
  CAJA RP116
  REF 568917117      (si tiene Ref Cliente)
  TC 18.4200         (solo si el convenio está en otra moneda que la factura)
  ```
- **Importe ya convertido**, en la moneda del cliente, con 2 decimales.

Con botones **Copiar descripción**, **Copiar importe** y **Copiar todo**, y el **subtotal** de la factura.

Son **subtotales**: el IVA y las retenciones los calcula el SIT.

### Por qué
La persona de facturación calculaba a mano el TC y la conversión en el SIT, y de ahí salían los errores de centavos. Este es el mismo cálculo con que la app factura y con que **Subir XML** revisa el XML: lo que se captura con estos datos cuadra al centavo al subir el XML.

### Técnico
- `services/datosParaSit.ts` (+ pruebas): `conceptoSit`, `datosParaSit`, `textoDescripcion`, `textoImporte`. Importe con `montoOperacion` + `totalNativoDeOperaciones`; suma en centavos.
- `components/DatosSitModal.tsx` (+ `.css`, prefijo `dsm-`, + prueba). Copia con `navigator.clipboard` (aviso si el navegador no deja).
- `FacturacionClientesDashboard.tsx`: botón (deshabilitado sin selección o con varios clientes), `abrirDatosSit` (exige la moneda del cliente en Empresas, como Generar Factura). Caja con `remolqueOpTokens`.
- Verificado: `npm run verificar` y `npm run build`. La ventana se probó aislada en el navegador; dentro del tablero con Firebase no se pudo probar aquí.

## Subir XML de facturas fiscales
### Qué hace
Facturación de Clientes → Asignar Operaciones → **Subir XML**. Arrastra uno o varios XML de facturas del SIT (hasta 60 por carga). Por cada uno la app lee:
- folio (Serie + Folio, p. ej. I8663), fecha, cliente (nombre, RFC o Tax ID), moneda, tipo de cambio, UUID y subtotal;
- **cada concepto con su referencia, caja, Ref Cliente e importe**.

Y lo coteja contra las operaciones por facturar:

| Resultado | Qué significa |
|---|---|
| ✅ Cuadra | Cliente, moneda e importe de cada referencia iguales al centavo. Botón **Registrar factura**. |
| ⚠️ No cuadra | Dice qué referencia, cuánto cobra el XML, cuánto la app y la diferencia; en pesos, si el TC del XML no es el de la operación. |
| ❌ Sin operación | Ninguna referencia del XML está en las operaciones por facturar. |
| 🚫 No se puede registrar | Folio ya registrado, operación ya facturada o en Revisión (Ref Cliente duplicada), cliente sin moneda, comprobante que no es de ingreso, o XML repetido en la misma carga. |
| ✔ Registrada | El folio ya está en la app con esas mismas operaciones. |

**Registrar factura** abre el Generar Factura de siempre, ya llenado: las operaciones seleccionadas, el folio, la fecha del XML y el XML como documento de la factura. Revisas y confirmas. Al cerrar, la ventana de XML sigue con lo que habías cargado y esa factura aparece como Registrada.

### Qué no hace (todavía)
- No guarda el UUID en la factura ni consulta en el SAT si sigue vigente (siguiente paso propuesto).
- No registra varias a la vez: una por una, cada una con su confirmación.
- Busca solo entre las operaciones cargadas en la lista. Si una referencia no aparece, revisa el filtro de fechas o presiona Actualizar.

### Técnico
- `services/leerCfdi.ts` (DOMParser, por nombre local de elemento) + pruebas con XML ficticios con la forma de los del SIT.
- `services/cotejoCfdi.ts`: puro; importe por operación con `montoOperacion` + `totalNativoDeOperaciones` (la regla con que Generar Factura guarda el total), comparado en centavos. Cliente por RFC, o Tax ID / nombre normalizado si el RFC es el genérico de extranjero.
- `components/SubirXmlModal.tsx` + `FilaCfdi.tsx` (+ `.css`, prefijo `sxm-`). Usa `<AdjuntosArchivos tipos="cualquiera">` para elegir los archivos (no hay otro `input type=file`). Lectura del archivo con `Blob.text()` y FileReader de respaldo.
- `FacturacionClientesDashboard.tsx`: botón, estado del modal, cotejo con la lista cargada (`useMemo` sobre operaciones, Empresas y facturas) y `registrarDesdeXml`, que solo llena el formulario de Generar Factura.
- Verificado: `npm run verificar` (tsc, lint, consultas, css, 702 pruebas) y `npm run build`. Probado en navegador solo el modal aislado con los XML reales de muestra (escritorio y celular); el flujo completo dentro del tablero (con Firebase) no se pudo probar aquí.

## PDF y XML juntos
### Qué cambia
- Facturación de Clientes → Asignar Operaciones → **Subir XML** ahora acepta **PDF y XML** (hasta 120 archivos, 60 facturas por carga). Otros tipos se quitan con aviso.
- Cada PDF se junta con su XML:
  1. por el mismo nombre (el SIT los nombra igual: `ROE180119IV4-I8663.pdf` / `.xml`);
  2. si no, porque el nombre del PDF trae el UUID;
  3. si no, porque trae el folio (I8663).
- En cada factura se ve **📄 PDF** o **⚠ Sin PDF**. Los PDF que no tienen su XML se listan aparte.
- **Registrar factura** deja la factura con los dos documentos: **primero el PDF** (el portal de clientes y la app móvil abren el primero) y luego el XML.
- Sin PDF se puede registrar igual; se agrega después desde los documentos de la factura.

### Técnico
- `services/parearPdfXml.ts` + pruebas.
- `SubirXmlModal.tsx`: acepta PDF y XML, lee solo los XML, parea y pasa el PDF a `FilaCfdi` y a `onRegistrar(resultado, xml, pdf)`.
- `FacturacionClientesDashboard.tsx` (`registrarDesdeXml`): `adjuntosFacturar = [PDF, XML]`.
- Verificado: `npm run verificar` y `npm run build`. Probada la ventana aislada en el navegador con los PDF y XML reales de muestra; el registro dentro del tablero (con Firebase) no se pudo probar aquí.
