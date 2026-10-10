# V00438 — Fase 2: menos re-renders y listeners solo en lo que se ve

Sin pasos en producción: es solo la web. Ningún cambio de datos.

## Qué se siente
- **Escribir en el buscador superior ya no congela la pantalla**: el texto vive en su propio componente
  (`src/components/layout/BuscadorTopbar.tsx`). Antes cada tecla re-renderizaba App y los 12 módulos que MantenerVivo
  deja montados.
- **Los módulos ocultos ya no escuchan la base**: Operaciones (con sus tarjetas), Completados, Mis Operaciones,
  Facturación Clientes/Proveedores, Empresas, Catálogos, Tarifarios y Convenios cierran sus listeners mientras no se
  ven y los reabren al volver (sin parpadeo, conservando filtros, página y selección). Al volver antes de 30 min
  Firestore solo cobra lo que cambió.
- **Pasar el mouse por las filas** de Operaciones, Completados y Cancelados ya no re-renderiza todo el módulo
  (`:hover` en CSS).
- **Facturación**: el efecto que volvía a consultar operaciones en CADA render ahora consulta cada id una sola vez;
  ordenar 20 mil operaciones calcula las llaves una vez; la búsqueda usa `useDeferredValue`. Se dejaron de copiar
  operaciones y facturas a localStorage (se libera el espacio que ocupaban).
- **Estadísticas**: un clic en una celda ya no vuelve a leer todas las facturas y pagos; la tabla de detalle pinta de
  100 en 100 ("Mostrar más"); los totales y los Excel/PDF siguen usando todas las filas.
- **Formulario de operación**: va en `memo` (sus padres le pasan handlers estables); la vista previa del estatus lee el
  flujo UNA vez por formulario abierto (antes en cada pausa al teclear); el tipo de cambio de la fecha es una
  consulta de 1 documento (antes probaba ~10 colecciones y bajaba una completa).
- **Resumen del día**: el tipo de cambio sale con 1–2 lecturas (antes, la colección completa); se recarga solo a la
  medianoche.
- **Navegar** entre módulos mantiene la pantalla actual mientras carga el código del nuevo (indicador junto a ☰) y
  la primera carga de un módulo ya no tapa a los demás.
- Ya no aparece un instante "Sin módulos asignados" al entrar.
- **Versión nueva con un formulario abierto**: la app ya no se recarga a media captura ni a medio guardado (incluidas
  las subidas de documentos); muestra un aviso y se actualiza sola al cerrar el formulario.
- Catálogos: abrir un catálogo ya no borra la caché de catálogos de toda la app (solo cuando sus datos cambian de verdad).

## Archivos nuevos
`src/shared/hooks/useSnapshotSoloVisible.ts` (+ prueba), `src/shared/utils/edicionesAbiertas.ts`,
`src/components/layout/BuscadorTopbar.tsx`, `src/components/layout/CargandoModulo.tsx`,
`src/components/AvisoRecargaPendiente.tsx/.css`, `src/features/operaciones/hooks/useHandlerEstable.ts`,
`src/features/operaciones/services/tipoCambioPorFecha.ts`.

## A tener en cuenta
- Al recargar la página, Facturación ya no pinta desde la copia de localStorage: lee de Firestore. Con 20 mil
  operaciones esa copia casi nunca cabía (~5 MB), pero la de facturas sí podía: hasta la Fase 7 (consultas acotadas)
  una recarga de Facturación puede costar más lecturas que antes.
- La sincronización automática de "Baja" de Empresas (90 días) ahora corre solo mientras el módulo está a la vista.

## Verificación
- `tsc -b` ✔ · trinquete ESLint ✔ (any 2,834 → 2,817) · vitest 61 ✔ · build ✔.
- Revisión independiente: 6 hallazgos (recarga a medio guardado, flujo en caché vieja para la vista previa, "hoy"
  congelado en el resumen, aviso sin módulos sin perfil, indicador de navegación, aviso de recarga) — corregidos.
- **No probado en navegador**: listeners que se cierran/reabren, hover, memo del formulario, aviso de recarga.
