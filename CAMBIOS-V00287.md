# V00287 — Colaboradores: pestaña Firmas, foto del empleado y altas rápidas ligadas a catálogos

## Archivos que cambian (respetar rutas)
- `src/features/empleados/components/EmployeeForm.tsx` y `.css`
- `src/services/employeeService.ts`
- `src/types/empleado.ts`
- `src/config/version.ts` y `public/version.json` — bump a V00287.

## 1) Pestaña "Firmas" en el formulario del colaborador
Nueva pestaña (Datos Personales | Alta Empresa | Operador | Herramientas |
**Firmas**) con los tres campos: **Nombre de la firma, Correo de la firma
y Cargo de la firma**. Se guardan en el propio empleado y, al guardar, se
reflejan automáticamente en el directorio de Firmas del módulo
(`firmas_colaboradores`, un registro por empleado) — las dos vistas
siempre dicen lo mismo.

## 2) Foto del empleado
Bloque de foto al inicio de Datos Personales: vista previa circular,
elegir archivo y "Quitar foto". La imagen se sube a Storage
(`empleados_fotos/{id}/…`) al GUARDAR el empleado (alta o edición) y el
doc queda ligado con `foto` (URL). Si la subida falla, el empleado se
guarda igual y el aviso lo dice para reintentarla desde Editar.
⚠️ Reglas de Storage: permitir la carpeta `empleados_fotos/` (mismo
bloque que tarifarios_firmados/facturas_documentos).

## 3) Editar sí guarda
El guardado quedó destrabado desde V00284 (limpieza de `undefined`, sin
`_contadores`, preventDefault primero) y el directorio usa onSnapshot: al
guardar, la tabla se actualiza sola al instante. En esta versión el
servicio además devuelve el id real del registro (necesario para ligar la
foto y la firma) — despliega y prueba: alta → editar → guardar → la fila
cambia sin recargar.

## 4) Listas desplegables ligadas a sus catálogos
- **Cargo** y **Departamento**: botón **+** junto a cada lista — lo que
  agregues se guarda EN SU CATÁLOGO (`catalogo_tipo_cargo` con
  nombre_puesto, `catalogo_departamentos` con nombre), queda seleccionado
  al momento y disponible para todos. El empleado guarda id + nombre
  (relación real, no texto suelto).
- **Dirección Exacta**: ya estaba bien relacionada — el buscador lee la
  colección `direcciones` EN VIVO (onSnapshot) y "+ Nueva" abre el
  formulario de Direcciones que guarda ahí; la nueva dirección aparece en
  el buscador al instante y el empleado guarda `addressId` +
  `addressLabel`.

## Verificación
- `tsc --noEmit`: 0 errores. ESLint: EmployeeForm 19 (base 20, mejora),
  employeeService 0, empleado.ts 0. `style={{` sin cambios (los 10 son
  preexistentes).
- `npm run build`: OK (PWA generada).
