# V00470 — Reglas de Estatus: costo del puente en el paso y aduana solo en Transfer

**Solo web.** Va encima de la V00469. Sin reglas, índices ni banderas. `functions/src/dominio/cobroPuente.ts` cambia porque es la copia generada de `src/shared/dominio`: trae una función nueva que el servidor no usa, así que **no hace falta desplegar funciones** por esta versión.

## Qué cambia en pantalla
1. **Configuración → Reglas de Estatus → panel del paso → Saldo del puente.** Debajo de *🌉 Aquí se descuenta el puente* se ven, solo informativos, la caseta y su costo:
   - **Importación:** Caseta AVI (p. ej. *$23.75 USD*); **Exportación:** Caseta Puente III (p. ej. *$144.00 MXN*);
   - **flujo con aduana Colombia: dos campos**, la **Caseta** (Caseta Mx Colombia, o Trompo Colombia si la carga es trompo) y el **Puente** (Puente Mx Colombia);
   - **flujo para todos los tráficos:** un campo por tráfico (Importación y Exportación);
   - el costo es el del catálogo **Tipos de Gastos**. Si la tarifa del convenio de la operación trae su propia caseta, se cobra la de la tarifa, y así lo dice debajo;
   - en un flujo de Transfer para todas las aduanas, una línea dice cuánto cobra una operación de Colombia;
   - en Logística avisa que solo se cobra con proveedor Roelca; en Fletes y Movimientos dice que no se cobra puente.

   Sale en el paso marcado con 🌉. Si ningún paso del flujo está marcado, sale en los Verde (que es donde se cobra en ese caso).
2. **El selector Aduana solo aparece en los flujos de Transfer.** Al cambiar el servicio a otro, la aduana se borra. En la lista de flujos, los que no son Transfer dicen *—* en Aduana.

## Pasos manuales
Ninguno.

## Técnico
- `src/shared/dominio/cobroPuente.ts`: `casetasDeFlujo(tiposGasto, { trafico, carga, aduana })` → `LineaPuenteFlujo[]` (etiqueta, nombre, monto o null si el tipo de gasto no está en el catálogo, moneda). Tiene pruebas en `cobroPuente.test.ts`.
- `ConfiguradorStatus.tsx`:
  - el catálogo `catalogo_tipos_gastos` se lee con `useCatalogos`;
  - `infoPuente` (memo) pasa al `Inspector` como `puente`;
  - `cobraAqui` = el paso tiene 🌉, o ningún paso lo tiene y es un Verde;
  - `esServicioTransfer`;
  - `aduanaFlujo` (vacía fuera de Transfer) en `configId` y al guardar.
- `ConfiguradorStatus.css`: `.cs-puente-costos`, `.cs-puente-campo`, `.cs-puente-monto(--falta)`, `.cs-puente-nota`. Sin `style={{` nuevos (46).
- Banco de pruebas, con el flujo *Transfer · Exportación · Cargado*:
  - el paso *9.1 Verde Mx (Exportación)* con 🌉 muestra *Caseta: Caseta Puente III $144.00 MXN*, más la línea de Colombia;
  - con Aduana 800 Colombia: *Caseta: Caseta Mx Colombia $144.00 MXN* y *Puente: Puente Mx Colombia $100.00 MXN*;
  - con Servicio *Logística Fletes* desaparece el selector Aduana;
  - sin errores de consola.
