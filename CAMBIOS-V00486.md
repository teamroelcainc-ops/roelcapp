# V00486 — Operaciones sin moneda del convenio: Facturación ya da lo mismo que Por Cobrar

**Web y Cloud Functions.** Va encima de la V00485. Sin reglas, índices ni banderas nuevas.

## Qué pasaba
Algunas operaciones (sobre todo las que vienen de AppSheet) no tienen guardada la **Moneda Convenio**. Por ejemplo, la LO-050626-002 de Juan Carlos Quintanar Zamudio: convenio de 115, facturada en Pesos, con TC 17.2888.
- **Por Cobrar** (el formulario) la calculaba con el convenio en dólares: 115 × 17.2888 = **$1,988.21** pesos, que es lo que pagó el cliente.
- **Facturación** la tomaba como si el convenio fuera en pesos: **$115** pesos. Por eso la factura A5652 dice $115 y el pago sale como pagado de más.

## Qué cambia
- Cuando a una operación le falta la moneda del convenio, se **deduce de la conversión que ya tiene guardada**: si la conversión es el convenio × TC, el convenio era en dólares; si es igual al convenio, era en pesos. Si no hay conversión guardada, todo sigue igual que antes.
- Aplica a Clientes y Proveedores, y al facturar, Corregir monedas y montos, Pagos y el servidor (misma regla).

## Pasos manuales
1. Publicar la web como siempre.
2. **Desplegar la función** (cambia la cascada de montos del servidor):
   `npm --prefix functions run build` y luego `firebase deploy --only functions:operacionEscrita`.
   Si `dineroPorServidor` está encendida, desplegar todas: `firebase deploy --only functions`.
3. Correr **Corregir monedas y montos** en Clientes y en Proveedores: las facturas como la A5652 pasan a su total en pesos ($1,988.21) y dejan de salir pagadas de más. Revisa la lista antes de confirmar.

## Técnico
- `src/shared/dominio/dinero.ts`: `monedaConvenioDeducida`, `monedaConvenioDe`; `conversionOperacion` usa la deducida cuando el campo no se reconoce. Pruebas en `dinero.test.ts` (la paridad con la regla anterior excluye los casos deducidos).
- `functions/src/relacional.ts`: `conversionOperacionLegado` con la misma deducción. `functions/src/dominio/dinero.ts` es la copia generada.
