# V00347 — Nombres de convenio sin prefijo de NINGÚN tipo

## Archivos que cambian (respetar rutas)
- `src/features/conveniosDetalles/quitarPrefijoConv.ts`
- `src/config/historialCambios.ts` + `src/config/version.ts` + `public/version.json` — V00347.

## Qué pasaba
La limpieza de la V00346 quitó "CONV-", pero los nombres desnormalizados
que traían "CONV-285 - Cruce…" quedaron "285 - Cruce…" — con el número
suelto al frente (lo que viste en Servicios Completados).

## Qué cambia
El botón "🔤 Quitar CONV-" (Detalles del Convenio) ahora limpia los
NOMBRES por completo: quita CONV-/TARI-/TARP- **y** el número inicial
"### - " (aplicado repetidamente por si venían encadenados) en:
- Operaciones: convenio del cliente, del proveedor y tipo de convenio.
- Detalles de convenios (clientes y proveedores): descripción y nombre.
Los CONSECUTIVOS y números de convenio conservan su número (solo sin
CONV-), y ningún nombre se vacía. Es idempotente: puedes presionarlo
las veces que quieras.

## Al instalar
Reemplaza los archivos + versión, `npm run build`, publica y presiona
"🔤 Quitar CONV-" UNA vez más.

## Verificación
- `tsc --noEmit` ✓ · eslint 0 · `npm run build` ✓ · regex probada con
  los casos reales ("285 - Cruce de Importacion - Falso" → "Cruce de
  Importacion - Falso"; los nombres limpios no se tocan).
