# V00382 — Autorizaciones: solo piden permiso por lo que realmente cambió

## Causas encontradas
1. **Todos los campos contaban como modificados.** Unidades, Remolques, Colaboradores, Direcciones,
   Contactos, Convenios Clientes/Proveedores, MTTO, Proveedores de Unidad y Unidades del Proveedor
   mandaban `Object.keys(formData)` a verificarAccion → con UNA regla marcada, cualquier edición
   pedía autorización aunque se cambiara otro campo. Los Tarifarios mandaban siempre la lista fija
   fecha/cliente/tarifas/tarifa/cotizadoEn.
2. **Diff crudo** (`camposModificadosDe`): 0 vs vacío, 1500 vs "1500.00", "2026-09-25" vs
   "2026-09-25T00:00:00", Timestamps, mayúsculas/acentos u objetos con otro orden = "cambio".
3. **Operaciones:** contaban el Status que avanza el flujo y los montos que el formulario recalcula
   solo (moneda de Empresas, TC, sueldo/combustible/monto del convenio) aunque el campo estuviera
   bloqueado en pantalla y el usuario no pudiera tocarlo.
4. **Usuarios exentos** se perdían al leer la configuración (nunca se aplicaban) y "Aplicar a todo
   el módulo" los borraba del estado del configurador.
5. **Accesos temporales aprobados** destapaban el campo en pantalla, pero el guardado lo volvía a
   rechazar.
6. **"Agregar libre"** no funcionaba en Operaciones (el formulario no le pasaba el registro al hook).

## Cambios
- autorizaciones.ts: `valoresEquivalentesAut` + `camposModificadosDe` normalizado; carga
  `usuariosExentos`; `evaluarAutorizacion` respeta exentos por uid.
- useAutorizacionesCampos: `verificarAccion(accion, campos, valoresAnteriores?)` descuenta accesos
  vigentes; nuevo `accesoVigente(k)`.
- AutorizacionesDashboard: "Aplicar a todo el módulo" conserva los exentos.
- 10 formularios genéricos: diff real contra el registro abierto.
- Empresa y Combustible: su diff propio usa la comparación normalizada.
- Tarifarios Clientes/Proveedores: fecha, cliente/proveedor, tarifas (altas/bajas), tarifa (montos) y
  cotizado en (moneda) se detectan por separado.
- Operaciones: diff normalizado sin Status ni los campos bloqueados en pantalla; exentos, accesos y
  "Agregar libre".

## Archivos
src/features/autorizaciones/{autorizaciones.ts, useAutorizacionesCampos.ts, components/AutorizacionesDashboard.tsx}
src/features/operaciones/components/FormularioOperacion.tsx
src/features/{empleados/components/EmployeeForm, conveniosClientes/components/FormularioConvenioCliente,
  conveniosProveedores/components/FormularioConvenioProveedor, unidades/components/FormularioUnidad,
  unidadesProveedor/components/FormularioUnidadProveedor, remolques/components/FormularioRemolque,
  direcciones/components/FormularioDireccion, contactos/components/FormularioContacto,
  gastos/components/mtto/FormularioMtto, proveedoresUnidad/components/FormularioProveedorUnidad,
  empresas/components/FormularioEmpresa, combustible/components/FormularioCombustible,
  tarifarioClientes/components/TarifarioClientesDashboard,
  tarifarioProveedores/components/TarifarioProveedoresDashboard}.tsx
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint igual a la base en 17 archivos y Formulario de Operaciones 377 → 376; build OK.
