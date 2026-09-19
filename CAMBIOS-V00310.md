# V00310 — Servicios Completados: búsquedas de minutos a segundos (⚡), tarjetas parejas y scroll siempre visible

## Archivos que cambian (respetar rutas)
- `src/features/operaciones/components/ServiciosCompletados.tsx` y `.css`
- `src/config/version.ts` y `public/version.json` — bump a V00310.

## 1 y 4) La CAUSA de la demora (Buscar y "Ver en nueva pestaña")
Cada primera búsqueda de la sesión descargaba TODO el histórico de
completados (~7,500 operaciones, paginadas por bloques) aunque el rango
fuera de dos semanas — porque las operaciones MIGRADAS guardan la fecha
como d/m/aaaa y la consulta por rango de Firestore no las encuentra.
Además ese dataset es tan grande que el caché entre pestañas falla por
cuota: la pestaña nueva volvía a descargar todo.

### El arreglo: botón "⚡" (junto a Actualizar; pulsa en ámbar hasta correrlo)
Se presiona UNA sola vez: escribe la fecha normalizada
(`fechaServicioISO`, aaaa-mm-dd) en todas las operaciones — por lotes de
400, solo donde falte o difiera, sin tocar montos ni la fecha original;
es idempotente (segunda corrida: 0 escrituras). Desde entonces:
- **Buscar consulta SOLO el rango pedido** (dos consultas por rango:
  `fechaServicio` para las nuevas + `fechaServicioISO` para las
  migradas, unidas y filtradas a los 2 status completados) — de miles de
  documentos a decenas, de minutos a segundos, en todas las pestañas y
  dispositivos.
- **"Ver en nueva pestaña" abre al instante**: el resultado por rango es
  chico, sí cabe en el caché compartido (localStorage) y la pestaña
  nueva pinta sin re-descargar (caché por rango, 5 min).
- "Actualizar" limpia también el caché del rango y fuerza lectura fresca.
- Si la ruta rápida fallara por cualquier motivo, cae sola a la descarga
  completa de siempre (nunca te quedas sin datos).

## 3) Tarjetas mejor organizadas
Las 9 tarjetas del resumen ahora forman UNA cuadrícula pareja: mismo
ancho, mismo espacio, sin filas desiguales (antes eran dos filas con
tamaños distintos). Siguen siendo clicables como filtros.

## 2) Scroll horizontal siempre visible
La barra del marco de la tabla ahora es PERMANENTE y estilizada (también
en Chrome/Edge de macOS, donde el sistema la oculta; delgada y visible
en Firefox). El encabezado ya quedaba fijo al bajar y sigue igual.

## Verificación
- `npx tsc --noEmit -p tsconfig.app.json` ✓
- eslint: mismos 163 problemas PREEXISTENTES del archivo (0 nuevos)
- `npm run build` completo ✓

## Al instalar
1. Reemplaza los archivos y publica (sin cambios en Functions ni reglas).
2. En Servicios Completados presiona **⚡** una vez y espera el resumen
   (indexará ~7,500 operaciones; puede tardar un par de minutos ESA vez).
3. Busca tu rango: debe responder en segundos; luego "↗ Ver en nueva
   pestaña" debe abrir con los datos casi al instante.
