# V00435 — Acceso de clientes para la app móvil

Acompaña a la app móvil **Roelca Móvil** (proyecto Expo aparte, mismo Firebase).

## Usuarios (web)
- Casilla nueva **"Acceso de CLIENTE (solo app móvil)"** en el formulario de usuario. Al marcarla aparece un
  buscador de **empresas** (razón social / nombre, sin acentos). Se pueden ligar varias.
- Se guardan en `usuarios/{uid}`: `tipoUsuario: 'cliente'`, `empresasClienteIds: string[]`,
  `empresasClienteNombres: string[]` (copia para mostrar). Quitar la casilla los limpia.
- La tabla muestra la etiqueta **"Cliente · App móvil"** en la columna de roles.
- Máximo 10 empresas por usuario de cliente (lo que consulta la app).
- El catálogo de empresas se lee una sola vez y solo cuando se marca la casilla.

## Login (web)
- Un usuario con `tipoUsuario: 'cliente'` NO entra al sistema: se cierra la sesión con el aviso
  "Este usuario es de CLIENTE: entra desde la app móvil de Roelca."

## Cloud Function nueva: `portalCliente` (functions/src/portalClientes.ts)
- Única puerta de datos del cliente. Firestore no puede ocultar campos, así que el cliente NO lee
  colecciones: la función devuelve solo lo que debe ver (sin costos de proveedor, sueldos ni utilidad).
- `resumen`: operaciones (Cliente Paga o Mercancía; en proceso + completadas de 60 días), facturas
  pendientes/vencidas/pagadas (por `clienteId`; vencida = fecha + días de crédito), pagos de 12 meses
  (`entidadId` y `clienteId`, solo `tipo: 'cliente'`) y totales por moneda.
- `operacion`: detalle + bitácora de `horarios` + trayecto GPS (`rastreo_operaciones`).
- La ubicación "en vivo" solo se muestra si la operación sigue en proceso y la registra el operador
  asignado; en operaciones terminadas el trayecto se corta en su último status (+10 min).
- Caché de 15 s por instancia (la autorización se revisa en cada llamada).
- Un Admin puede llamarla con `{ empresaId }` para ver lo que vería esa empresa.
- Sin los índices compuestos funciona igual (usa la consulta simple y filtra en memoria).
- Deploy: `firebase deploy --only functions:portalCliente`

## Seguridad de las Cloud Functions existentes (functions/src/acceso.ts, nuevo)
- `crearOperacion`, `renumerarOperacion` y `verificarIntegridad` escriben/leen como ADMIN y solo revisaban
  que hubiera sesión. Con usuarios de CLIENTE eso ya no basta: ahora llaman `exigirPersonal(uid)`
  (documento en `usuarios`, no desactivado y no cliente). El personal no nota ningún cambio.

## Colección nueva (la escribe la app del operador)
- `rastreo_operaciones/{opId}` (estado y última ubicación) y `rastreo_operaciones/{opId}/puntos/{tramo}`.
  No toca `operaciones` (no dispara el motor relacional).

## Pendiente de Omaf / Jesús
1. Desplegar las funciones: `firebase deploy --only functions` (portalCliente nueva + las 3 protegidas). 2. Revisar y publicar las reglas propuestas (vienen con la app móvil:
`firebase/firestore.rules`, `firebase/storage.rules`). 3. Crear los índices (`firebase/crear-indices.sh`).

## Archivos
src/usuarios/components/UsuariosDashboard.tsx + .css
src/features/auth/components/Login.tsx
functions/src/portalClientes.ts (nuevo), functions/src/acceso.ts (nuevo), functions/src/index.ts, functions/src/relacional.ts
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint igual que antes (UsuariosDashboard 15, Login 5); functions tsc 0; build OK;
pruebas de portalCliente y exigirPersonal con Firestore simulado (autorización, campos, facturas, pagos,
totales, sin índices, trayecto de otro operador, corte al cerrar).
