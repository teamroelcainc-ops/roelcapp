# V00259 — Por qué "no hacía nada" + conteo de operaciones por rubro C/V

## Archivos que cambian (respetar rutas)
- `src/utils/cacheMemoria.ts`
- `src/features/catalogos/components/CatalogosDashboard.tsx` y `.css`
- `src/config/version.ts` y `public/version.json` — bump a V00259.

## 1) El "sigue sin actualizar" — la causa era el CACHÉ
Servicios Completados (y los demás módulos de operaciones) guardan las
operaciones en cachés de memoria y de sesión para responder rápido. La
normalización SÍ escribía en Firebase, pero la pantalla seguía leyendo el
caché viejo — por eso parecía que "no hacía nada".
- Ahora, al terminar "⇊ Normalizar operaciones", se BARREN todos los cachés
  de operaciones (roelca_*) automáticamente.
- El resumen final ahora también dice cuántas "ya estaban correctas" (si
  corres la utilidad dos veces, la segunda dirá 0 actualizadas y todas
  correctas — eso es lo esperado, no un fallo).
- PASOS: publica V00259 → corre "⇊ Normalizar operaciones" UNA vez → en
  Servicios Completados presiona BUSCAR → abre TR-020126-12: debe decir
  Hazmat. (La corrida que hiciste antes pudo ser con la regla vieja del
  V00257, que respetaba lo capturado; la regla "el convenio manda" entró
  en V00258.)

## 2) El botón "⇊ Normalizar operaciones" también está en el catálogo C/V
Como pediste, aparece tanto en Tarifas de Referencia como en
C/V (Cargada / Vacía).

## 3) Catálogo C/V: operaciones por rubro + referencias
- Columna nueva "OPERACIONES" en el catálogo C/V: junto a cada rubro se ve
  cuántas operaciones lo tienen (p. ej. "5,352 operación(es)" en Cargado,
  "485" en Hazmat). El conteo usa AGREGACIÓN del servidor (solo números,
  sin descargar documentos) sobre el campo guardado, con caché de 5 min.
- Al hacer clic en el número se abre el detalle: "486 operación(es) — 
  Cargado" con la LISTA DE REFERENCIAS ligadas (referencia, fecha, cliente),
  de la más reciente a la más antigua, en páginas de 500 con "Cargar más".
- BONUS de verificación: esos números te dicen si la base ya quedó bien.
  Antes de normalizar verás números bajos (Hazmat ~38); después de correr
  la utilidad deben parecerse a los del Excel (Cargado ~5,352, Vacio ~1,279,
  Hazmat ~485, Trompo ~209, Falso ~178).

## Verificación
- `tsc --noEmit`: 0 errores. ESLint: 113 (idéntico al original).
- Inline styles: 76, igual que el original (el modal usa clases CSS).
- `npm run build`: OK (PWA generada).
