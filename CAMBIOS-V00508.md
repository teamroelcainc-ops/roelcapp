# V00508 — Remisión en cualquier status · Pasar operaciones a otra empresa

**Solo web.** Va encima de la V00507. Sin funciones, reglas, índices ni banderas. Cambia datos solo cuando el usuario lo pide desde la ventana nueva.

## 1. Facturación: la Remisión siempre visible
En **Facturación de Clientes** (botón de la tabla y de la ficha) y en **Facturación de Proveedores** (ficha), el botón **Remisión** se ve en cualquier status de la factura. Desde la V00481 se ocultaba cuando la factura estaba Facturada.

## 2. Empresas: pasar operaciones a otra empresa
Para cuando una operación se capturó con la empresa equivocada. Ejemplo: se usó a Monar International Transport Inc (alias de cliente) donde iba Jose Fernando Carbajo Jimenez (su nombre como proveedor).

1. En Empresas, abre la empresa (Monar) → pestaña **Referencias** → Operaciones.
2. Marca las operaciones con su casilla. La casilla del encabezado marca todas las que se ven; respeta la búsqueda.
3. Presiona **Pasar a otra empresa (N)**.
4. En la ventana:
   - **Empresa a la que pasan:** búscala por razón social, nombre corto o # de cliente.
   - **Papel que cambia:** por ejemplo Proveedor (Unidad). Salen solo los papeles que tiene la empresa en las operaciones marcadas, con cuántas son.
   - **Si alguna ya está facturada en ese papel**, la ventana pregunta qué hacer con ellas:
     - **No pasarlas.**
     - **Pasarlas sin tocar su factura:** la factura y sus pagos siguen a nombre de la empresa origen.
     - **Pasarlas con su factura:** la factura y sus pagos también pasan. Solo si todas las operaciones de esa factura se pasan, si la empresa destino no tiene ya ese folio y si el pago no paga también otra factura que se queda.
   - Abajo dice cuáles pasan (con sus facturas y pagos) y **cuáles no, con el motivo**.
5. **Pasar N** → **Sí, pasar**. Al terminar dice cuántas pasaron. **Cerrar y actualizar** vuelve a leer Referencias.

Qué cambia y qué no:
- **Solo cambia la empresa** en ese papel, con su nombre. Montos, convenio y moneda se quedan como están.
- La operación tarda unos segundos en salir de la lista de la empresa origen, porque el servidor actualiza sus datos.
- Queda en la **bitácora** (historial de actividad): qué referencias, facturas y pagos pasaron, de quién a quién.
- Para deshacer, usa la misma ventana al revés (de Jose Fernando a Monar).

## Pasos manuales
1. Aplicar el zip (no hay archivos borrados).
2. No hay que desplegar funciones.
3. Mientras Cloudflare no pueda descargar el repositorio (la falla del 27-oct), publica después del push con `npm run build` y `npx wrangler deploy`.

## Técnico
- Remisión: se quitaron `puedeGenerarRemision` y `AVISO_REMISION_FACTURADA` de `reglasFactura.ts` y sus usos en las dos pantallas. Prueba ajustada.
- `features/empresas/services/pasarOperaciones.ts` (puro, con pruebas):
  - `planDePase` decide qué pasa y por qué no (las tres decisiones; el descarte de facturas se repite hasta que no cambia nada);
  - `cambiosDeOperacion` / `cambiosDeFactura` / `cambiosDePago` arman los cambios. Los nombres siguen las reglas de `shared/dominio/nombres.ts`.
  - No escribe campos canónicos: los recalcula `operacionEscrita`.
- `pasarOperacionesEscritura.ts`:
  - Lee las facturas del lado que cambia (de la origen y de la destino) y los pagos de la origen, con consultas por empresa.
  - Escribe con `runTransaction`, que relee cada documento: las operaciones sin factura van en tandas de 100, y cada factura va con sus operaciones y pagos en la misma transacción (todo o nada).
  - Deja una entrada en `historial_actividad`.
- `PasarOperacionesModal.tsx` + `.css` (prefijo `pso-`). En `EmpresasDashboard.tsx`: casillas, botón `ed-refs-pasar` y la ventana perezosa.
- Simulador:
  - Se marcaron 5 operaciones de "Monar Prueba 508" y se pasaron a "Jose Fernando Prueba 508" como Proveedor (Unidad), con su factura. Pasaron A, B y C, más la factura P-508A y su pago.
  - D no pasó: su factura P-508B tiene otra operación (E) que no se marcó. F no pasó: ahí la empresa es Cliente que Paga. E quedó igual.
  - La bitácora quedó con las referencias. Sin errores en consola.
  - Remisión: las 50 facturas Facturado de la lista de Clientes tienen el botón, y la ficha de Proveedores lo muestra.
- No probado contra datos reales: el servidor (operacionEscrita) recalcula los campos canónicos después de escribir. En el simulador no hay servidor, así que eso se ve en producción.
