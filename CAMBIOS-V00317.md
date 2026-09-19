# V00317 — Botón para reparar nombres con # de convenio · Excel combinado (operaciones + facturación + pagos) por cliente

## Archivos que cambian (respetar rutas)
- `src/features/conveniosDetalles/components/DetallesConvenioDashboard.tsx`
- `src/features/empresas/components/EmpresasDashboard.tsx` y `.css`
- `src/config/version.ts` + `public/version.json` — V00317.

## 1) "🧽 Reparar nombres (quitar # CONV)" — en Detalle del Convenio
El botón de rearmar nombres ahora REPARA los que aún traen el consecutivo
incrustado ("CONV-077 - Movimiento…"). En un solo clic, por lado
(Clientes o Proveedores):
- Limpia el NOMBRE del detalle (tipoConvenioNombre) y recalcula su
  descripción como TARIFA + Origen + Destino, sin el CONV.
- Limpia las LÍNEAS del tarifario (tarifas[].descripcion) que traían el
  prefijo.
- Actualiza el nombre guardado en TODAS las operaciones.
Al terminar reporta cuántos convenios, tarifarios y operaciones tocó.
Quita el prefijo aunque venga repetido ("CONV-077 - CONV-077 - …").

## 2) Excel combinado por cliente — ficha de la empresa → pestaña Referencias
Botón verde "⬇ Excel (ops + facturación + pagos)": descarga UN solo
archivo con tres hojas para esa empresa:
- **Operaciones**: referencia, fecha de servicio, tipo, convenio, status,
  papel de la empresa (paga, mercancía, proveedor…), monto cliente y
  monto proveedor.
- **Facturación**: invoice, como (cliente/proveedor), fecha, total,
  moneda, status y # de operaciones que ampara.
- **Pagos**: # de pago, fecha, método, monto, moneda y # de facturas.
El archivo se llama "«Empresa» - operaciones, facturacion y pagos.xlsx".
El botón se habilita cuando las referencias terminan de cargar.

## Verificación
- `tsc --noEmit` ✓ · eslint: Convenios 0; Empresas 71 = su baseline ·
  `npm run build` completo ✓

## Al instalar
Reemplaza los 3 archivos + versión, `npm run build` y publica. Después,
corre "🧽 Reparar nombres" una vez en Convenio de Clientes y una vez en
Convenio de Proveedores para limpiar todo lo guardado.
