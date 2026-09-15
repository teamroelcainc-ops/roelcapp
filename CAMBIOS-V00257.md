# V00257 — Botón "⇊ Normalizar operaciones": escribe C/V, Aduana y Expo/Impo en la base

## Archivos que cambian (respetar rutas)
- `src/features/catalogos/components/CatalogosDashboard.tsx`
- `src/features/operaciones/components/ServiciosCompletados.tsx` (ajuste de normalización)
- `src/config/version.ts` y `public/version.json` — bump a V00257.

## Qué hace
En Catálogos → Tarifas de Referencia hay un botón nuevo junto a
"⟳ Rearmar descripciones": **"⇊ Normalizar operaciones"**. Al presionarlo
(con confirmación) recorre TODAS las operaciones y escribe EN LA BASE,
solo donde falte o difiera del catálogo:
- `carga` — la Cargada/Vacía con el NOMBRE EXACTO del catálogo C/V
  (Cargado, Vacio, Hazmat, Trompo, Falso…), tomada del campo directo si es
  válido o derivada del convenio guardado.
- `aduanaNombre` — la Aduana del catálogo (240 Nuevo Laredo, 800 Colombia),
  derivada igual.
- `trafico` — Exportación / Importación / Movimiento, SOLO si la operación
  no trae uno válido (nunca se sobreescribe un tráfico ya capturado).
No toca montos, fechas ni referencias. Escribe en lotes de 400 y al final
muestra el resumen de cuántas actualizó, y lo deja en el Historial.

## Detalles que salieron de TU Excel (7,546 filas)
- 6,316 convenios traen "240  Nuevo Laredo" con DOBLE espacio → la
  normalización ahora colapsa espacios (también en los filtros del V00256,
  para que el filtro Aduana los encuentre).
- Descripciones viejas dicen "Cargada"/"Vacia" en femenino → alias al
  nombre del catálogo (Cargado / Vacio).
- Resultado esperado al correrlo: C/V escrita en ~7,503 operaciones y
  Aduana en ~6,851; las ~43 sin C/V y ~695 sin aduana son Rentas, Multas,
  Demoras y Consolidados que no llevan — se quedan como están.

## Después de correrlo
Los filtros de Servicios Completados y las Estadísticas leerán el campo
directo (ya guardado y alineado al catálogo) y la derivación del convenio
queda solo como respaldo para operaciones futuras con datos incompletos.

## Verificación
- `tsc --noEmit`: 0 errores. ESLint: mismos conteos (113 y 163), ninguno nuevo.
- `npm run build`: OK (PWA generada).
