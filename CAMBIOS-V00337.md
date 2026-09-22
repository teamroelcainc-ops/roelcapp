# V00337 — Reportes: "Todos EXCEPTO…" · minimizado de operación con su información

## Archivos que cambian (respetar rutas)
- `src/features/reportes/components/ReportesDashboard.tsx` y `.css`
- `src/features/operaciones/components/FormularioOperacion.tsx` y `.css`
- `src/config/historialCambios.ts` (entrada automática de esta versión)
- `src/config/version.ts` + `public/version.json` — V00337.

## 1) Estatus a incluir: "Todos EXCEPTO los marcados…"
En Reportes, el selector de estatus tiene la nueva opción "Todos EXCEPTO
los marcados…": al elegirla aparece la lista de estatus del catálogo con
casillas — marcas los que NO quieres (quedan en rojo tachado, con
contador y botón Limpiar) y el reporte incluye todo lo demás. Funciona
con la tabla, los resúmenes, el Excel y el PDF, como los filtros de
siempre.

## 2) La operación minimizada muestra su información
Al minimizar una operación, la pastilla ya no dice solo "Editar" o
"Nueva Operación": muestra la REFERENCIA (si ya la tiene) y debajo, en
una línea, el CLIENTE, el # DE REMOLQUE, la FECHA DE SERVICIO y el TIPO
DE OPERACIÓN — lo que ya esté capturado o guardado. Así, con varias
operaciones minimizadas sabes cuál es cuál sin abrirlas.

## Verificación
- `tsc --noEmit` ✓ · eslint: Reportes 69 = baseline exacto, Formulario
  de Operación 377 = baseline exacto · `npm run build` completo ✓

## Al instalar
Reemplaza los archivos + versión, `npm run build` y publica.
