# V00485 — Facturación de Clientes: el filtro de moneda del Historial ya cuenta y filtra

**Solo web.** Va encima de la V00484. Sin funciones nuevas, reglas, índices ni banderas.

## Qué cambia en pantalla
- Facturación de Clientes → Historial de Facturas → Filtros → **Moneda de facturación**: antes decía *$ Dólares (0)* y *$ Pesos (0)*, y al elegir una moneda la lista quedaba vacía. Ahora cada botón dice cuántas facturas hay en esa moneda y al elegirlo se ven solo esas.

## Pasos manuales
Ninguno.

## Técnico
- `FacturacionClientesDashboard.tsx`: `codigoMonedaFactura` (código USD/MXN de la moneda que se muestra) en `coincideMoneda` (lista y conteo de status) y en `conteoMonedaHist`. Antes se comparaba el nombre ("Dólares"/"Pesos") con el código.
