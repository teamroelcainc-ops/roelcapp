# V00338 — Configuraciones del Excel GUARDADAS con nombre (Servicios Completados)

## Archivos que cambian (respetar rutas)
- `src/features/operaciones/components/ServiciosCompletados.tsx` y `.css`
- `src/config/historialCambios.ts` (entrada automática de esta versión)
- `src/config/version.ts` + `public/version.json` — V00338.

## El flujo nuevo (como lo pediste)
1) Presionas el botón de Excel → se abre PRIMERO el modal
   "📋 Configuraciones de exportación" con las guardadas: cada una con su
   nombre y # de columnas, botón **Usar** (arma el Excel con esa
   selección y orden) y 🗑 para borrarla.
2) Abajo, la pregunta "¿Quieres agregar una nueva configuración?" con el
   botón **➕ Nueva configuración** → abre el armado de columnas de
   siempre (marcar y arrastrar).
3) En el armado hay un campo de **NOMBRE** y el botón
   **💾 Guardar configuración**: guarda (o actualiza, si partiste de una
   guardada) esa selección y orden con su nombre.

Las configuraciones viven en la base (colección `config_export_excel`),
así que se comparten entre todos los usuarios y computadoras. Puedes
tener tantas como necesites (una por cliente, una semanal, etc.) y
también exportar sin guardar nada, como siempre.

## Verificación
- `tsc --noEmit` ✓ · eslint: 163 = baseline exacto ·
  `npm run build` completo ✓

## Al instalar
Reemplaza los archivos + versión, `npm run build` y publica.

## Siguiente (si lo quieres)
El mismo sistema puede replicarse en los otros Excel configurables
(Servicios Cancelados, Reportes, Facturación) — pídemelo y lo llevo ahí.
