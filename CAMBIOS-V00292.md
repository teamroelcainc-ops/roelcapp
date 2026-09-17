# V00292 — Reporte de Vencimiento: filtro de 45 días, edición en tabla y por registro, y reubicación con búsqueda + alta rápida

## Archivos que cambian (respetar rutas)
- `src/features/vencimientos/ReporteVencimientosDashboard.tsx` y `.css`
- `src/config/version.ts` y `public/version.json` — bump a V00292.

## 1) De inicio, solo lo urgente
La pestaña "Vencidos y por vencer" abre mostrando SOLO los vencidos y los
que vencen en **45 días o menos**. Junto al filtro de origen hay un select
nuevo: 45 días o menos (default) · 60 días o menos · **Más de 60 días** ·
Todos. Los vencidos siempre se muestran, salvo en "Más de 60".

## 2) Botón ✎ para editar el registro
En LAS TRES pestañas, cada fila trae ✎ que abre el editor del registro:
tipo de archivo (con su relación del catálogo), ¿vence?, expedición y
vencimiento — Guardar cambios escribe todo junto en su tabla real
(`documentos`), y al elegir un tipo el "vence" se ajusta al del catálogo.

## 3-5) Edición directa EN LA TABLA, en todas las pestañas
- Pestaña 1: el TIPO es un select del catálogo y Expedición/Vencimiento
  son fechas editables — guardan al cambiar.
- Pestaña 2: además de las fechas (que ya se editaban), ahora el TIPO
  también se edita en la fila.
Todo guarda en `documentos/{id}` respetando la relación: elegir un tipo
escribe tipoDocumento + subcarpeta + vence según `catalogo_tipo_archivo`
(el documento queda en su carpeta correcta del dueño).

## 6) Reubicar con BÚSQUEDA y "+" de alta rápida
En "Documentos sin clasificar" el campo ya no es desplegable: escribes y
filtra (como Origen/Destino); al elegir, reubica al instante. Y el botón
**+** (como el de Cliente Mercancía) crea un tipo nuevo: pide el nombre,
pregunta si vence, lo GUARDA en `catalogo_tipo_archivo` (disponible para
todos y para los formularios de subida) y reubica el documento ahí mismo.

## Verificación
- `tsc --noEmit`: 0 errores. ESLint: 11 — idéntico a su base.
- `npm run build`: OK (PWA generada).
