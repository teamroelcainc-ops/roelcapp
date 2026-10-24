# V00487 — Operaciones: botón Corregir monedas de convenio

**Solo web.** Va encima de la V00486. Sin funciones, reglas, índices ni banderas nuevas (usa la regla de dinero de la V00486; si aún no despliegas `operacionEscrita`, hazlo antes, ver CAMBIOS-V00486.md).

## Qué cambia en pantalla
- En **Operaciones**, a la derecha de las pestañas Activas, Completadas y Canceladas: **Corregir monedas de convenio**.
- Primero **revisa todas las operaciones** sin cambiar nada (una lectura por operación) y dice:
  - **se corrigen**: les falta la Moneda Convenio (Cliente o Proveedor) y su convenio o su conversión guardada dicen cuál es;
  - **para revisar**: el convenio dice una moneda y la conversión guardada otra (por ejemplo, una conversión que quedó sin multiplicar por el tipo de cambio). No se tocan: se abren en el formulario y se guardan;
  - **sin datos**: no hay de dónde saber la moneda. No se tocan.
- Al confirmar, a cada una le pone la moneda del convenio y recalcula **Subtotal, Dólares, Pesos, Conversión y Utilidad** como el formulario. Ejemplo: LO-050626-002 → Moneda Convenio Dólares, Subtotal de $115 a **$1,988.21** Pesos (igual que su Conversión Final).
- Se puede **Detener**; lo ya corregido se queda.

## Pasos manuales
1. Si no lo hiciste con la V00486: desplegar `operacionEscrita` (CAMBIOS-V00486.md).
2. Operaciones → **Corregir monedas de convenio** → revisar la lista → **Corregir N operaciones**.
3. Revisar en el formulario las de **Para revisar**.
4. Facturación (Clientes y Proveedores) → **Corregir monedas y montos**, para que las facturas queden con los montos nuevos.

## Técnico
- `features/operaciones/services/corregirMonedaConvenio.ts` (+ prueba): `monedaDelConvenio`, `revisarOperacion`, `resumirOperaciones`.
- `features/operaciones/services/corregirMonedaConvenioDatos.ts`: `leerConvenios` (catálogos frescos), `revisarTodas`, `corregirOperacion` (transacción).
- `shared/data/consultas.ts`: `paginaOperacionesPorId`, `contarOperaciones`.
- `features/operaciones/components/CorregirMonedasConvenioModal.tsx` + `.css` (`cmc-`); `PestanasOperaciones.tsx` + `.css` (`pop-`); `PestanasModulo` con `acciones`.
