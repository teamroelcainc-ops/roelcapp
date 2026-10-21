# V00466 — Reporte AVI: busca solo en Operaciones sin asignar y abre una ventana con las que coinciden

**Solo web.** Va encima de la V00465. Sin funciones, reglas, índices ni banderas.

## Qué cambia
1. **Solo Operaciones sin asignar.** Al cargar el reporte del AVI, cada cruce se busca solo entre las operaciones de **Operaciones sin asignar**: Transfer o Logística con Roelca, completadas, de importación o exportación, que aún no están en el Acumulado. Las que ya están en el Acumulado y las que no se han completado ya no se toman.
2. **Ventana con las que coinciden.** Al cargar el reporte se abre una ventana con:
   - una fila por operación que coincide, con su check (todas marcadas), la unidad y su tag, la fecha y hora del cruce, la hora del Verde, lo que cobró el AVI y lo que hay que **revisar**:
     - la operación no tiene monto de puente;
     - su monto es distinto del que cobró el AVI;
     - va por otro puente;
     - **la unidad también tiene ese día otra operación en el Acumulado** (para no pagar dos veces el mismo cruce);
   - abajo, plegados, los cruces que no coinciden con el motivo:
     - *Sin operación por asignar*;
     - *Tag sin unidad*;
     - y, si la unidad tiene otra operación ese día, cuál y en qué está (en el Acumulado, aún sin completar);
   - **Enviar al Acumulado (N)**: abre la ventana de siempre con las marcadas;
   - **Solo marcar en la tabla**: las deja seleccionadas en la tabla de abajo;
   - **Exportar resultado** y **Quitar reporte**.

   Con ✕ o Esc se cierra y el reporte sigue cargado: el botón verde **Coincidencias AVI (N)**, junto a *Cargar reporte AVI*, la vuelve a abrir.
3. **Sin Lugar.** Ya no se muestra el lugar (Bridge 3, Bridge 4…): todo el reporte es del AVI. Tampoco sale en el Excel del resultado.

## Pasos manuales
Ninguno.

## Técnico
- `features/puentes/services/reporteAvi.ts` (+ pruebas):
  - sin `lugar`;
  - `OpParaCruce` sin `estado`; `EstadoCruce` = `coincide | sinOperacion | tagSinUnidad`;
  - `coincidirCruces(cruces, unidades, ops, otrasDelDia)`: `otrasDelDia` es un mapa de `claveUnidadDia` → descripciones, y se avisa en cada cruce de esa unidad y día.
- `ReferenciasPuentesDashboard`:
  - las candidatas usan la regla de *Operaciones sin asignar*, sin los filtros de puente y unidad;
  - las demás operaciones de esas unidades y días van a `otrasDelDiaAvi`;
  - `horasVerdePendientes` muestra la espera;
  - `reporteAviAbierto` y el botón *Coincidencias AVI (N)*.
- `PanelReporteAvi.tsx/.css`: ahora es una ventana (prefijo `pra-`) que guarda las desmarcadas. El archivo no cambia de nombre.
- Banco de pruebas (reporte del 14 oct, 6 cruces):
  - **coinciden:** 3 operaciones; la de UND.1019 avisa *sin monto* y *también tiene TR-141026-005 (en el Acumulado)*, y esa no se toma;
  - **no coinciden:** 13:17 de UND.1021 (*también tiene TR-141026-004, aún sin completar*), 19:01 de UND.1020 (*2 por asignar y 3 cruces*) y el tag sin unidad;
  - **enviar:** desmarcar una deja *Enviar al Acumulado (2)* y abre la ventana de siempre con *Puente AVI · 14 oct 2026 $47.50*; la tabla queda con 2 seleccionadas;
  - **marcar:** *Solo marcar* deja 3;
  - **Excel:** sin la columna Lugar; Esc cierra, *Quitar reporte* quita el botón;
  - sin errores de consola.
