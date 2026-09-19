# V00318 — 🔍 Auditoría de la cadena Operación → Factura → Pago (por cliente)

## Archivos que cambian (respetar rutas)
- `src/features/facturacion/components/AuditoriaCadenaCliente.tsx` — **NUEVO**
- `src/features/facturacion/components/AuditoriaCadenaCliente.css` — **NUEVO**
- `src/features/facturacion/components/FacturacionClientesDashboard.tsx` y `.css`
- `src/config/version.ts` + `public/version.json` — V00318.

## Qué hace
En Facturación de Clientes, junto a las pestañas, botón morado
"🔍 Auditar cliente": eliges el cliente, presionas Auditar, y el sistema
descarga SOLO lo de ese cliente (sus operaciones, sus facturas y sus
pagos) y cruza toda la cadena:

**Por operación** (excluye canceladas, y avisa si una cancelada aparece
en una factura):
- ✅ Facturada y el monto coincide.
- ⚠ **La operación cambió DESPUÉS de facturarse**: compara el monto
  VIGENTE de la operación (recalculado hoy con las MISMAS fórmulas del
  módulo: convenio + cargos + moneda + TC) contra el monto guardado en la
  factura, y muestra la diferencia exacta.
- ⚠ Sin facturar.
- ⚠ En varias facturas (posible doble cobro).

**Por factura**:
- ✅ Pagada y los montos cuadran.
- ⏳ Saldo pendiente (cuánto).
- ⚠ Los pagos APLICADOS no cuadran con el pagado registrado.
- ⚠ Pagada de más.
Con sus números de pago a la vista.

**Totales del cliente** en la escala de conversión (pesos): operaciones
HOY vs facturado vs aplicado por pagos — y el conteo de problemas arriba,
en verde si todo está correcto.

**⬇ Excel del reporte**: un archivo con 3 hojas (Operaciones, Facturas y
Pagos, Totales) para revisar o compartir la auditoría.

## Sobre "el cambio se refleja en facturación"
El monto por operación en Facturación YA se recalcula en vivo desde la
operación (V00126) y el botón "↻ Actualizar monto" trae el vigente a una
operación capturada. Lo que la auditoría agrega es la VISTA DE CONTROL:
detectar las facturas emitidas cuyo monto quedó distinto al vigente para
corregirlas con criterio. Si quieres, la siguiente entrega puede ser el
espejo para Proveedores.

## Verificación
- `tsc --noEmit` ✓ · eslint: componente nuevo en 0; el dashboard en 308 =
  su baseline exacto · `npm run build` completo ✓

## Al instalar
Copia los 2 archivos NUEVOS en src/features/facturacion/components/,
reemplaza los 2 del dashboard + versión, `npm run build` y publica.
