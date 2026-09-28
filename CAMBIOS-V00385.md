# V00385 — Formularios configurables (obligatorios, visibilidad por rol y editor)

## Cómo funciona
- NUEVO `src/features/formularios/`:
  - `configFormularios.ts` — config compartida en Firestore `config_formularios/{modulo}`:
    por campo `etiquetaOriginal, etiqueta, orden, oculto, obligatorio, rolesVisibles, indice`;
    permiso `Editar Formularios`; validador para formularios que guardan con botón fuera del <form>.
  - `FormularioConfigurable.tsx/.css` — envoltura (display: contents, no altera el diseño) que
    DESCUBRE cada campo (etiqueta + control), lo registra solo, y aplica nombre, orden, ocultos,
    visibilidad por rol y OBLIGATORIOS (bloquea el guardado y marca los faltantes en rojo).
- Botón "✎ Editar formulario" arriba de cada formulario: por campo ↑ ↓ (mover dentro de su sección),
  Nombre, Oblig., Ocultar; Guardar diseño / Restablecer / Cancelar. Mientras se edita no se puede
  guardar el formulario. Lo ve el Admin; otros roles con la casilla "Editar Formularios"
  (Roles y Permisos → Permisos Especiales).
- Autorizaciones → cada módulo tiene "Formulario — obligatorios y visibilidad": nombre, Obligatorio,
  Oculto y "Lo ven" (Todos o roles). Se guarda con "Guardar para todos".

## Formularios integrados (23)
Operaciones, Empresas, Contactos, Direcciones, Unidades Propias, Remolques, Proveedores de Unidad,
Unidades del Proveedor, Convenios Clientes/Proveedores, Colaboradores, MTTO, Combustible,
Tipo de Cambio, Costos Adicionales, Deducciones, Nómina, Referencias de Puentes, Referencias del
Diesel (3), Facturación Clientes/Proveedores, Catálogos (2) y Usuarios (módulo nuevo en Autorizaciones).

## Límites de esta versión
- Mover es dentro de la misma sección/pestaña (no entre pestañas).
- Un campo se detecta cuando su etiqueta tiene su propio contenedor; etiquetas sueltas dentro de un
  contenedor con varios campos no se pueden separar.
- Obligatorio se valida por el valor del control; selectores personalizados sin control nativo no
  se validan.
- Tarifarios y Detalles del Convenio no usan <form> (tablas editables): no llevan el editor.
- Acciones Agregar/Editar de los módulos "pendiente de integrar" (Facturación, Diesel, Puentes,
  Nómina, Deducciones, Completados, Cancelados, Usuarios) siguen pendientes; "Borrar" ya se respeta
  donde se usa la papelera.

Verificación: tsc 0; eslint igual a la base en 25 archivos (Formulario Empresa 19, Operaciones 376),
archivos nuevos en 0; prueba de descubrimiento de campos con jsdom; build OK.
