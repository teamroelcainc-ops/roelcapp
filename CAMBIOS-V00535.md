# V00535 — Paso 2 del refactor: los 5 errores reales de la auditoría

**Solo web.** Va encima de la V00534. Sin reglas, índices, banderas ni dependencias.
**Tipo:** fix (cambia lo que se ve).
**No hay que desplegar funciones.** `functions/src/dominio/` cambia porque es la copia generada de `src/shared/dominio/`, pero el servidor no cambia: ya calculaba "hoy" con la hora de México (`hoyOperacion` en `puentesYDiesel.ts`), y la función que se corrigió (`cobroPuenteDeOperacion`) solo la usa la web. Ahora la web da el mismo día que el servidor.

## 1. Estado mutado (configurador de columnas)
- **Problema:** en 21 lugares, mostrar u ocultar una columna hacía `nuevas[index].visible = !nuevas[index].visible`. Eso cambia el objeto que React ya tiene.
- **Arreglo:** ahora se crea uno nuevo: `nuevas[index] = { ...nuevas[index], visible: !nuevas[index].visible }`.
- **Dónde:** Facturación Clientes y Proveedores (dos configuradores cada uno), Combustible, Empresas, Deducciones, Empleados, Unidades proveedor, Remolques, Direcciones, Operaciones, Completados, Mantenimiento, Referencias de Puentes, Proveedores unidad, Referencias de Diésel, Unidades, Nómina, Contactos y Tipo de cambio.
- Reportes ya copiaba cada columna antes de cambiarla: no tenía el error.

## 2. "Hoy" en UTC donde se guardan o filtran datos
Con `new Date().toISOString().slice(0, 10)`, después de las 6 p. m. en México ya es el día de mañana.

| Dónde | Qué guarda o filtra | Ahora |
| --- | --- | --- |
| `shared/dominio/cobroPuente.ts` | Fecha del cobro de caseta que arma la web (Referencias de Puentes) cuando la operación no trae fecha de servicio | `hoyEnZona(ZONA_HORARIA_DOMINIO)` (`America/Matamoros`, con `Intl`): el mismo día que ya daba el servidor |
| `conveniosCompartido/integridadConvenios.ts` (2) | `fechaConvenio` y `fecha` del tarifario creado desde un convenio | `hoyLocalISO()` |
| `gastos/components/services/mttoService.ts` | Fecha y consecutivo de un gasto de mantenimiento sin fecha | `hoyLocalISO()` |
| `EstadisticasDashboard.tsx` | Filtro "hasta" por omisión | `hoyLocalISO` |
| `DetallesConvenioDashboard.tsx` | Si un convenio ya venció | `hoyLocalISO()` |
| `SaldosPuentesDashboard.tsx` | Fecha de la recarga y el filtro del día | `hoyLocalISO()` |
| `HistorialCambiosDashboard.tsx` | Fecha de un cambio capturado a mano | `hoyLocalISO()` |
| `DataImportView.tsx` | Fechas importadas desde Excel/CSV | `AAAA-MM-DD` tal cual; otro formato, su día local |

**Se dejaron:**
- Los que solo arman el **nombre de un archivo** (`Operaciones_Activas_2026-10-31.xlsx` y similares, en 17 pantallas).
- Los que **convierten una fecha ya guardada** (Timestamp o Date) a su día: no son "hoy". Mover su zona cambiaría el día de registros viejos; la lista está en `code-notes.md` (V00535) para decidir aparte.

## 3. Montos con comas
- **Problema:** `formatoMoneda` usaba `parseFloat`, que lee `"1,234.50"` como 1 (y `"$1,234.50"` como nada).
- **Arreglo:** ahora usa `aNumero`, en las 13 copias: Facturación Clientes y Proveedores, Deducciones (2), Cancelados, Operaciones, Completados, Mantenimiento, Mantenimiento agrupados, Puentes, Diésel, Nómina, Costos adicionales y la Relación de compras de `pdfGenerator`.

## 4. HTML sin escapar del todo
Seis copias no escapaban las comillas. Ahora usan `escaparHTML` (`shared/utils/html.ts`):
- `PagosDashboard.tsx` (PDF de pagos);
- `EstadisticasDashboard.tsx` (3 PDF);
- `ReferenciasNominaDashboard.tsx` (recibo de nómina);
- `generarTarifarioPDF.ts`.

## 5. Fecha mal mostrada
- **Problema:** en el resumen del formulario de operación, "Servicio" (y "Cita" en Fletes) usaba `new Date('AAAA-MM-DD')`, que la lee en UTC y en México mostraba el día anterior.
- **Arreglo:** usa la nueva `fechaCortaEs()` de `shared/dominio/fechas.ts`.
- **Probado** en el simulador con zona `America/Matamoros`: `2026-10-11` → "11 oct 2026".

## Archivos (45)
- 37 de `src` (incluye la prueba nueva `shared/dominio/fechasHoy.test.ts`).
- `functions/src/dominio/cobroPuente.ts` y `fechas.ts` (copia generada).
- `scripts/lint-baseline.json`, `code-notes.md`, `refactor-progress.md`, `public/version.json` y `CAMBIOS-V00535.md`.

## Pasos manuales
1. Aplica el zip encima de la V00534 (no hay archivos borrados):
   `git add src functions/src/dominio public/version.json scripts/lint-baseline.json CAMBIOS-V00535.md code-notes.md refactor-progress.md`
   El conteo debe dar **45**.
2. Publica la web. Las funciones no se despliegan por esta versión (las de la V00496 siguen pendientes).

## Qué revisar en el navegador
1. **Columnas:** en Operaciones (y en cualquier tabla con ⚙ Columnas), oculta y muestra una columna. Cambia al momento y se queda así al cambiar de pestaña.
2. **Fecha del formulario:** abre ✎ de una operación. En el resumen de dinero, "Servicio" muestra la misma fecha que el campo Fecha de servicio.
3. **Montos con comas:** en una tabla con montos, una operación o gasto con un monto guardado como texto con comas se ve completo (antes $1.00).
4. **Hoy por la tarde:** después de las 6 p. m.:
   - un gasto de Mantenimiento sin fecha toma el día de hoy en su consecutivo;
   - una recarga en Saldos de Puentes queda con la fecha de hoy;
   - el filtro "hasta" de Estadísticas trae hoy.
5. **PDF:** un recibo de Nómina o el PDF de Pagos con una descripción que lleve comillas se genera completo.

## Lo que no pude probar en el navegador real
tsc, ESLint, Vitest (847 pruebas, entre ellas las nuevas de `hoyEnZona` y `fechaCortaEs`), el build de funciones y sus 85 pruebas pasan. En el simulador probé la fecha del formulario con zona de México. **No probé:** cada tabla con columnas, la hora de la tarde real (las pruebas fijan la hora), ni los PDF con comillas.
