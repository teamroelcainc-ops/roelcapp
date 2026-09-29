# V00392 — Control de puentes en las tarjetas · Referencias de Puentes renovado

## 1. Tarjetas de puente (Operaciones Activas)
Por cuenta (los cruces cuentan desde la PRIMERA recarga del puente, igual que el saldo):
- Cifra grande: SALDO RESTANTE = agregado − consumido (rojo si está sobregirado).
- Agregado: suma de recargas.  Cruces: número de operaciones que cruzaron (clic = detalle con fecha).
- Consumido: suma del peaje de esos cruces (cuadra con el número de cruces).
- Puente Colombia: dos columnas, Caseta y Puente, cada una con agregado, cruces, consumido y restante.

## 2. Referencias de Puentes → Asignar Operaciones
- Solo Transfer y Logística con proveedor Roelca (sin pruebas ni canceladas); se leen las 2,500 más
  recientes por fecha de servicio (antes 500 sin orden).
- Casilla para seleccionar TODAS (como Diesel y Nómina) además de la de cada fila.
- Filtros: Fecha (inicio/fin), Puente (del catálogo, o "Sin monto de puente") y Unidad.
- Columnas: Ref. Operación, Fecha del Servicio, Unidad, Convenio, Puente, Monto
  (Tráfico, Operador y Cliente quedan como columnas opcionales en Configurar Columnas).
- Colombia: Puente y Monto muestran caseta y puente en dos líneas.
- Resumen de la selección con el total por moneda (no mezcla dólares y pesos).
- La referencia guarda el monto REAL de cada operación, su puente, unidad y convenio.
- Botón "Asignar monto del puente (N sin monto)": calcula y guarda el cobro de las operaciones del
  filtro que no lo tienen — caseta de los Gastos Incluidos de la tarifa; si no hay, por tráfico
  (Importación = Caseta AVI, Exportación = Caseta Puente III); Colombia = caseta (Caseta Mx Colombia /
  Trompo Colombia) + Puente Mx Colombia. Confirma antes y avisa las que no se pudieron determinar.

## Archivos
src/utils/puenteColombia.ts (cargarCtxCobroPuente, cobroPuenteDeOperacion)
src/features/puentes/components/ReferenciasPuentesDashboard.tsx + .css
src/features/operaciones/components/TarjetaCasetas.tsx, src/App.css
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint igual que antes (Referencias 51, TarjetaCasetas 0); build OK.
