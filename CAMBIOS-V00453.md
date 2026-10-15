# V00453 — App móvil: historial y pagos del operador, historial completo del cliente

**Web + Cloud Function `portalCliente` + índice nuevo (opcional) + app móvil.**

## Qué cambia para el usuario
### App móvil — operador (2 pestañas nuevas)
- **Historial**: todas sus operaciones (completadas, en curso, canceladas) agrupadas por mes, con buscador y filtros. Cada una muestra lo que le paga (sueldo + extra) y si ya se cobró: *Pagado*, *En nómina NOMINA-…* o *Por cobrar*. Se cargan de 30 en 30 al bajar.
- **Mis pagos**:
  - **Semana** (lunes a domingo, flechas para semanas anteriores): *Llevas ganado* = sueldo de sus operaciones completadas (o Falso) con fecha de servicio en la semana; desglosado en *Pagado*, *Por cobrar* y *En curso* (lo que sumarán las que siguen activas). Lista de las operaciones de la semana.
  - **Nóminas**: todas sus nóminas (`referencias_nomina`) con status Pagada/Pendiente; al tocar una se abre el **recibo**: percepciones, deducciones (IMSS, ISR, Infonavit, Fonacot, préstamo, ahorro), total, forma de pago, saldos de préstamo/ahorro y las operaciones incluidas.
- En el detalle de cada operación aparece **Tu pago** (sueldo y si ya se cobró).

### App móvil — cliente
- **Historial completo**: en *Servicios → Completadas* hay un acceso a *Historial completo*: todas las operaciones de su empresa, **mes por mes** (antes solo veía las de los últimos 60 días), con conteo de completadas / en proceso / canceladas y buscador. Lo ven el Cliente (Paga) y el Cliente (Mercancía).

### Web — Usuarios
- Botón **📱 Nuevo acceso de cliente**: abre el formulario de usuario con *Acceso de CLIENTE (solo app móvil)* ya marcado; se eligen la(s) empresa(s) y el usuario recibe el correo para crear su contraseña.
- Filtro **Todos / Personal / 📱 Clientes app móvil** y, en la lista, las empresas a las que da acceso cada usuario de cliente.

## Pasos manuales
1. **Publicar la función** (sin esto el historial del cliente avisa "aún no está publicado"; lo demás funciona):
   `firebase deploy --only functions:portalCliente`
2. **Índice (recomendado, requiere tu visto bueno)**: `operaciones(operador ASC, fechaServicioISO DESC)` ya está en `firestore.indexes.json`. Sin él la app del operador funciona igual pero lee todas sus operaciones para armar el historial y la semana. Publicar solo índices:
   `firebase deploy --only firestore:indexes`
   (o crearlo desde el enlace que Firestore imprime en la consola la primera vez que falta).
3. App móvil: copiar los archivos del zip de Roelca Móvil (incluye el rediseño anterior) y generar el build.

## Técnico
- `functions/src/portalClientes.ts` (portal-v2): acción `historial {desde, hasta}` (máx. 93 días; 600 por empresa, `truncado`), índice existente `empresasIds CONTAINS + fechaServicioISO DESC`, respaldo `clientePaga/clienteMercancia + fechaServicio`; papel y propiedad también por `clientePagaId`/`clienteMercanciaId`. Caché de 15 s por rango.
- `src/usuarios/components/UsuariosDashboard.tsx/.css`: `abrirNuevoCliente`, `filtroTipo`, empresas en la fila. `style={{` sin cambio (2).
- `firestore.indexes.json`: índice del operador.
- Reglas: **sin cambios**. El operador es "personal" y ya puede leer `operaciones` y `referencias_nomina`.

## Verificación
- `tsc -b` ✓ · trinquete ESLint ✓ (any 2284 = base) · consultas ✓ · CSS ✓ · `vite build` ✓
- Functions: `tsc` ✓ · `vitest` 49/49 ✓
- `vitest` web: 358/359 — la que falla es `sincronizar-dominio.test.mjs`, **preexistente** (no se tocó `src/shared/dominio`; ver code-notes).

## No probado con datos reales
La función y las consultas del operador no se corrieron contra Firestore. Probar: un operador con nóminas (que el total del recibo coincida con el de la web) y un cliente con operaciones de meses anteriores.
