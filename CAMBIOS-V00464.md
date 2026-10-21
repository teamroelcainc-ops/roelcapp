# V00464 — Referencias de Puentes: cargar el reporte del AVI y encontrar las operaciones de cada cruce

**Solo web.** Va encima de la V00463. Sin funciones, reglas, índices ni banderas. No escribe nada nuevo en la base: solo selecciona operaciones.

## Cómo se usa
1. Referencias de Puentes → **Operaciones sin asignar** → **Cargar reporte AVI**.
2. Elige el Excel que descargas del portal del AVI (un día o varios), tal cual: *POSTING DATE · TRANSACTION DATE · TAG # · LOCATION · DESCRIPTION · AMOUNT*.
3. La tabla de abajo pasa sola a las fechas del reporte. Arriba sale el panel **Reporte AVI** con cada cruce:

   | Cruce | Tag # | Unidad | Lugar | Monto | Operación | Resultado |
   |---|---|---|---|---|---|---|

   Los resultados posibles:
   - **Coincide**: la operación está completada, sin asignar y lista para el Acumulado.
   - **Ya está en el Acumulado**.
   - **Aún no está completada**.
   - **No es importación ni exportación**.
   - **Sin operación ese día**.
   - **Tag sin unidad**: ninguna unidad tiene ese TAG AVI.

   Avisos que pueden salir debajo de un cruce:
   - *la operación no tiene monto de puente*;
   - *la operación tiene $X y el AVI cobró $Y*;
   - *la operación va por otro puente*;
   - *el tag está en varias unidades*;
   - *la unidad tiene N operaciones y M cruces ese día*.
4. **Seleccionar las N que coinciden** las marca en la tabla. Luego **Enviar al Acumulado**, como siempre.
5. **Exportar resultado** baja el cruce por cruce a Excel. **Quitar reporte** lo cierra.

## Reglas
- **Tag:** el TAG # del reporte se compara con el **TAG AVI** de Unidades Propias. Solo cuentan los dígitos: 00202745 = 202745.
- **Fecha:** la *TRANSACTION DATE* es la fecha y hora del cruce. El portal es de EE. UU., así que se lee mes/día/año: 10/01/2026 es el 1 de octubre.
- **Qué operaciones se buscan:** las de esa unidad con esa **fecha de servicio** que sean Transfer o Logística con proveedor Roelca. No se toman las pruebas ni las canceladas.
- **Varias en el mismo día:** si una unidad cruzó varias veces, cada cruce va con la operación cuyo **Verde** (la "Hora (Verde)" de la tabla) quedó más cerca de la hora del cruce. Sin hora de Verde, se van por orden de referencia. Cada operación se usa una sola vez.
- **Lugar:** el LOCATION (Bridge 2, 3 o 4) solo se muestra; todos los renglones son cobros del tag AVI.
- **Operaciones que se revisan:** las que el módulo ya tiene cargadas (las 2,500 más recientes). Si el reporte es de días anteriores, el panel lo avisa.

## Pasos manuales
Revisa que las unidades tengan su **TAG AVI** en Unidades Propias. Un tag que falte sale como *Tag sin unidad*.

## Técnico
- `features/puentes/services/reporteAvi.ts` (+ pruebas):
  - `leerReporteAvi` busca el encabezado en las primeras 30 filas e ignora los renglones sin tag o sin fecha, como el de totales;
  - `fechaHoraReporte` lee texto mes/día/año (con o sin AM/PM), AAAA-MM-DD o la serie de Excel; `montoReporte` y `normalizarTag`;
  - `coincidirCruces` empareja por unidad + fecha y de forma voraz por la diferencia de minutos contra las horas de Verde; `resumenCruces` arma los conteos.
- `components/PanelReporteAvi.tsx/.css` (prefijo `pra-`).
- `ReferenciasPuentesDashboard.tsx`:
  - botón *Cargar reporte AVI* con un `<input type="file">` propio (el archivo solo se lee, no se sube a Storage);
  - al cargar, pone las fechas del reporte y quita los filtros de puente y unidad;
  - el cruce se calcula con las operaciones que el módulo ya escucha y con `horasVerde`.
- Banco de pruebas (reporte del 14 oct con 6 cruces y 3 unidades con TAG AVI):
  - **Coincide:** la operación del Verde de las 12:30 queda con el cruce de las 12:45 y la de las 21:50 con el de las 22:12;
  - **Sin operación:** el tercer cruce de la misma unidad, porque tiene 2 operaciones;
  - **Aún no está completada:** una operación en proceso; **Tag sin unidad:** el tag 00169377 ($3.30);
  - **Aviso:** "sin monto de puente" en la operación que no lo tiene;
  - **Seleccionar:** marca 3, el botón dice *Enviar al Acumulado (3)* y el Excel del resultado sale con las columnas nuevas;
  - un archivo que no es el reporte da un aviso claro; sin errores de consola.
