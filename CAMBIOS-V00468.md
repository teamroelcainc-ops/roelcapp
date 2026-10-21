# V00468 — Estadísticas por Aduana: solo cruces de importación y exportación

**Solo web.** Va encima de la V00467. Sin funciones, reglas, índices ni banderas.

## Qué cambia
- En **Estadísticas → Desglose → Aduana** solo se cuentan los **cruces de importación y exportación** de **Transfer y Logística**. Ya no entran los movimientos, los fletes ni lo *Sin clasificar*. Arriba de la tabla lo dice en amarillo.
- Importación o exportación es lo mismo que muestra el desglose *Exportación / Importación / Movimiento* de esa pantalla, incluida la clasificación manual de "Sin clasificar".
- Si la Aduana se usa como sub-nivel de otro desglose (por ejemplo Tipo de operación → Aduana), no se quita nada de los totales: lo que no es cruce sale como **No cruza**.

## Pasos manuales
Ninguno.

## Técnico
- `DesgloseJerarquico`: prop `soloPara` (filtro y nota cuando esa dimensión es la raíz), clase `.dj-nota--limite`.
- `EstadisticasDashboard`:
  - `esCruceOp` y `SOLO_CRUCES_ADUANA`;
  - `norm`, `textoDeOp` y `movimientoDeOp` pasan a nivel de módulo;
  - se quitaron dos `eslint-disable exhaustive-deps` que ya no hacían falta.
- Banco de pruebas, con 5 operaciones del 1 oct:
  - **cuentan:** Transfer importación (Nuevo Laredo), Transfer exportación (Colombia) y Logística importación;
  - **no cuentan:** el Transfer de movimiento y el flete de exportación;
  - **raíz Aduana:** *240 Nuevo Laredo 2 · Colombia 1*, con la nota;
  - **Tipo de operación → Transfer → Aduana:** *240 Nuevo Laredo 1 · Colombia 1 · No cruza 1*;
  - sin errores de consola.
