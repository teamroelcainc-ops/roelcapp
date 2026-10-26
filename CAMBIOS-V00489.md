# V00489 — Dinero: "Facturado en" de una sola fuente (no más × TC dos veces)

**Web y funciones.** Va encima de la V00488. Sin reglas, índices ni banderas. Hay que desplegar las funciones.

## Qué pasaba
La D-6166 (Javier Adrián Sánchez Martínez, en Pesos) daba $810,473.63: FL-110626-002 $9,100 + TR-110626-011 **$801,373.63**, cuando la TR vale $2,650. 801,373.63 = 2,650 × 17.3898 × 17.3898: multiplicada **dos veces** por el tipo de cambio.

"Facturado en" se guarda en dos campos: el ID (lo que escribe el formulario) y una copia del nombre que viene de AppSheet y nadie actualiza. Cuando decían monedas distintas, la regla de cálculo tomaba las dos a la vez: convertía el convenio en dólares a pesos (× TC) y después trataba la factura como en dólares (× TC otra vez). Facturación además mostraba la copia del nombre, así que Por Cobrar podía decir "Pesos" mientras el cálculo usaba Dólares.

## Qué cambia
- La moneda de factura sale de **un solo lugar**: el ID (como el formulario); la copia del nombre solo si el ID no se reconoce. Igual en la web y en el servidor.
- "Facturado En" en Facturación (tabla, ficha, detalle Por Cobrar, Excel, Rate) muestra esa misma moneda.
- **Corregir monedas de convenio** (Operaciones) también revisa las operaciones que ya tienen moneda del convenio pero cuyo "Facturado en" se contradice y cuyos montos guardados no cuadran (salen como "Ya la tenía"), y los recalcula.
- Al corregir la Conversión (o Subtotal, Dólares, Pesos) de una operación en el formulario, el servidor actualiza el renglón de sus facturas (antes solo si cambiaba el convenio, la moneda o el TC).

## Pasos manuales
1. Aplicar el zip (incluye `functions/src`).
2. Desplegar las funciones: `firebase deploy --only functions` (desde la raíz del proyecto; nunca sin `--only`).
3. Operaciones → **Corregir monedas de convenio** → revisar la lista → Corregir.
4. Facturación → Historial de Facturas → **Corregir monedas y montos** → Corregir. La D-6166 debe quedar en $11,750.00 (9,100 + 2,650) si la TR-110626-011 tiene Conversión $2,650.

## Técnico
- `shared/dominio/dinero.ts`: `monedaFacturaOperacion(op, lado)` (+ `monedaDeTexto`); `conversionOperacion` la usa (factUSD y factMXN ya no pueden ser los dos).
- `functions/src/relacional.ts`: `conversionOperacionLegado` con la misma fuente; `CAMPOS_DINERO_CLIENTE`/`PROV` + `conversion*`, `subtotal*`, `pesos*`, `dolares*`.
- `features/facturacion/selectores.ts`: `textoFacturadoEn` (+ pruebas). Los dos tableros lo usan en tabla, ficha, detalle, Excel y Rate; `monedaFacturacionOp` usa `monedaFacturaOperacion`.
- `features/operaciones/services/corregirMonedaConvenio.ts`: `facturaContradice`, fuente `'factura'` (+ pruebas).
- Pruebas: `dinero.test.ts` (D-6166, nunca × TC², paridad que salta los casos de moneda de factura distinta), `functions/test/relacionalDinero.test.ts` (cascada).
