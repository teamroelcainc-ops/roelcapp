# V00528 — Facturación de Clientes: "Actualizar factura" en la Ficha · las operaciones abren más rápido

**Solo web.** Va encima de la V00527. Sin funciones, reglas, índices, banderas ni dependencias.

## 1. "Actualizar factura" en la Ficha
El aviso de la Ficha ahora trae el botón **Actualizar factura**. Ya no hace falta entrar a Editar factura. El aviso sale en dos casos:
- una operación tiene otro total hoy (p. ej. la **I8650**: TR-231026-030 guardó $100 y hoy cobra $50);
- la factura no guardó lo que cobró cada operación (las de AppSheet).

Antes de presionarlo, el aviso dice qué va a pasar con el total:
- **No cambia porque ya lo incluía.** Es el caso de la I8650: el total es $200, que ya es $50 + $150.
- **Pasa de A a B.** Ocurre cuando la factura cuadraba con lo que había guardado.
- **No cambia y sigue en Corregir.** Ocurre cuando no cuadraba antes ni cuadra con lo de hoy.
- **Se guarda lo que cobra hoy cada operación y el total no cambia.** Es el caso de las facturas sin importes.

Otros detalles:
- Si no se puede, el botón queda apagado y el aviso dice por qué. Pasa con el dinero en el servidor, con un folio en varios registros o con una factura sin moneda guardada.
- Usa la **misma regla** que el Actualizar de Editar factura (V00520, V00525 y V00527). Ahora vive en un solo archivo (`services/actualizarFactura.ts`) y los dos botones la usan.
- La escritura es la misma de siempre:
  - con importes guardados, una transacción que relee la factura y sus operaciones;
  - sin importes, Completar importes.
- Queda en la bitácora. Al terminar sale un aviso, por ejemplo "Factura I8650 actualizada. El total sigue en 200.00".

## 2. Las operaciones abren más rápido (✎ Editar desde Facturación de Clientes)
Medido en el simulador de la app con una red parecida a la real:

| | Antes | Ahora |
|---|---|---|
| Primer ✎ Editar de la sesión | el formulario sale en ~0.3 s, pero la página queda **trabada ~1.7 s más** (llegan ~14 mil registros de catálogos) | sale en ~0.15 s y no se traba |
| Siguientes | 0.17 a 0.37 s | 0.06 a 0.11 s |

Por qué:
- **Catálogos en segundo plano.** El formulario necesita ~24 catálogos (empresas, unidades, convenios, tarifas, direcciones…).
  - Antes, Facturación de Clientes los abría hasta el primer ✎ Editar. Solo Operaciones Activas los abría antes, y nada más si se visitaba en esa sesión.
  - Ahora se abren solos, uno por uno y con el navegador libre, 3 s después de que se pintan las facturas.
  - Son las mismas lecturas que haría abrir el formulario, y quedan abiertos toda la sesión.
- **Se empieza a leer antes del clic.** Al pasar el mouse por ✎ Editar (en la Ficha, en Editar factura, en Ops. Facturadas y en el detalle), la operación se empieza a leer.
  - El formulario usa esa lectura si tiene menos de 8 s, y solo una vez.
  - Sigue abriendo con la versión más reciente.
  - Es 1 lectura por operación, la misma que ya se hacía al abrirla.

## Archivos (12)
- `src/features/facturacion/services/actualizarFactura.ts` (nuevo) y `actualizarFactura.test.ts` (nuevo)
- `src/features/operaciones/services/lecturaOperacion.ts` (nuevo)
- `src/features/operaciones/components/EditorOperacionEmbebido.tsx`
- `src/features/facturacion/components/FacturacionClientesDashboard.tsx` y `.css`
- `src/features/facturacion/components/OperacionesFacturaEdicion.tsx`
- `src/config/version.ts`, `public/version.json`, `src/config/historialCambios.ts`, `code-notes.md`, `CAMBIOS-V00528.md`

## Pasos manuales
1. Aplica el zip encima de la V00527 (no hay archivos borrados) y haz el commit. El conteo debe dar **12**.
2. Publica la web (`npm run build` y `npx wrangler deploy`).
3. Prueba con la I8650:
   1. La Ficha dice "no cambia: ya lo incluía".
   2. Presiona **Actualizar factura**.
   3. TR-231026-030 debe quedar en $50.00, el total en $200.00 y el aviso debe desaparecer.

## Nota (no cambia en esta versión)
Con `consultasCanonicas` apagada (Paso 12 de la guía), el formulario lee al abrir **hasta 600 operaciones y 300 referencias de diesel** de la unidad, para mostrar su último servicio y su último diesel. Se hace en cada apertura.
- Con la bandera encendida bajan a 2 operaciones.
- Es la mejora de lecturas más grande que queda, y ya está en la guía.
