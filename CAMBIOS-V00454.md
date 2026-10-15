# V00454 — Referencias de Puentes: cambiar el puente sin avisos y la operación va a ese puente

**Solo web** (deploy de hosting de siempre). Sin reglas, índices, banderas ni Cloud Functions.

## Qué pasaba
En **Operaciones sin asignar**, al cambiar el puente de una operación de convenio Colombia (p. ej. TR-141026-014 a Caseta AVI):
1. Se pedía confirmación.
2. Aparecía **"Debe ser Colombia"** en la fila.
3. Al enviarla al Historial se iba a la referencia de **Puente Colombia (PTC)**, aunque el puente fuera Caseta AVI.
4. **Asignar monto del puente** la contaba como "de Colombia por corregir" y la regresaba a Colombia (o le agregaba el Puente Mx Colombia).

Todo venía de la regla de la V00416: "aduana Colombia = siempre Puente Colombia", que pasaba por encima del puente elegido.

## Qué cambia
- Al elegir otro puente en la lista, **se cambia de inmediato, sin preguntar**, con el monto y la moneda de ese puente del catálogo (Tipos de Gastos). Si es de Colombia se agrega el Puente Mx Colombia; si no, se quita.
- **Sin el aviso "Debe ser Colombia"** y sin "de Colombia por corregir" en el botón.
- Al **Enviar al Historial**, y en **+ Agregar operaciones** del detalle de una referencia, la operación va a la referencia del **puente que tiene**: AVI, Puente III o Colombia, aunque su convenio sea de Colombia.
- **Asignar monto del puente** ya no cambia el puente que una operación ya tiene. Solo pone el puente a las que no tienen y agrega el Puente Mx Colombia a las de caseta de Colombia que no lo tienen. Nunca toca las que se cambiaron a mano.
- En el detalle de una referencia, **"Otro puente"** se marca solo por el puente de la fila, ya no por el convenio.
- Sin cambios: las operaciones que todavía **no tienen puente** se calculan igual que antes (aduana Colombia → caseta + puente de Colombia).

## Técnico
- `src/utils/historialCalculadoPuentes.ts`: nueva `grupoDeNombresPuente` (regla única del grupo por nombre del puente). `montosPuente` ya no recalcula a Colombia una operación con puente (solo calcula si no tiene) y solo carga los catálogos en ese caso. `grupoDeFila` sin el convenio.
- `ReferenciasPuentesDashboard.tsx`: `cambiarPuenteOp` sin `confirm` y con `saldoPuenteManual: true`; `grupoPuenteOp` con `grupoDeNombresPuente`; sin `colombiaMalCobrada` (aviso, botón y recálculo); `asignarMontosPuente` con la regla nueva.
- Campo nuevo en `operaciones`: `saldoPuenteManual` (true = el puente lo eligió el usuario en Referencias de Puentes).
- Prueba nueva: `src/utils/historialCalculadoPuentes.test.ts` (grupo por puente elegido, sin recalcular a Colombia, cálculo de siempre sin puente, filas guardadas).
- Banco de pruebas (la app con Firebase simulado), V00453 contra V00454:

| Paso | V00453 | V00454 |
|---|---|---|
| Cambiar una operación de convenio Colombia a Caseta AVI | Pide confirmación + "Debe ser Colombia" | Directo, sin avisos ($23.75 Dólares) |
| Cambiar una de Nuevo Laredo a Caseta Mx Colombia | Pide confirmación | Directo: caseta + Puente Mx Colombia ($390) |
| Asignar monto del puente | Recalcula 2 operaciones | "Ya tienen su monto": no toca nada |
| Enviar al Historial (3 operaciones) | Las 3 a PTC-151026-001 | 2 a AVI-151026-001 (Caseta AVI) y 1 a PTC-151026-001 |

## Qué revisar con datos reales
1. Referencias de Puentes → Operaciones sin asignar → cambia el puente de una operación de convenio Colombia a Caseta AVI: sin mensaje, monto $23.75 Dólares, sin "Debe ser Colombia".
2. Selecciónala y **Enviar al Historial**: debe salir en el grupo **Puente AVI**.
3. Las operaciones que ya estaban en una referencia no cambian (las referencias guardan su copia).
