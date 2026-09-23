# V00346 — Convenios SIN el prefijo CONV-

## Archivos que cambian (respetar rutas)
- `src/features/conveniosDetalles/consecutivos.ts`
- `src/features/conveniosDetalles/quitarPrefijoConv.ts` (NUEVO)
- `src/features/conveniosDetalles/components/DetallesConvenioDashboard.tsx` y `.css`
- `src/features/conveniosClientes/components/FormularioConvenioCliente.tsx`
- `src/features/tarifarioClientes/components/TarifarioClientesDashboard.tsx`
- `src/features/tarifarioProveedores/components/TarifarioProveedoresDashboard.tsx`
- `src/config/historialCambios.ts` + `src/config/version.ts` + `public/version.json` — V00346.

## 1) Los NUEVOS ya no llevan CONV-
Los consecutivos de detalles (clientes Y proveedores) y el número de los
convenios maestros nacen ahora solo con su número (646, 647, …),
continuando la MISMA serie — sin brincos ni repetidos (el contador
transaccional sigue igual). TARI-/TARP- de tarifarios no cambian.

## 2) Botón "🔤 Quitar CONV-" (Detalles del Convenio, junto a + Agregar)
Un clic recorre y limpia TODO lo registrado:
- Detalles de convenios de clientes y de proveedores (consecutivo).
- Convenios maestros de clientes y de proveedores (número).
- Operaciones: los nombres de convenio guardados ("CONV-080 - Cruce…"
  queda "080 - Cruce…").
Los números se conservan tal cual; solo desaparece el prefijo. Al
terminar te dice cuántos registros actualizó. Ejecútalo UNA vez tras
instalar.

## Verificación
- `tsc --noEmit` ✓ · eslint: todos los tocados en 0 salvo
  FormularioConvenioCliente 29 = su baseline exacto · `npm run build` ✓

## Al instalar
Reemplaza/añade los archivos + versión, `npm run build`, publica y
presiona "🔤 Quitar CONV-" una vez.
