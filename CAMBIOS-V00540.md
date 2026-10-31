# V00540 — Revisión de datos: Solucionar abre el formulario encima de la ventana

**Solo web.** Va encima de la V00539. Sin funciones, reglas, índices, banderas ni dependencias.
**Tipo:** fix (cambia lo que se ve).

Pedido del 31-oct: al presionar **Solucionar**, el formulario se abre **encima** de la Revisión de datos. Al cerrarlo, la ventana sigue en el mismo grupo y en el mismo lugar de la lista. Antes, la ventana se cerraba y te llevaba al módulo.

## Qué abre cada Solucionar

| Grupo | Qué abre | Al cerrarlo |
| --- | --- | --- |
| D1, D2, D4, D5 | El **formulario de la operación**, encima | Sigues en la Revisión, mismo grupo y lugar |
| F2, F2c | **Editar factura**, encima. Su ✎ Editar abre el formulario de la operación encima de los dos | Igual |
| F5 | Va a **Facturación de Clientes** → Asignar operaciones, con la operación ya seleccionada (lo elegiste así: una factura junta varias operaciones del mismo cliente) | Al regresar a **Operaciones**, la Revisión se abre sola en F5 y en el mismo lugar |

Al cerrar el formulario, lo que tocaste se vuelve a revisar solo. Si ya quedó bien, sale de la lista.

Mientras un formulario está abierto (también si lo minimizas), los demás **Solucionar** y la ✕ de la ventana quedan apagados. Así no se pierde lo que no has guardado.

**Abrir** y los botones con la referencia siguen llevando a la ficha en su módulo, como antes.

## Editar factura ahora es su propio formulario
Para poder abrirlo encima de la Revisión, Editar factura salió de `FacturacionClientesDashboard` a su propio formulario. Es el mismo formulario y guarda igual, paso por paso:
- con y sin `dineroPorServidor`;
- cancelación;
- documentos;
- folio en las operaciones;
- Actualizar;
- subtotal a mano.

En Facturación se abre desde los mismos lugares (Historial, Ficha, Auditoría) y se ve igual.

Lo que cambia en Facturación:
- Si **Actualizar** no encuentra nada que cambiar en el servidor, avisa igual que antes.
- Las reglas de moneda de la factura y del cliente salieron del tablero a `monedaFacturaCliente.ts`, sin cambios. Las usan el tablero y Editar factura.

## Archivos (30)
- **Nuevos:**
  - `facturacion/components/EditarFacturaCliente.tsx/.css` (el formulario);
  - `facturacion/components/EditarFacturaClienteEmbebida.tsx/.css` (abrirlo desde otro módulo);
  - `facturacion/hooks/useEdicionFacturaCliente.ts` (estado y guardado);
  - `facturacion/services/edicionFacturaCliente.ts` y `monedaFacturaCliente.ts`, con sus pruebas;
  - `operaciones/services/volverARevision.ts`, con su prueba;
  - `shared/utils/formatos.ts` (`formatearMoneda`).
- **Cambiados:**
  - `FacturacionClientesDashboard.tsx/.css` (usa el formulario nuevo; quedan 3 `style={{` menos);
  - `actualizarFactura.ts` (avisos compartidos);
  - `RevisionDatosModal.tsx/.css`;
  - `PestanasOperaciones.tsx`;
  - `OperacionesDashboard.tsx`, `ServiciosCompletados.tsx`, `ServiciosCancelados.tsx` y `shared/data/aperturas.ts`: se quitó el tipo `'editar'` (V00538), que ya no usa nadie;
  - `scripts/lint-baseline.json` (bajó el tablero de Facturación);
  - versión, historial, `CLAUDE.md`, `code-notes.md`, `refactor-progress.md` y este archivo.

## Pasos manuales
1. Aplica el zip encima de la V00539 (no hay archivos borrados):
   ```
   git add src public/version.json scripts/lint-baseline.json CAMBIOS-V00540.md CLAUDE.md code-notes.md refactor-progress.md
   ```
   El conteo debe dar **30**.
2. Nada que desplegar.

## Qué revisar en el navegador
1. **D5:**
   - Revisión de datos → D5. Baja en la lista y presiona **Solucionar** en una fila.
   - El formulario se abre encima. Ciérralo: sigues en D5, en el mismo lugar.
2. **F2c:**
   - **Solucionar** abre Editar factura encima.
   - En sus operaciones, **✎ Editar** abre el formulario encima de los dos. Ciérralo: vuelves a Editar factura.
   - Cierra Editar factura: sigues en F2c.
3. **F5:**
   - **Solucionar** te lleva a Facturación con "Generar Factura (1)".
   - Regresa a Operaciones: la Revisión se abre sola en F5, en el mismo lugar.
4. **Facturación:**
   - Historial → ✎ Editar factura: el mismo formulario de siempre.
   - Cambia algo y **Actualizar** guarda como antes. Prueba con una factura de prueba.

## Lo que probé y lo que no
Pasan todas las verificaciones:
- tsc, ESLint (el tablero de Facturación bajó de 205 a 196 problemas), verificar-consultas y verificar-css;
- Vitest: 900 pruebas, 9 nuevas en 3 archivos;
- repintados (`medir:render`): iguales;
- peso: Facturación Clientes 394 → 395 KB gz; las demás pantallas, igual.

En el simulador:
- D5 → el formulario quedó encima y al cerrarlo la lista siguió en el mismo lugar (scroll 900 → 900).
- F2c → Editar factura quedó encima. ✎ Editar abrió la operación encima de los dos; al cerrarla volvió a Editar factura.
- F2c → Actualizar mostró el aviso de siempre ("El cliente no tiene moneda en Empresas"): en el simulador ese cliente no tiene moneda.
- F5 → Facturación con "Generar Factura (1)". Al volver a Operaciones, la Revisión se abrió en F5 con el mismo scroll (400 → 400).
- Facturación → Historial → Editar factura abrió con su folio y sus 2 operaciones. Actualizar quedó apagado sin cambios, y Cancelar lo cerró.

**No probé** guardar Editar factura con Firestore real ni con `dineroPorServidor` encendido. El guardado es el mismo código, movido de lugar.
