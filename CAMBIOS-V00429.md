# V00429 — Convenios agrupados, conteo, status de operaciones e integridad relacional

## 1. Convenios "N costos" agrupados y desplegables (Convenio de Clientes / Proveedores)
- Los convenios con el mismo cliente, tarifa, ruta y moneda pero distinto costo se muestran en UNA fila de
  grupo (consecutivos, rango de costos, total de operaciones con su status, "N costos" y "⇒ 1 convenio").
- El botón ▸ N (columna Acciones) o clic en la fila despliega CADA convenio por separado con su consecutivo,
  status, cotizado en, costo editable y operaciones. El checkbox del grupo selecciona todos.
- Se retiró el desplegable de costos que escondía los demás convenios del grupo.

## 2 y 3. Columna de conteo (#)
- Detalle del tarifario (ficha y formulario).
- Modal "Convenios del Cliente" y "Convenios del Proveedor" en la operación.
- Tabla de operaciones de la ficha del convenio.

## 4. Integridad: cliente/proveedor, tarifa y llave foránea NUNCA vacíos
- Nuevo motor src/features/conveniosCompartido/integridadConvenios.ts. Para cada convenio: tarifario (FK) →
  convenio maestro VIVO de la misma empresa (lo crea si no hay) → clienteId/proveedorId escrito en el
  propio convenio → tarifa del catálogo (desde su línea o por nombre) → línea en el tarifario. Compara por
  NÚMERO (CONV-173 = 173). No borra nada ni inventa números; lo que no puede resolver lo reporta.
- Causa de 644/647/648 sin cliente: "+ Agregar" tomaba el convenio maestro del tarifario aunque estuviera
  vacío (tarifario en Pendiente) o borrado. Ahora se repara al instante.
- Se aplica: al abrir Convenio de Clientes/Proveedores (autorreparación una vez por sesión), "🔗 Reparar
  relación", "+ Agregar", ✏ Editar (la tarifa ya es obligatoria), agregar línea al tarifario, aprobar y
  sincronizar tarifario. Editar el convenio desde la operación ya no permite dejarlo sin tarifa.
- Aviso rojo "⚠ N incompleto(s)" junto a Reparar relación con los que falten (clic = reparar).
- SERVIDOR (functions/src/relacional.ts, relacional-v1.4): guardián en convenioCliente/ProveedorDetalleEscrito
  que completa FK, empresa, maestro y tarifa de cualquier convenio que se escriba desde cualquier pantalla.
  ⚠ Requiere publicar functions: `firebase deploy --only functions`.

## 5. Status de cada operación
- Convenio de Clientes/Proveedores: la columna Operaciones muestra chips por status (verde Completado, rojo
  Cancelado, ámbar Falso, azul en curso: Salida del Patio, Programado…). La ficha del convenio lista cada
  operación con su status.
- Tarifario: clic en el número de operaciones despliega la lista (ref, fecha, status, tipo) bajo la línea.
- El status se traduce del ID del catálogo catalogo_status_servicio a su nombre.

## Después de publicar
1. `firebase deploy --only functions` (guardián del servidor).
2. Abrir Convenio de Clientes: se autorrepara. Si queda "⚠ N incompleto(s)", presionarlo y leer el reporte.
3. Hacer lo mismo en Convenio de Proveedores.

## Archivos
src/features/conveniosCompartido/integridadConvenios.ts (nuevo)
src/features/conveniosCompartido/StatusOperaciones.tsx + .css (nuevos)
src/features/conveniosCompartido/logicaStatusOps.ts (nuevo)
src/features/conveniosDetalles/components/DetallesConvenioDashboard.tsx + .css
src/features/tarifarioClientes/components/TarifarioClientesDashboard.tsx + .css
src/features/operaciones/components/FormularioOperacion.tsx + .css
functions/src/relacional.ts
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint igual que antes (Formulario 376, resto 0); build OK; tsc de functions OK.
