# V00256 — Servicios Completados: filtros por Expo/Impo, Cargada/Vacía y Aduana

## Archivos que cambian (respetar rutas)
- `src/features/operaciones/components/ServiciosCompletados.tsx`
- `src/config/version.ts` y `public/version.json` — bump a V00256.

## Qué hace
En el panel de Filtros (botón "Filtros") hay TRES selectores nuevos, debajo
del de Tipo de Operación:
- EXPO / IMPO: Exportación · Importación · Movimiento.
- CARGADA / VACÍA: opciones del catálogo C/V (Hazmat, Trompo, Cargado,
  Vacio, Falso, etc.), ordenadas alfabéticamente.
- ADUANA: opciones del catálogo Aduanas (240 Nuevo Laredo, 800 Colombia).

Se aplican con BUSCAR, igual que los demás; y como el Excel exporta la
tabla ya filtrada, LA DESCARGA RESPETA LOS TRES FILTROS automáticamente.
También entran al contador del botón Filtros, a los chips del resumen, al
filtro recordado por usuario (localStorage) y al log de búsquedas.

## Cómo decide cada filtro (importante por los datos migrados)
- C/V y Aduana usan el campo directo de la operación si existe y, si falta
  (o dice "N/A"), se DERIVAN del nombre del convenio
  ("Tipo de Operación - Tipo de Remolque - C/V - Aduana") comparando sus
  segmentos contra el catálogo — la misma técnica del V00255 en
  Estadísticas, así los conteos de aquí y de Estadísticas coinciden.
- Expo/Impo busca export/import/movimiento en el tráfico, el nombre del
  convenio o el tipo de operación.

## Verificación
- `tsc --noEmit`: 0 errores.
- ESLint: 163 problemas (el original traía 164 — uno menos, ninguno nuevo).
- Sin inline styles nuevos (38, igual que quedó en V00254).
- `npm run build`: OK (PWA generada).

## Nota
Servicios Cancelados tiene un panel de filtros gemelo — si también lo
quieres con estos tres filtros, me dices y lo replico.
