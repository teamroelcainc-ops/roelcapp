# V00331 — La autorización SOLO se aplica a los campos que tú tocas

## Archivos que cambian (respetar rutas)
- `src/features/empresas/components/FormularioEmpresa.tsx`
- `src/config/historialCambios.ts` (entrada automática de esta versión)
- `src/config/version.ts` + `public/version.json` — V00331.

## El problema que corrige
Con reglas de Autorizaciones activas, el formulario de Empresas seguía
molestando: la verificación al guardar se basaba en comparar el
formulario completo contra una "foto" inicial, y los recálculos internos
del propio formulario (catálogos que llegan, normalizaciones de moneda,
régimen fiscal, tipos) hacían parecer "modificados" campos que nadie
tocó — y el guardado pedía autorización o fallaba.

## La corrección — determinista
- El formulario ahora RASTREA exactamente qué campos tocó el USUARIO
  (escribir en un input, cambiar un select, elegir régimen, marcar tipos,
  cambiar crédito/contado, días o límite).
- Al guardar, a la verificación de Autorizaciones van SOLO esos campos
  tocados — y de ellos, solo los que de verdad quedaron con un valor
  distinto al inicial (si lo regresaste a como estaba, no cuenta).
- Lo que el formulario recalcula por su cuenta JAMÁS dispara
  autorización. Modificar o usar campos sin regla no se ve afectado en
  absoluto.
- De paso se corrigieron las traducciones internas de nombres: RFC,
  Crédito/Contado y Régimen Fiscal ahora se identifican correctamente
  ante Autorizaciones (antes había desfases de nombre).

## Verificación
- `tsc --noEmit` ✓ · eslint del formulario: 21 = baseline exacto ·
  `npm run build` completo ✓

## Al instalar
Reemplaza los 2 archivos + versión, `npm run build` y publica.
