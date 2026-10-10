# V00445 — Operaciones Activas ya no se rompe al abrir · sin token de Banxico · prueba de humo de todos los módulos

**Solo web. Sin banderas ni pasos en producción.**

## Qué cambia
- **Operaciones Activas se rompía al abrir en desarrollo** ("Cannot access 'statusServicioOrdenado' before
  initialization"). Venía de V00378: la línea `void statusServicioOrdenado;` quedó DENTRO del `useMemo` que define
  esa misma lista, así que se leía antes de existir. En el build de producción el minificador la quitaba y por eso no
  se veía. La lista ya no se usaba (el modal usa los status del flujo): se quitó completa, junto con
  `compararStatusPorNumero`, que solo usaba ella.
- **`VITE_BANXICO_TOKEN` fuera** de `.env` y `.env.example` (ningún archivo del código lo leía).
  ⚠ El token sigue en el historial de git (el `.env` estuvo versionado hasta V00435 y se subió a GitHub): conviene
  darlo de baja en el portal de Banxico (SIE API).
- **Prueba de humo nueva** (`src/__pruebas__/modulos.render.test.tsx` + `firebaseFalso.ts`): monta 31 módulos
  (Operaciones, Completados, Cancelados, Facturación, Pagos, Empresas, Convenios, Tarifarios, Reportes, Estadísticas,
  Puentes, Diésel, Nómina, Catálogos, Papelera, MTTO, Usuarios, Roles, Importación…) con Firebase falso, dos veces:
  con todas las banderas apagadas y con todas encendidas. Falla si una pantalla se rompe al abrir. Con el código de
  V00444 reproduce exactamente el error de Operaciones; con el arreglo, las 62 pasan. Corre en `npm run verificar`.

## Verificación
- `tsc -b` ✔ · trinquete ESLint ✔ (any 2,346) · trinquete de consultas ✔ · vitest web 20 archivos / 246 ✔ ·
  `npm run build` ✔.
- La prueba de humo no reemplaza revisar en el navegador: contesta "sin datos", así que no pasa por las ramas que
  dependen de datos reales (tablas llenas, fichas abiertas, modales).
