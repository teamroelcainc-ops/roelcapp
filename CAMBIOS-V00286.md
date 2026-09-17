# V00286 — Formulario de tarifa estilo "Agregar convenio" con ⚙ de campos obligatorios compartidos

## Archivos que cambian (respetar rutas)
- `src/utils/camposObligatoriosTarifa.ts` — NUEVO (configuración compartida)
- `src/features/tarifarioClientes/components/TarifarioClientesDashboard.tsx` y `.css`
- `src/features/tarifarioProveedores/components/TarifarioProveedoresDashboard.tsx` y `.css`
- `src/config/version.ts` y `public/version.json` — bump a V00286.

## El formulario de Agregar/Editar tarifa (ficha del tarifario)
Rediseñado con el mismo formato de "Agregar convenio", en clientes y
proveedores:
- **# de tarifario** (fijo: TARI-### - razón social)
- **Tarifa (catálogo)** — al elegirla precarga Origen y Destino
- **Origen** y **Destino** (editables; se guardan en la línea)
- **Descripción (automática)** — CONV-### + descripción de la tarifa
  ("CONV-### (al guardar)" cuando es nueva)
- **Costo de la Tarifa** · **Cotizado En** (siempre obligatoria) · **Status**
Con "¿Seguro que quieres salir?" en Cancelar, ✕ y clic fuera, y el botón
verde "Guardar cambios".

## ⚙ Campos obligatorios — configuración PARA TODOS los usuarios
El engrane del encabezado abre el panel de configuración: se marca qué
campos son obligatorios (Tarifa, Origen, Destino, Costo, Status) y se
guarda en Firestore (`configuracion/obligatorios_formulario_tarifa`), así
que **la configuración es la misma para todos los usuarios**: quien la
cambie, la cambia para todos, y los asteriscos (*) del formulario se
pintan según lo configurado. "Cotizado En" es obligatoria SIEMPRE (regla
de negocio, no se puede desactivar). Al guardar, si falta un obligatorio,
el aviso lista exactamente cuáles. Queda registro en el Historial de quién
cambió la configuración.

## Verificación
- `tsc --noEmit`: 0 errores. ESLint: TarifarioClientes 0,
  TarifarioProveedores 0, camposObligatoriosTarifa 0. `style={{`: 0.
- `npm run build`: OK (PWA generada).
