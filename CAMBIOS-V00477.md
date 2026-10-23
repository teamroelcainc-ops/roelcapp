# V00477 — Operaciones: activas, completadas y canceladas en un solo lugar, con pestañas

**Solo web.** Va encima de la V00476. Sin funciones, reglas, índices ni banderas.

## Qué cambia en pantalla
- **Menú:** un solo apartado, **Operaciones**, en lugar de *Operaciones Activas*, *Servicios Completados* y *Servicios Cancelados*.
- **Arriba del módulo:** las pestañas **Activas**, **Completadas** y **Canceladas**. Cada pestaña es el módulo de siempre, con sus filtros, búsquedas, fichas y botones. Al cambiar de pestaña, lo que ya estaba abierto o buscado se conserva.
- **Permisos:** cada persona ve solo las pestañas que su rol tiene. Con una sola, no aparece la barra de pestañas.
- **Menú → Operaciones** lleva a la pestaña que ya se veía; desde otro módulo, a *Activas* (o a la primera permitida).
- **Personalizar Etiquetas:** el nombre del apartado es la etiqueta **Operaciones**. Las tres etiquetas anteriores ya no se usan en el menú.
- **Celular:** la barra de abajo conserva sus accesos directos a Completados y Cancelados.
- **Panel de Filtros:** el que Completadas y Canceladas abren al entrar tapa también las pestañas, igual que tapa el menú. Se cierra con la ✕ o tocando fuera.

## Pasos manuales
Ninguno.

## Técnico
- `features/operaciones/components/PestanasOperaciones.tsx` + `.css` (`pop-`): barra de pestañas con permisos; navega con `navegarA`.
- `features/operaciones/services/modulosOperaciones.ts` (+ prueba): `MODULOS_OPERACIONES`, `esModuloOperaciones`, `pestanaDeEntrada`.
- `App.tsx`: un solo ítem de menú (`menu.operaciones`) y la barra arriba de los tres `MantenerVivo`. Los módulos, sus claves y permisos no cambian.
- `EtiquetasDashboard`: `menu.operaciones` en lugar de las tres etiquetas.
- Banco de pruebas (escritorio y celular): el menú muestra *Operaciones* una vez y las pestañas Activas / Completadas / Canceladas cambian de módulo con el menú marcado. En Empresas no aparecen. Navegar a `serviciosCompletados` marca *Completadas*. Sin errores de consola.
