# V00314 — Nombres de convenio SIN el CONV-### · Cliente (Paga) sin duplicados (solo con tarifario)

## Archivos que cambian (respetar rutas)
- `src/features/operaciones/components/FormularioOperacion.tsx`
- `src/features/conveniosDetalles/components/DetallesConvenioDashboard.tsx`
- `src/features/tarifarioClientes/components/TarifarioClientesDashboard.tsx`
- `src/features/tarifarioProveedores/components/TarifarioProveedoresDashboard.tsx`
- `src/config/version.ts` + `public/version.json` — V00314.

## 1) El nombre del convenio va SOLO con el nombre
El consecutivo CONV-### tiene su propia columna/campo; ya no se antepone:
- **Formulario de operaciones**: el campo Convenio (Tarifa) muestra
  "Movimiento Nuevo Laredo - Vacio - $85.00" (sin el CONV-077). Aplica a
  cliente y proveedor; las descripciones viejas guardadas con prefijo se
  limpian al mostrarse.
- **Detalle del Convenio (Clientes y Proveedores)**: la Descripción
  (automática) del alta/edición se arma como TARIFA + Origen + Destino,
  sin el CONV; el sincronizador de nombres LIMPIA los detalles y las
  operaciones ya guardadas al correrlo.
- **Tarifario de Clientes y Proveedores**: la descripción automática del
  editor de línea muestra solo el nombre (el CONV sigue visible en el
  subtítulo del modal).

## 2) Cliente (Paga): solo clientes con registros en el Tarifario
El buscador ya ofrecía clientes "con tarifario", pero el respaldo por
NOMBRE dejaba pasar empresas duplicadas homónimas (dos "Caro-Kar"). Ahora:
- Se ofrecen los clientes cuyo ID tiene registros en el Tarifario de
  Clientes.
- Si hay empresas con el MISMO nombre, solo se muestra la que tiene el
  tarifario (la homónima sin tarifario ya no aparece).
- El respaldo por nombre queda únicamente para tarifarios viejos que
  referencian por nombre y sin ninguna homónima con ID — y el cliente ya
  guardado en una operación siempre se ofrece al editarla.

## Verificación
- `tsc --noEmit` ✓ · eslint: FormularioOperacion 377 = su baseline exacto;
  Convenios y ambos tarifarios en 0 · `npm run build` completo ✓

## Al instalar
Reemplaza los 4 archivos + versión, `npm run build` y publica. Para
limpiar los nombres YA guardados con "CONV-###" corre el sincronizador de
nombres del Detalle del Convenio una vez en cada lado.
