# V00506 — Empresas: Tipo(s) de Empresa y Tipo de Factura con su nombre (no el id)

**Solo web.** Va encima de la V00505. Sin funciones, reglas, índices ni banderas. No cambia datos.

## Qué pasaba
En Empresas, el **detalle** y **Editar empresa** mostraban el id en lugar del nombre:
- en Tipo(s) de Empresa salía, por ejemplo, `ca21ab07` (EMP-1439, Merida Luna Express);
- a veces pasaba lo mismo en Tipo de Factura.

Había dos causas:
1. **Dos ids por registro.** Los catálogos que vienen de AppSheet guardan su propio `id` (el de AppSheet; `ca21ab07` es "Proveedor (Transporte)" en las constantes de la app). En algunos registros ese `id` no es el id del documento en Firestore. Las empresas guardan uno u otro, según quién las guardó, y las pantallas buscaban solo por el id del documento. El formulario, además, solo leía el nombre del campo `tipo`.
2. **El formulario se recargaba solo.** Editar empresa volvía a cargar la empresa cada vez que cambiaba la lista de empresas, que llega en vivo. Eso regresaba los tipos a id después de traducirlos y **borraba lo que se estaba capturando** si alguien guardaba cualquier otra empresa en ese momento.

## Qué cambia
- **Detalle de la empresa y la tabla:** cada catálogo se busca por cualquiera de los dos ids del registro. Aplica a régimen fiscal, moneda, tipo de factura, direcciones, tipos de empresa y de servicio. Los tipos y el tipo de factura salen con su nombre, y el filtro por tipo y el Excel también.
- **Editar empresa:**
  - Los tipos de empresa y de servicio se ven por nombre desde que se abre, y el nombre se toma de `tipo` o de `nombre`.
  - El select de Tipo de Factura muestra el que ya tiene la empresa, aunque esté guardado con el otro id.
  - La empresa abierta ya no se vuelve a cargar cuando cambia otra empresa: lo capturado no se pierde.
- **Al guardar no se cambian los ids.**
  - Cada tipo se guarda con el mismo id que ya traía la empresa (`ca21ab07` sigue siendo `ca21ab07`). Las listas de otros módulos (Proveedores de transporte, Clientes que pagan, Bodegas…) buscan por esos ids.
  - Un tipo nuevo se guarda con el id fijo de la app si el registro lo tiene (TIPO_EMPRESA); si no, con el id del documento, como antes.

## Pasos manuales
1. Aplicar el zip (no hay archivos borrados).
2. No hay que desplegar funciones.
3. Mientras Cloudflare no pueda descargar el repositorio (la falla del 27-oct), publica después del push con `npm run build` y `npx wrangler deploy`.

## Técnico
- `shared/data/indiceCatalogo.ts` (puro, con pruebas): `idsDeRegistro` (el `_docId` y el `id` guardado), `nombreDeRegistro`, `entradasCatalogo`, `buscarEntrada`, `diccionarioCatalogo` y `traductorCatalogo` (muestra nombres, guarda ids conservando el que ya traía).
- `EmpresasDashboard.tsx`: `getDict` usa `diccionarioCatalogo`. Si dos registros chocan, gana el id del documento.
- `FormularioEmpresa.tsx`:
  - `catTiposEmpresaFull` / `catTiposServicioFull` salen de `entradasCatalogo`;
  - `idTipo…DeNombre` / `nombreTipo…DeId` salen de `traductorCatalogo` (para empresa, con `Object.values(TIPO_EMPRESA)` como ids fijos);
  - la carga de la empresa depende solo de `initialData` y traduce los tipos con `useEffectEvent`; el # de una empresa nueva sigue a `registros` en su propio efecto;
  - las opciones de Tipo de Factura llevan el valor guardado.
- Simulador, con un tipo de empresa y un tipo de factura cuyo id de AppSheet no es el del documento:
  - **en la V00505:** el detalle mostraba `ab506app` y `tf506app`, y Editar mostraba `ab506app, 7eec9cbb`;
  - **en la V00506:** el detalle y Editar muestran "Tipo Prueba 506, Cliente" y "Factura Prueba 506";
  - después de un cambio en vivo en otra empresa, los tipos y el alias capturado siguen;
  - al guardar quedaron los mismos ids (`ab506app`, `7eec9cbb`, `tf506app`).
- No probado contra datos reales: si el registro `ca21ab07` de producción no existe en el catálogo (borrado), se seguirá viendo el id. En ese caso hay que volver a crearlo en Catálogos → Tipo de Empresa.
