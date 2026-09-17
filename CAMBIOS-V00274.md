# V00274 — Documento firmado en detalle/editar/nuevo, montos a 2 decimales (TC hasta 4) y referencia → editor

## Archivos que cambian (respetar rutas)
- `src/features/tarifarioClientes/components/TarifarioClientesDashboard.tsx` y `.css`
- `src/features/tarifarioProveedores/components/TarifarioProveedoresDashboard.tsx`
- `src/features/facturacion/components/FacturacionClientesDashboard.tsx`
- `src/features/facturacion/components/FacturacionProveedoresDashboard.tsx`
- `src/features/operaciones/components/FormularioOperacion.tsx`
- `src/features/hilo/HiloModal.tsx`
- `src/features/pagos/components/PagosDashboard.tsx`
- `src/features/panelControl/PanelControlDashboard.tsx`
- `src/features/empleados/components/DeduccionesDashboard.tsx`
- `src/features/empleados/components/HerramientasEmpleado.tsx`
- `src/config/version.ts` y `public/version.json` — bump a V00274.

## 1) Tarifario firmado en el DETALLE, en EDITAR y en NUEVO (ambos tarifarios)
- **Ficha (detalle):** botón "📎/📄 Tarifario firmado" junto a Editar —
  clic ve el documento (Ctrl+clic reemplaza) o lo sube si falta.
- **Formulario (Nuevo y Editar):** campo "Tarifario firmado (escaneado)"
  bajo las fechas: eliges el archivo y SE SUBE AL GUARDAR — en el nuevo,
  cuando ya existe el consecutivo TARI-/TARP-### (por eso se difiere).
  En edición muestra el ya subido con opción de reemplazar. Si la subida
  fallara, el tarifario se guarda igual y te avisa para subirlo desde la
  fila. Todo con la misma relación 1:1 (docFirmadoUrl/Nombre/Fecha) y log.

## 2-3) TODOS los montos a 2 decimales; tipo de cambio hasta 4
Barrido de formateadores en toda la app; corregidos los que mostraban
más (o menos) de 2: Facturación Clientes y Proveedores (hasta 6),
Hilo de facturas (6), Pagos (6), Panel de Control (0 — enteros),
Herramientas de empleado (sin tope) y Deducciones (Fonacot/préstamos/
ahorros iban a 4 "como AppSheet" → ahora 2). Operaciones, tarifarios,
convenios, MTTO y gastos YA estaban en 2/2 (verificado). El TIPO DE
CAMBIO no se toca al mostrar (valor tal cual) y su captura en la
operación ahora tiene paso de 0.0001 — hasta 4 decimales.

## 4) Facturación: clic en la referencia → EDITOR de la operación
El chip TR-… del historial abre el formulario de EDICIÓN de operaciones
(EditorOperacionEmbebido), ya no el detalle. Clientes y Proveedores.

## Verificación
- `tsc --noEmit`: 0 errores. ESLint: todos los archivos tocados idénticos
  o mejores que su base (tarifarios en 0; FormularioOperacion 377;
  FacturacionClientes 308; FacturacionProveedores 335; los 5 menores
  idénticos a su baseline).
- `npm run build`: OK (PWA generada).

## Nota al publicar
Prueba una subida de documento (fila, ficha o formulario). Si Storage la
rechaza, hay que permitir la ruta `tarifarios_firmados/` en las reglas.
