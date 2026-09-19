# V00316 — Fin de los módulos "desordenados" al recargar o entrar (auto-reparación de chunks)

## Archivos que cambian (respetar rutas)
- `src/main.tsx`
- `src/config/version.ts` + `public/version.json` — V00316.

## La causa del desorden
Cada módulo de la app carga BAJO DEMANDA como un "chunk" (su JS + su CSS,
con un hash en el nombre). Al publicar una versión nueva mientras la app
está abierta (y publicas varias al día), la pestaña vieja pide chunks con
hash VIEJO que ya no existen: si falla el CSS del módulo, el módulo se
pinta solo con los estilos globales — botones fuera de lugar, marcos
raros, tabla descuadrada — exactamente lo de la captura del Directorio de
Empleados. La recarga automática de V00284 (controllerchange) cubre el
cambio de Service Worker, pero NO a la pestaña que ya quedó con HTML
viejo en memoria.

## El arreglo
Vite emite el evento oficial `vite:preloadError` cuando la carga de un
módulo (o su CSS) falla. Ahora la app lo escucha y SE RECARGA SOLA una
única vez para tomar la versión completa:
- Candado anti-bucle en sessionStorage (si la recarga no lo resuelve, no
  entra en ciclo).
- El candado se libera a los 15 s de una carga sana, para poder
  auto-repararse también en publicaciones futuras.
- El error se marca como manejado (no ensucia la consola).

## Verificación
- `tsc --noEmit` ✓ · eslint de main.tsx limpio · `npm run build` completo ✓

## Al instalar
Reemplaza main.tsx + versión, `npm run build` y publica. OJO: las pestañas
que YA están abiertas con la versión anterior aún no traen este guardián —
la primera vez recárgalas a mano; a partir de esta versión, el desorden se
repara solo.
