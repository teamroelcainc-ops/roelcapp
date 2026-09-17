# V00273 — Tarifario firmado obligatorio para aprobar (clientes y proveedores)

## Archivos que cambian (respetar rutas)
- `src/features/tarifarioClientes/components/TarifarioClientesDashboard.tsx` y `.css`
- `src/features/tarifarioProveedores/components/TarifarioProveedoresDashboard.tsx`
- `src/config/version.ts` y `public/version.json` — bump a V00273.

## 1) Regla nueva: sin documento firmado NO hay aprobación
Al intentar aprobar un tarifario (el select de status → Aprobado) sin su
documento, la app lo detiene y ofrece subirlo en ese momento: eliges el
archivo (PDF o imagen del tarifario escaneado y firmado), se sube a
Firebase Storage (`tarifarios_firmados/…`), se guarda en el tarifario
(docFirmadoUrl / docFirmadoNombre / docFirmadoFecha — relación 1:1) y la
APROBACIÓN CONTINÚA SOLA. Si cancelas la subida, el tarifario se queda
como estaba.

## 2) Icono al inicio de cada fila
Junto a las acciones, cada tarifario muestra su indicador:
- ⚠ (ámbar, pulsante) — APROBADO SIN el documento firmado (todos los
  aprobados de antes se quedan aprobados, pero marcados así). Clic = subir.
- 📎 — pendiente/otro status sin documento. Clic = subir (adelantas el
  requisito antes de aprobar).
- 📄 (borde verde) — documento subido. Clic = verlo en otra pestaña;
  Ctrl+clic = reemplazarlo.
- ⏳ mientras sube.
Todo queda en el log del módulo.

## 3) Ambos lados
Idéntico en Tarifario Clientes y Tarifario Proveedores (el de proveedores
reutiliza las clases tc-* como ya lo hace con el resto de su CSS).

## Verificación
- `tsc --noEmit`: 0 errores. ESLint: AMBOS dashboards en 0 problemas.
- Sin estilos inline (indicador con clases y animación en CSS).
- `npm run build`: OK (PWA generada).

## Nota
Para saber cuántos aprobados siguen sin documento, filtra visualmente por
los ⚠ — si quieres, en la próxima les agrego un contador/filtro "Sin
documento" en la barra.
