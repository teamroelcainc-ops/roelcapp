# V00334 — 🔍 Auditoría por EMPRESA: operaciones, facturación y pagos según su papel

## Archivos que cambian (respetar rutas)
- `src/features/empresas/components/AuditoriaCadenaEmpresa.tsx` y `.css` — **NUEVOS**
- `src/features/empresas/components/EmpresasDashboard.tsx`
- `src/config/historialCambios.ts` (entrada automática de esta versión)
- `src/config/version.ts` + `public/version.json` — V00334.

## Qué hace
En Bases de Datos → Empresas, cada fila trae el botón 🔍 que abre la
AUDITORÍA DE LA EMPRESA, con una pestaña por PAPEL (con su conteo):

- **Cliente (Paga)** — sus operaciones como quien paga, su facturación
  de cliente y los pagos recibidos, cruzados en tres columnas.
- **Cliente (Mercancía)** — las operaciones donde la empresa es dueña de
  la mercancía (la facturación y los pagos corresponden al cliente que
  paga, y así se indica).
- **Proveedor (transporte y servicios)** — las operaciones donde pone la
  unidad/servicio, las facturas de proveedor y los pagos que se le han
  hecho.

Todo EN VIVO (se suscribe a operaciones, facturas de ambos lados y pagos
de ambos lados — incluye los pagos guardados con el formato viejo), con
👁 detalle por tarjeta y los montos con su moneda.

(Nota: el número V00333 quedó saltado; esta entrega es la V00334.)

## Verificación
- `tsc --noEmit` ✓ · eslint: componente nuevo en 0; EmpresasDashboard
  71 = su baseline exacto · `npm run build` completo ✓

## Al instalar
Copia los 2 archivos NUEVOS, reemplaza EmpresasDashboard + historial +
versión, `npm run build` y publica.
