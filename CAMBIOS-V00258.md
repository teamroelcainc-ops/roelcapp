# V00258 — EL CONVENIO MANDA: C/V y Aduana de la operación = los del convenio

## Archivos que cambian (respetar rutas)
- `src/features/catalogos/components/CatalogosDashboard.tsx` (utilidad ⇊)
- `src/features/operaciones/components/FormularioOperacion.tsx`
- `src/features/operaciones/components/ServiciosCompletados.tsx`
- `src/features/estadisticas/components/EstadisticasOperativas.tsx`
- `src/features/estadisticas/components/EstadisticasDashboard.tsx`
- `src/config/version.ts` y `public/version.json` — bump a V00258.

## La regla nueva (caso reportado: convenio Hazmat, carga "Cargado")
EL CONVENIO MANDA. Si la descripción del convenio trae un C/V del catálogo
("… - Hazmat - …"), ese es el correcto y sobreescribe lo capturado en la
operación. El campo capturado solo cuenta cuando el convenio no trae ese
dato (Rentas, Multas, Demoras, Consolidados). Igual para la Aduana. El
tráfico capturado nunca se sobreescribe si ya es válido.

## Dónde aplica
1. **Botón "⇊ Normalizar operaciones"** (Catálogos → Tarifas de Referencia):
   ahora corrige con esta regla — al correrlo, TODAS las operaciones cuyo
   convenio diga Hazmat quedarán con carga = "Hazmat" en la base, aunque
   trajeran "Cargado". Esperado con tus datos: C/V del convenio en 7,503
   de 7,546; las 43 sin C/V en el convenio conservan lo capturado.
2. **Formulario de Operaciones**: al elegir o cambiar convenio, el campo
   Cargada/Vacía se llena con el C/V de la tarifa RESUELTO al nombre exacto
   del catálogo (antes podía copiar un ID o un valor desalineado). Así las
   operaciones nuevas ya nacen correctas.
3. **Filtros de Servicios Completados y Estadísticas**: leen primero el
   C/V del convenio; el campo guardado queda de respaldo. Así la vista es
   correcta incluso ANTES de correr la utilidad.

## Pasos sugeridos al instalar
1. Publica la versión. 2. Entra a Catálogos → Tarifas de Referencia y corre
"⇊ Normalizar operaciones" UNA vez. 3. Abre la operación TR-020126-12: el
campo Cargada/Vacía debe decir "Hazmat".

## Verificación
- `tsc --noEmit`: 0 errores. ESLint: conteos idénticos en los 5 archivos
  (113, 163, 385, 5, 32) — ninguno nuevo.
- `npm run build`: OK (PWA generada).
