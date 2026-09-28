# V00383 — Empresas: una razón social, una dirección y "Borrar" con autorización

## 1. Una sola Razón Social
- Se quitó "Razón Social (para operaciones, facturación y pagos)". Queda solo "Razón Social *".
- Al guardar se escribe el MISMO valor en `nombre` y `razonSocial` (lo que leen operaciones,
  facturación y pagos no cambia de fuente).
- Empresas que tenían las dos distintas: al abrirlas se muestra la razón social (la que ya se veía
  en operaciones/facturas) y al guardar ambas quedan iguales.

## 2. Una sola dirección
- Se quitó el bloque "Dirección de la Empresa (Buscar en Base de Datos)".
- Queda una sección "Dirección de la empresa" con el bloque del tipo seleccionado
  (ej. Dirección Cliente (Paga)); "+ Añadir Nueva" vive en su encabezado.
- La dirección PRINCIPAL (direccionId/direccion, que leen Operaciones, Facturación, remisiones y la
  ficha) se toma al guardar de Cliente (Paga), o de la primera capturada.
- Empresas viejas que solo tenían la dirección general: aparece en el bloque del tipo principal.

## 3. "Borrar" de Autorizaciones se respeta
- Causa: Empresas (y otros módulos) eliminaban sin consultar la regla "Borrar".
- Empresas: se valida antes de preguntar, al eliminar y al Unir duplicados.
- Mismo control antes de preguntar en Operaciones, Unidades, Contactos, Colaboradores, Combustible,
  Convenios de Clientes/Proveedores (y sus detalles), Proveedores de Unidad y Unidades del Proveedor.
- Red de seguridad central en `eliminarRegistro` (config/firebase.ts): ningún borrado pasa si la
  regla lo exige.
- Nota: los usuarios Admin están exentos de las ACCIONES (como dice el configurador). Para probarlo
  usa "Ver como" con un rol sin Admin.

## Archivos
src/config/firebase.ts, src/features/autorizaciones/autorizaciones.ts,
src/features/empresas/components/{EmpresasDashboard.tsx, FormularioEmpresa.tsx, FormularioEmpresa.css},
src/features/{combustible/components/CombustibleDashboard, empleados/components/EmpleadosDashboard,
  conveniosClientes/components/ConveniosClientesDashboard, conveniosProveedores/components/ConveniosProveedoresDashboard,
  unidadesProveedor/components/UnidadesProveedorDashboard, proveedoresUnidad/components/ProveedoresUnidadDashboard,
  unidades/components/UnidadesDashboard, contactos/components/ContactosDashboard,
  operaciones/components/OperacionesDashboard}.tsx
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint igual a la base (FormularioEmpresa 22 → 19); build OK.
