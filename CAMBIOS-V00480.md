# V00480 — Facturación: clientes y proveedores en un solo lugar, con pestañas

**Solo web.** Va encima de la V00479. Sin funciones, reglas, índices ni banderas.

## Qué cambia en pantalla
- **Menú:** un solo apartado, **Facturación**, debajo de *Análisis de Clientes*. Antes había un *Facturación* dentro de *Clientes* y otro dentro de *Proveedores*.
- **Arriba del módulo:** las pestañas **Clientes** y **Proveedores**. Cada una es el módulo de siempre; al cambiar de pestaña lo que estaba abierto o buscado se conserva.
- **Permisos:** cada persona ve solo las pestañas que su rol tiene. Con una sola, no aparece la barra.
- **Menú → Facturación** lleva a la pestaña que ya se veía; desde otro módulo, a *Clientes* (o a la que tenga permiso).
- **Clientes** y **Proveedores** en el menú se quedan con Tarifario y Convenio.
- **Personalizar Etiquetas:** el nombre del apartado es la etiqueta **Facturación**.
- **Operaciones:** sus pestañas usan la misma barra (se ven igual).
- **Celular:** la barra de abajo conserva sus accesos Fact. Clientes y Fact. Prov.

## Pasos manuales
Ninguno.

## Técnico
- `shared/components/PestanasModulo.tsx` + `.css` (`pmo-`) y `shared/utils/pestanasModulo.ts`: barra y pestaña de entrada, compartidas.
- `features/facturacion/components/PestanasFacturacion.tsx`, `services/modulosFacturacion.ts` (+ prueba).
- `features/operaciones/components/PestanasOperaciones.tsx` usa la barra compartida; **se borra** `PestanasOperaciones.css`.
- `App.tsx`: ítem *Facturación*, barra arriba de los dos `MantenerVivo`; los menús Clientes/Proveedores sin Facturación.
- `EtiquetasDashboard`: `menu.facturaci_n` en lugar de las dos etiquetas de facturación que no se usaban.
