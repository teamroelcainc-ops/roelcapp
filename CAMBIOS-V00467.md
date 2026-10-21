# V00467 — Estadísticas por Aduana y reportes de Puente 3 y Puente Colombia

**Solo web.** Va encima de la V00466. Sin funciones, reglas, índices ni banderas.

## 1. Estadísticas: desglose por Aduana
En **Estadísticas → Operaciones (o Facturación) → Desglose** hay un botón nuevo, **Aduana**, que también sale en *Desglosar en*. Cuenta los servicios (o los montos) por la aduana por la que cruzó la unidad: Nuevo Laredo, Colombia… Se combina con los demás; por ejemplo, Aduana → Tipo de operación → Unidad propia.
- La aduana es la que tiene la operación por su convenio (la mantiene el servidor). Si no la trae, se busca la de la tarifa del convenio.
- Fletes y movimientos sin aduana salen como *Sin aduana*.

## 2. Reportes de Puente 3 y Puente Colombia
En **Referencias de Puentes → Operaciones sin asignar**, el botón ahora es **Cargar reporte de puente**. El formato se reconoce solo:

| Reporte | Cómo lo reconoce | TAG de la unidad que usa | Monto |
|---|---|---|---|
| AVI | TRANSACTION DATE · TAG # | TAG AVI | AMOUNT |
| Puente 3 (estado de cuenta de Comercio Mundial, como REPORTE_PUENTE_240) | Fecha · Hora · Folio Tarjeta | TAG Puente 3 | Importe (solo los *Cargo*) |
| Puente Colombia (como REPORTE_PUENTE_800) | Fecha · Tag · #Económico · Importe Total | TAG Puente Colombia | Importe Total (con el descuento) |

- **Todas las hojas.** El de Puente 3 trae los mismos días en dos hojas: se leen las dos y no se repite ningún cobro.
- **Colombia: dos cobros = un cruce.** Cada cruce cobra el puente ($90) y la caseta ($129.60), a veces con horas de diferencia. Se juntan en un solo cruce de $219.60. La ventana muestra las dos horas y los dos montos, y se compara contra la caseta más el puente de la operación.
- **TAG.** Puente 3 compara el *Folio Tarjeta* sin los ceros del final: en la unidad puede ir completo (9D1A330000000000) o corto (9D1A33). En Colombia, si la unidad no tiene su TAG Puente Colombia, se toma por el **# Económico** (1019 = UND.1019) y la fila lo avisa.
- **Primero las de ese puente.** Si la unidad tiene ese día una operación de ese puente (o sin puente) y otra de otro puente, el cruce se queda con la de ese puente. La de otro puente solo se toma si no hay más, y con aviso (*la operación va por Caseta AVI*).
- La ventana, el botón **Coincidencias Puente 3 / Puente Colombia (N)** y el Excel del resultado llevan el nombre del puente.

## Pasos manuales
1. En **Unidades Propias**, captura el **TAG Puente 3** de cada unidad: es el *Folio Tarjeta* del estado de cuenta, por ejemplo 9D1A330000000000. Sin él, los cruces salen como *Tag sin unidad*.
2. **TAG Puente Colombia** (como 02100030457): conviene capturarlo, aunque sin él la unidad se encuentra por el # económico.
3. Los reportes de varios meses traen muchos días: solo se buscan las operaciones que el módulo tiene cargadas (las 2,500 más recientes). Para lo más fino, baja el reporte de pocos días.

## Técnico
- `features/puentes/services/reporteAvi.ts` (+ pruebas):
  - `leerReportePuente(filas)` → `{ grupo, cruces, omitidas }`, con los formatos AVI, PT3 y PTC por encabezado;
  - fechas de México día/mes/año y `horaDeCelda`;
  - `normalizarTag(v, grupo)` y `normalizarEconomico`;
  - `unirCruces(grupo, listas)` quita lo repetido y une los cobros de Colombia (`MINUTOS_COBROS_COLOMBIA` = 300; montos distintos);
  - `coincidirCruces(…, { grupo, otrasDelDia })`: tag por puente, # económico de respaldo y otro puente al final;
  - `OpParaCruce.grupo` reemplaza `esAvi`.
- `ReferenciasPuentesDashboard`:
  - lee todas las hojas;
  - `reporteAvi.grupo`;
  - el tag de la unidad es el de ese puente;
  - el monto de la operación es caseta + piso.
- `PanelReporteAvi`: recibe `grupo` y muestra los cobros (`.pra-cobros`).
- `EstadisticasDashboard` / `DesgloseJerarquico`: la dimensión `aduana`.
- Banco de pruebas, con los dos Excel reales:
  - **Puente 3:** 1,667 cruces del 1 may al 16 oct;
    - las dos de UND.4701 (TAG capturado corto *B260E0*) coinciden con su Verde: 10:01 ↔ 09:55 y 17:04 ↔ 17:00;
    - la de UND.4702, que es de AVI, coincide con aviso;
  - **Colombia:** 189 cruces (de 380 cobros);
    - UND.1009, sin TAG, por el # económico: *09:49 + 10:09 · $219.60 ($90.00 + $129.60)*;
    - UND.1019, por su tag: avisa que la operación solo tiene $129.60;
  - **Excel:** *Cruces_Puente_Colombia_…* con la columna Cobros;
  - **Estadísticas:** el botón Aduana aparece entre Exp/Imp/Mov y Cliente, y en *Desglosar en*;
  - sin errores de consola.
