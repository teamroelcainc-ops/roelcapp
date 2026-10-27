# V00502 — Buscador global en la barra de arriba (como el de QuickBooks)

**Solo web.** Va encima de la V00501. Sin funciones, reglas, índices ni banderas.

## Qué pidió Roelca
Un buscador como el de QuickBooks en toda la app: al escribir, que busque todo lo relacionado; al hacer clic en un resultado, que abra el detalle o el módulo. Decisiones tomadas:
- Busca operaciones, facturas y pagos, empresas y convenios, empleados, unidades y remolques.
- Las operaciones del historial se buscan por el **inicio** del texto.
- Va en la barra de arriba.

## Qué cambia
- La barra de arriba ("Sin búsqueda en este módulo") ahora dice **"Buscar en toda la app (Ctrl+K)"** y funciona en todos los módulos.
  - Al escribir se abre una lista agrupada: Operaciones, Facturas, Pagos, Empresas, Convenios, Empleados, Unidades y Remolques. Hasta 6 por grupo, los que mejor coinciden.
  - Cada resultado muestra su fecha, monto y estado (Activa, Completada, Cancelada; Abierta, Parcial, Pagada…).
- **Clic o Enter abre el detalle** en su módulo:

  | Resultado | Se abre en | Qué abre |
  |---|---|---|
  | Operación | Operaciones (Activas, Completadas o Canceladas, según su status) | Su ficha |
  | Factura | Facturación (Clientes o Proveedores) | La ficha de la factura, en el Historial |
  | Pago | Pagos, en su pestaña | El pago |
  | Empresa | Empresas | El Detalle de Empresa |
  | Convenio | Convenio de Clientes o de Proveedores | La ficha del convenio |
  | Empleado | Empleados | Su ficha |
  | Unidad | Unidades | Su detalle |
  | Unidad de proveedor y remolque | Sus módulos | Su registro (esos módulos no tienen ficha) |
- **Cómo encuentra:**
  - Sin importar mayúsculas ni acentos ("castaneda" encuentra "A. CASTAÑEDA & CO.").
  - Las palabras en cualquier orden.
  - Empresas, convenios, empleados, unidades, remolques, facturas y pagos: por cualquier palabra de su nombre, número, RFC, placas, invoice, monto, etc.
  - Operaciones: por el **inicio** de la referencia (`TR-2610…`), de la ref. cliente o del remolque, desde 3 letras.
- **Teclado:**
  - **Enter** abre la mejor coincidencia de todas, aunque su grupo esté más abajo (por ejemplo, al escribir el nombre exacto de una empresa, abre la empresa y no un pago de esa empresa).
  - ↑ ↓ para moverse, Esc cierra.
  - **Ctrl+K** pone el cursor en el buscador desde cualquier pantalla, incluso con una ficha abierta: la lista sale encima.
  - Con la caja vacía muestra **lo abierto hace poco** (solo en esa sesión).
- Si el módulo en pantalla tenía su búsqueda en la barra (Facturación, Empresas, Completadas, Canceladas, Convenios, Tarifarios, Catálogos), **la sigue filtrando como antes**; la lista lo avisa ("También filtra … en esta pantalla").
- Solo salen resultados de los módulos que el rol puede abrir.
- "Ver pago" en la ficha de una factura (V00483) ahora usa el mismo mecanismo de apertura. Funciona igual que antes; se probó en el simulador.

## Lecturas
- Empresas, convenios, empleados, unidades y remolques: los catálogos que la app ya tiene abiertos. No hay lecturas nuevas.
- Facturas y pagos: los mismos listeners de Facturación y Pagos, con la misma clave. Si esos módulos ya se abrieron en la sesión, no cuesta nada. Si no, la primera vez que se usa el buscador baja las facturas y los pagos una vez (igual que al entrar a Pagos).
- Operaciones: unas 8 consultas pequeñas (como mucho 6 operaciones cada una) por búsqueda, 350 ms después de dejar de escribir.

## Pasos manuales
1. Aplicar el zip (no hay archivos borrados).
2. No hay que desplegar funciones.

## Técnico
- `shared/data/aperturas.ts` (+ prueba):
  - `abrirRegistro(modulo, id, tipo?)` deja un pedido y navega.
  - Cada módulo lo atiende con `useAtenderApertura(modulo, abrir, listo)` en cuanto se ve: sirve con el módulo ya montado (MantenerVivo) o recién montado.
  - El pedido vale 2 minutos. `avisarNoEncontrado`.
- Módulos conectados:
  - Operaciones Activas, Completadas y Canceladas: `operaciones/services/operacionPorId.ts` lee la operación por id real.
  - Facturación Clientes y Proveedores.
  - Pagos: `pagoPedido.ts` ahora usa `abrirRegistro`; `consultaPagos.ts` es la consulta compartida.
  - Empresas (registro enriquecido), Convenios (las dos instancias), Empleados, Unidades, Unidades de proveedor y Remolques.
- `facturacion/services/gruposFactura.ts` (+ prueba): el armado de grupos del Historial, que estaba copiado igual en Clientes y Proveedores, ahora es compartido. En el simulador, las primeras 50 filas del Historial de los dos son idénticas a las de la V00501 (incluida una factura de dos documentos).
- `features/buscador/` (servicios con pruebas):
  - `coincidencias.ts`: normalizar y puntaje, con el texto normalizado guardado por registro: 12–30 ms por tecla con 15,000 facturas y 4,000 pagos.
  - `resultados.ts`: qué se muestra y a dónde lleva; el status sale del catálogo.
  - `buscarOperaciones.ts`: prefijos de `ref`, `refCliente` y `remolqueNombre`, con variantes de mayúsculas; `porPrefijo` en `shared/data/consultas.ts`.
  - `recientes.ts`: en memoria.
  - `hooks/useResultadosBusqueda.ts`.
- `components/layout/BuscadorTopbar.tsx`: solo la caja (en el arranque). La lista y su búsqueda van en `features/buscador/components/PanelBuscador.tsx` (+ `.css`, prefijo `bgl-`), que se carga la primera vez que se abre el buscador. El arranque pasa de 239.4 a 240.8 KB comprimido; la lista son 5.5 KB aparte. `utils/permisos.ts`: `useClavesPermitidas`.
- Simulador (16,000 operaciones, 15,000 facturas, 4,000 pagos), 12 casos con el teclado:
  - Operación activa, completada y cancelada, cada una en su pestaña.
  - Factura, pago, pago con Pagos ya abierto, empresa, convenio, empleado, unidad, unidad de proveedor y remolque.
  - Además, "Ver pago" desde la ficha de una factura.
  - Recientes y "Sin resultados".
- No probado contra datos reales: las operaciones de AppSheet cuya referencia, ref. cliente o remolque se guardaron en otro formato. Como la fecha en la V00500, no salen por el inicio del texto si se escribe distinto (por ejemplo, con o sin guiones).
