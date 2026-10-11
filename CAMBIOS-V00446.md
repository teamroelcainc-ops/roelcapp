# V00446 — La app vuelve a ser rápida: menos repintados, catálogos abiertos toda la sesión, sin esperas al servidor

**Solo web. Sin banderas ni pasos en producción.** No cambia lo que se ve.

## Por qué se puso lenta (medido)
Con `npm run medir:render` (nuevo) se montaron los módulos pesados con catálogos de tamaño real, en la V00435 y en la
V00445. Repintados del módulo al abrirlo:

| Módulo | V00435 | V00445 | V00446 |
|---|---|---|---|
| Operaciones Activas | (se rompía en desarrollo) | 7 | 4–6 |
| Servicios Completados | 8 | 14 | 4 |
| Facturación Clientes | 4 | 16 | 4 |
| Empresas | 2 | 11 | 3 |

Causas (todas de los catálogos compartidos de la V00439 y los listeners de la V00438):
1. Cada catálogo que llegaba (y otra vez cuando el servidor lo confirmaba) repintaba el módulo COMPLETO, de forma
   síncrona. Con tablas grandes eso son segundos al abrir un módulo.
2. Los módulos ocultos se repintaban cada vez que alguien cambiaba un catálogo.
3. Al volver a un módulo se cerraban y reabrían sus listeners (volver = cargar y repintar todo otra vez).
4. `obtenerCatalogo` esperaba la confirmación del servidor (hasta 6 s) en cada acción con el listener frío: abrir
   una operación desde Convenios, el Resumen del día, Reportes, el cobro del puente, los botones de status.
5. Los catálogos se cerraban a los 15 min sin uso y al reabrirlos se bajaba la colección completa otra vez.

## Qué cambia
- **Avisos agrupados** (`coleccionesVivas.ts`): los catálogos que llegan en la misma ventana de 50 ms producen UN
  repintado; la confirmación del servidor sin cambios ya no repinta.
- **Módulo oculto = no se repinta**: deja de recibir avisos de catálogos y al volver toma el estado más reciente.
- **Catálogos abiertos toda la sesión** (se cierran al cerrar sesión). Abiertos solo cobran lo que cambia.
- **`obtenerCatalogo` sin esperas**: devuelve en cuanto hay datos (caché local o servidor). `{ fresco: true }` espera
  al servidor, y se usa solo donde se ESCRIBE decidiendo con el catálogo: integridad de convenios, sincronizar
  nombres, quitar prefijo de convenios, migración de status, reparaciones de Catálogos y el cobro del puente.
- **Escucha con gracia**: un módulo oculto sigue escuchando 10 min (`useModuloEscuchando`, MantenerVivo). Ir y volver
  pronto ya no cierra y reabre sus listeners. Pasado ese tiempo se cierran (como en la V00438).
- **Índices de la caché local de Firestore** (`enablePersistentCacheIndexAutoCreation`): las consultas con filtro
  servidas desde la caché del navegador ya no recorren toda la colección guardada. No toca el servidor.
- `npm run medir:render` (`src/__pruebas__/rendimiento.medicion.tsx`): la medición de arriba, para comparar antes y
  después de un cambio. No corre con `npm test`.

## Verificación
- `tsc -b` ✔ · trinquete ESLint ✔ · trinquete de consultas ✔ · vitest 21 archivos / 252 ✔ (catálogos: avisos agrupados,
  confirmación sin repintado, oculto sin repintado, permanencia de sesión, obtenerCatalogo rápido y fresco; gracia de
  MantenerVivo) · prueba de humo de 31 módulos con banderas apagadas y encendidas ✔ · `npm run build` ✔.
- **No probado aquí**: navegador con datos reales. Para confirmarlo: abrir y alternar Operaciones, Completados,
  Facturación y Empresas; con React DevTools → Profiler se ve el número de "commits" por acción.
- Si la app se usa en DOS pestañas a la vez, la segunda no tiene caché en disco (`persistentSingleTabManager`): allí todo
  viene del servidor y es más lento. Pendiente: pasar a `persistentMultipleTabManager` cuando Completados deje de
  copiar operaciones a localStorage (al encender `consultasCanonicas` y retirar el camino viejo, P4).
