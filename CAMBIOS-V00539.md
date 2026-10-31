# V00539 — Revisión de datos: Solucionar también en D2, F3, F2c y F5

**Solo web.** Va encima de la V00538. Sin funciones, reglas, índices, banderas ni dependencias.
**Tipo:** fix (cambia lo que se ve).

Es la segunda parte de "un botón para solucionar en todas partes". Con esta versión **todos los grupos tienen botón**.

## Todos los grupos

| Grupo | Botón | Qué hace |
| --- | --- | --- |
| F4 (0) | Abrir | Hoy no hay ninguna. Si aparece una, se decide en Facturación cuál factura se queda |
| F1 | Marcar facturadas | (ya existía) |
| **D2** Referencia repetida | **Solucionar** (panel) | La **creada primero** se queda con la referencia; las demás reciben el siguiente consecutivo de su línea (LÍNEA-DDMMAA-NNN) |
| **F3** Invoice que no existe | **Solucionar** (panel) | **Ligar** a la factura que la lista, o **liberar** (vuelve a Por facturar) |
| D1, D4 | Solucionar (panel) | (V00538) |
| D5 | Solucionar por fila | Abre el formulario (V00538) |
| F2 | Solucionar por fila | Abre Editar factura (V00538) |
| **F2c** centavos | **Solucionar** (panel) | **Actualizar factura** en lote: queda al centavo con sus operaciones |
| D6 | Confirmar todas | (ya existía) |
| **F5** Terminadas sin facturar | **Solucionar** por fila | Abre **Facturación de Clientes** → Asignar operaciones, con su cliente y esa operación **ya seleccionada** para Generar Factura |
| D3 | Corregir status | (ya existía) |

## Cuándo NO se corrige solo (queda a mano, con el motivo)

**D2**
- Alguna operación del par no tiene fecha de creación: no se sabe cuál se creó primero.
- La referencia no tiene la forma LÍNEA-DDMMAA-NNN.
- La operación que se renumeraría ya está facturada: su factura guarda esa referencia.

**F3**
- La listan dos o más facturas (grupo F4).
- Hay una factura de su cliente con el folio escrito distinto, pero esa factura no la lista. Ligarla dejaría la factura incompleta, y agregarla cambiaría el total de una factura emitida.
- Su id de factura apunta a una factura que no la lista.

**F2c**
- La factura ya estaba al día con sus renglones: la diferencia viene de la factura misma.
- No cuadraba desde antes. En los dos casos se arregla con Solucionar → Editar factura.

## Cómo se escribe
- Todo con los mismos pasos: Excel de prueba, respaldo y escribir APLICAR. F3 y F2c piden además confirmar las funciones de la V00496, porque tocan operaciones facturadas o facturas.
- **D2:** una operación a la vez, en una transacción con el contador de su línea. El consecutivo es el máximo real de la línea más 1: no choca con una operación que se esté creando al mismo tiempo. Guarda la referencia anterior en `refAnterior`.
- **F3:** tandas de 50. Se relee cada operación, y la factura a la que se liga.
- **Cambios desde la prueba:** si algo cambió, no se toca y se dice por qué.
- **Bitácora y avisos:** todo queda en la bitácora y avisa a las demás pantallas.

## Archivos (18)
- **Nuevos:**
  - `SolucionarPlanes.tsx/.css`;
  - `services/correccionesD2F3.ts` y `correccionesD2F3Datos.ts`;
  - `correccionF2cDatos.ts`;
  - 2 archivos de pruebas.
- **Cambiados:**
  - `revisionDatos.ts`, que arma los planes de D2 y F3, más su prueba;
  - `RevisionDatosModal.tsx`;
  - `FacturacionClientesDashboard.tsx` (abre Asignar operaciones lista para facturar);
  - `shared/data/aperturas.ts`;
  - versión, historial, `code-notes.md`, `refactor-progress.md` y este archivo.

## Pasos manuales
1. Aplica el zip encima de la V00538 (no hay archivos borrados):
   ```
   git add src public/version.json CAMBIOS-V00539.md code-notes.md refactor-progress.md
   ```
   El conteo debe dar **18**.
2. Antes de aplicar F3 o F2c: las 6 funciones de la V00496 publicadas.

## Qué revisar en el navegador
1. **D2:** Revisión de datos → D2.
   - El panel dice cuántas se renumeran y cuántas quedan a mano.
   - Descarga la prueba: cada una dice cuál se queda con la referencia.
2. **F3:** el panel dice cuántas se ligan, se liberan o quedan a mano.
   - En la prueba, revisa las que se liberan: que no se hayan facturado fuera del sistema.
3. **F2c:** aplica con 2 o 3 facturas primero, usando el rango de fechas. Ábrelas en Facturación: el total quedó igual a sus operaciones.
4. **F5:** en una fila, **Solucionar** lleva a Facturación de Clientes → Asignar operaciones, con el cliente puesto y "Generar Factura (1)".

## Lo que no pude probar en el navegador real
tsc, ESLint, verificar-consultas y verificar-css pasan. Vitest pasa: 891 pruebas, 9 nuevas, entre ellas el renumerado con el máximo real y F3 con una transacción simulada.

En el simulador:
- F2c mostró su panel con sus 15 facturas;
- F5 → Solucionar llevó a Asignar operaciones con RFT-29737 en la tabla y "Generar Factura (1)".

El simulador no tiene D2 ni F3, así que esos paneles no los vi con datos. **No probé** con Firestore real.
