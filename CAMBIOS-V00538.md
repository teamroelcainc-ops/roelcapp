# V00538 — Revisión de datos: botón Solucionar (D1, D4, D5, F2 y F2c)

**Solo web.** Va encima de la V00537. Sin funciones, reglas, índices, banderas ni dependencias.
**Tipo:** fix (cambia lo que se ve).

Es la primera parte de "un botón para solucionar en todas partes" (pedido del 31-oct). La segunda parte (D2, F3, F5 y F2c automático) va en la V00539.

## Qué hay en cada grupo

| Grupo | Botón | Qué hace |
| --- | --- | --- |
| F1, D3, D6 | (ya existían) | Marcar facturadas, Corregir status, Confirmar todas |
| **D1** y **D4**, sin facturar | **Corregir monedas y montos** | La herramienta de Operaciones: "Facturado en" con la moneda de la empresa y montos con la regla |
| **D1** y **D4**, ya facturadas | **Revisar las facturadas** → pasos | La factura emitida manda (lo decidiste así): la operación toma la moneda y el monto con que se facturó. La factura y sus pagos **no cambian** |
| **D5**, **D1**, **D4** (cada fila) | **Solucionar** | Abre directo el **formulario** de la operación (antes Abrir llevaba a su ficha) |
| **F2**, **F2c** (cada fila) | **Solucionar** | Abre directo **Editar factura** de esa factura |

### D1/D4 facturadas: cuándo se corrige sola y cuándo no
Se calcula con la misma regla de "Corregir monedas y montos", como si no estuviera facturada. **Solo se escribe si cuadra con la factura**:
- la factura está en la moneda de la empresa (la nueva "Facturado en");
- la Conversión que da la regla es el monto con que se facturó (±1 centavo).

Si no cuadra, se queda **a mano**. La lista y la prueba dicen el motivo, por ejemplo:
- "Se facturó 2000.00 Pesos y con su convenio y TC da 2328.30";
- "La factura está en Dólares y la empresa factura en Pesos".

Así una factura emitida nunca cambia por este botón.

Pasos (los mismos de F1):
1. Descargar la prueba en Excel: antes y después de cada campo, o por qué se deja a mano.
2. Descargar el respaldo.
3. Confirmar que las funciones de la V00496 están publicadas.
4. Escribir APLICAR.

Se escribe en tandas de 50. Cada operación y su factura se vuelven a leer al escribir: si algo cambió desde la prueba, no se toca y se dice por qué. Queda en la bitácora y marca `montosDeFacturaEn`.

## Archivos (23)
- **Nuevos:**
  - `PasosCorreccion.tsx/.css` (los pasos de cualquier corrección nueva);
  - `CorregirMonedasRevision.tsx/.css`;
  - `services/tomarDeFactura.ts`, `tomarDeFacturaDatos.ts` y `correccion.ts`;
  - 3 archivos de pruebas.
- **Cambiados:**
  - `RevisionDatosModal.tsx/.css`;
  - `shared/data/aperturas.ts` (`TIPO_APERTURA_EDITAR`);
  - Operaciones, Completados, Cancelados y Facturación Clientes (abren el formulario o Editar factura cuando se pide);
  - versión, historial, `code-notes.md`, `refactor-progress.md` y este archivo.

## Pasos manuales
1. Aplica el zip encima de la V00537 (no hay archivos borrados):
   ```
   git add src public/version.json CAMBIOS-V00538.md code-notes.md refactor-progress.md
   ```
   El conteo debe dar **23**.
2. Antes de aplicar "Tomar lo de la factura": las 6 funciones de la V00496 publicadas.

## Qué revisar en el navegador
1. **D4:** Operaciones → Revisión de datos → Revisar → D4.
   - Arriba de la lista aparece **Solucionar**.
   - "Revisar las facturadas" dice cuántas se corrigen y cuántas quedan a mano.
   - Descarga la prueba y revísala. Aplica solo cuando estés de acuerdo.
2. **D5:** en una fila, **Solucionar** abre el formulario de esa operación.
3. **F2:** en una fila, **Solucionar** abre Editar factura de esa factura.
4. **Lista al día:** al volver a la Revisión, lo corregido ya no aparece.

## Lo que no pude probar en el navegador real
tsc, ESLint, verificar-consultas y verificar-css pasan. Vitest pasa: 882 pruebas, 9 nuevas. Hay prueba de la regla, de los pasos y de la escritura con una transacción simulada.

En el simulador:
- D5 → Solucionar abrió el formulario de RFT-29989;
- F2c → Solucionar abrió Editar factura de INV-10374.

El simulador no tiene operaciones en D1 ni D4, así que el panel de monedas no lo vi con datos. **No probé** con Firestore real, ni con operaciones facturadas reales.
