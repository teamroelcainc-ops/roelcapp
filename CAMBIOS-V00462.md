# V00462 — Operaciones: al abrir una operación su tipo de cambio pasa solo al de su fecha de servicio

**Solo web.** Va encima de la V00461. Sin funciones, reglas, índices ni banderas.

## Qué pasaba con la V00461 (TR-151026-019)
- Una operación guardada con el T.C. de otro día **conservaba** ese T.C. y solo salía el aviso amarillo. Para los roles con el campo Tipo de Cambio bloqueado no aparecía *Usar el oficial*, así que no había cómo corregirla.
- Al cambiar la fecha y **regresar a la original**, volvía el T.C. que traía (el equivocado).

## Qué cambia
- La regla es una sola: **el T.C. de la operación es el oficial de su fecha de servicio.** Fecha de hoy → el de hoy; fecha de ayer → el de ayer; sábado o domingo sin registro → el del viernes.
- **Al abrir** una operación guardada con otro T.C., pasa solo al oficial de su fecha y lo dice en azul: *TC oficial del 15 oct 2026: $18.4888 · antes tenía $18.4250, se guarda al presionar Guardar*. Los montos convertidos se recalculan al momento. Queda corregida al presionar **Guardar Cambios** (no pide autorización: el campo bloqueado no cuenta como cambio del usuario).
- **Al cambiar la fecha** toma el de la nueva fecha, y al regresar a la original, el oficial de esa fecha.
- **Ya facturadas** (cliente o proveedor): no se cambian solas, porque cambiaría una factura emitida. Salen en amarillo con *ya está facturada: no se cambió solo*. Se corrigen con *Usar el oficial* (si tu rol puede editar el campo) o se deciden en Facturación.
- Si alguien escribe un T.C. a mano, se respeta mientras el formulario está abierto; al volver a abrir la operación regresa al oficial de su fecha.

## Pasos manuales
Ninguno además de aplicar el zip. Para corregir TR-151026-019: ábrela, revisa que diga el T.C. del 15 en azul y presiona Guardar Cambios.

## Técnico
- `formulario/tipoCambioFila.ts`: `tcParaOperacionGuardada({ actual, oficial, facturada, editadoAMano })` (+ prueba en `formatosOperacion.test.ts`).
- `FormularioOperacion.tsx`: la rama "guardada en su fecha" usa esa regla; `tcEditadoAMano` (ref, se marca en el campo Tipo de Cambio y se limpia al cambiar la fecha, con *Usar el oficial* y al cargar otra operación); de vuelta en la fecha original → el oficial (el guardado solo si no hay oficial o ya está facturada). Facturada = `facturadaCliente` / `facturadaProveedor` de `shared/dominio/operacionCanonica.ts`.
- `AvisoTipoCambio`: aviso azul con el T.C. que traía (`traia`) y texto de facturada (`facturada`).
- Banco de pruebas: operación guardada con $18.4250 en una fecha cuyo oficial es otro → al abrir pasa al oficial con el aviso azul (en General y en Por Cobrar); fecha → 15 = el del 15, → 16 = el del 16, de vuelta a la suya = el oficial (no el $18.4250); Guardar deja el oficial en la base y al reabrir sale en verde. Sin errores de consola.
