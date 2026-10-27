# V00503 — Excel de operaciones: Validación (ok / error), Moneda Empresa y colores de moneda

**Solo web.** Va encima de la V00502. Sin funciones, reglas, índices ni banderas.

## Qué pidió Roelca
- Agregar al Excel la moneda que tiene la empresa en Empresas. Decisión: **siempre al lado de "Moneda Cobro"** (la del cliente que paga).
- Monedas resaltadas: **Dólares en azul, Pesos en verde**.
- Primera columna: **"error"** si el registro tiene algún error y **"ok"** si no, para poder filtrar el Excel.
- Errores que cuentan (decisión de Roelca): moneda distinta a la empresa, montos que no cuadran y datos que faltan.

## Qué cambia
Aplica a los dos Excel que comparten columnas: **Operaciones → Excel** y **Servicios Completados → Exportar**. El de Servicios Cancelados no cambia.

- **Columna 1, "Validación"**: `ok` o `error`. El encabezado trae los filtros de Excel puestos y queda fijo al bajar.
- **Columna 2, "Motivo"**: por qué es error. Si hay varios motivos, van separados con `|`. Ejemplos:
  - `Faltan datos: convenio, tipo de cambio`
  - `Moneda distinta a la empresa: cobro en Dólares, la empresa factura en Pesos`
  - `Montos que no cuadran (convenio en Dólares, cobro en Pesos): Pesos 100.00, debe ser 1,850.00; Conversión 100.00, debe ser 1,850.00`
- **"Moneda Empresa"**: va justo después de "Moneda Cobro". Dice Dólares o Pesos, "Sin moneda" si la empresa no la tiene en Empresas, y "-" si la operación no tiene cliente que paga. Si la configuración no trae "Moneda Cobro", va después de "Motivo".
- **Colores**:
  - Dólares (o USD): fondo azul claro y letra azul.
  - Pesos (o MXN): fondo verde claro y letra verde.
  - Se aplican en Moneda Cobro, Moneda Empresa, Moneda Prov. y Moneda Conv. Prov.
  - En Validación, `error` va en rojo y `ok` en verde.
- Los números siguen siendo números (se pueden sumar y filtrar). Año, Mes, Semana y Día siguen junto a la fecha (V00501).
- La ventana de exportar lo explica en su ayuda.

## Qué revisa (lado del cliente: lo que se cobra)
1. **Faltan datos**:
   - cliente que paga;
   - moneda de esa empresa en Empresas;
   - convenio;
   - monto del convenio (convenio + cargos en 0);
   - moneda del convenio (si no está guardada, se usa la que se deduce de la conversión, como en Facturación);
   - moneda de cobro;
   - tipo de cambio, cuando la regla lo usa (cobro en dólares, o convenio y cobro en monedas distintas).
2. **Moneda distinta a la empresa**: "Moneda Cobro" de la operación no es la moneda de su empresa en Empresas.
3. **Montos que no cuadran**: Dólares, Pesos y Conversión guardados contra la regla única. La regla se aplica con la moneda de la empresa; si la empresa no la tiene, con la de cobro. Se acepta un centavo de diferencia por redondeo.

   | Convenio | Cobro (empresa) | Dólares | Pesos | Conversión |
   |---|---|---|---|---|
   | Dólares | Dólares | monto | 0 | monto × TC |
   | Dólares | Pesos | 0 | monto × TC | lo mismo que Pesos |
   | Pesos | Pesos | 0 | monto | lo mismo que Pesos |
   | Pesos | Dólares | monto ÷ TC | 0 | Dólares × TC |

   - monto = convenio + cargos adicionales.
   - TC = el aprobado o, si no hay, el del día.
   - Es la misma regla del formulario, Facturación y el servidor (`shared/dominio/dinero.ts`).
   - **El Subtotal no se revisa**: hay pantallas que lo guardan sin convertir y Facturación no lo usa.
- **Las canceladas no se revisan** (no se cobran): salen `ok` con el motivo "Cancelada: no se revisa".

## Lecturas
- Empresas y el catálogo de monedas: los catálogos que la app ya tiene abiertos. No hay lecturas nuevas.
- Si Empresas no se puede leer, el Excel no sale y lo avisa. Sin Empresas, la validación diría "sin moneda" en todas las filas.

## Pasos manuales
1. Aplicar el zip (no hay archivos borrados).
2. No hay que desplegar funciones.

## Técnico
- `operaciones/services/validacionExcel.ts` (puro, con pruebas):
  - `validarOperacionExcel(op, monedaEmpresa)` devuelve `{ estado: 'ok' | 'error', motivos }`.
  - `empresaClienteDe` y `textoMonedaEmpresa`.
  - Cliente y convenio con los mismos campos que lee el servidor (`FUENTES_CANONICAS`: clientePaga/clienteId/clientePagaId; convenio/convenioId/…).
  - La moneda de cobro sale de `monedaFacturaOperacion` y la del convenio de `monedaConvenioDe`.
  - Lo que debe ser sale de `conversionOperacion`, calculado con la moneda de la empresa.
- `operaciones/services/monedasEmpresas.ts`:
  - `indexarMonedasEmpresas` y `nombreDeMonedaId` salieron de `corregirMonedaConvenioDatos.ts` (antes eran privados; Corregir monedas los usa igual).
  - `leerMonedasEmpresas('cliente')` usa `obtenerCatalogo` sin `fresco`, porque solo muestra y revisa.
- `operaciones/services/excelOperaciones.ts`:
  - `filasExcel(ops, columnas, monedaEmpresa)`.
  - `tablaExcel` devuelve las filas y los encabezados de moneda.
  - `armarLibroExcel` y `descargarExcel` ahora usan **ExcelJS** (ya era dependencia; se carga al exportar, en su propio chunk). SheetJS no pinta colores.
  - Encabezado fijo (`ySplit: 1`), `autoFilter` sobre todas las columnas, ancho por contenido (muestra de 300 filas, de 8 a 60).
  - Solo se pintan las celdas de moneda y de Validación.
- Llamadas: `exportar/ExcelOperaciones.tsx` y `ServiciosCompletados.tsx` (`exportarExcel`).
- Tamaño: el arranque no cambia (240.8 KB comprimido). ExcelJS son 270 KB comprimidos, solo al exportar.
- Velocidad: 16,000 operaciones × 62 columnas tardan 6.3 s en Node con ExcelJS (SheetJS: 8.4 s, archivo sin comprimir de 42 MB contra 2.9 MB).
- Simulador:
  - 4 casos preparados (ok, montos sin TC, moneda distinta, sin convenio ni TC) en el Excel de Operaciones y en el de Completados.
  - Una configuración con Moneda Cobro, montos y monedas del proveedor.
  - Todo el rango: 16,000 filas en 6.8 s, con 321 MB de memoria en la página.
  - Se revisaron con openpyxl: orden de columnas, colores, filtros, encabezado fijo y motivos.
- No probado contra datos reales:
  - Cuántas operaciones de AppSheet salen con "error" por montos. Si su Conversión se calculó con otro tipo de cambio que el guardado, salen como error, y es cierto: no cuadra con su TC.
  - Las operaciones activas que todavía no tienen convenio o monto salen como error por "Faltan datos".
