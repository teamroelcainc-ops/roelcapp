# V00437 — Fase 1: seguridad e integridad del dinero

## ⚠ Antes de publicar esta versión de la web
1. **Revisa que TU usuario tenga documento en `usuarios`** (Firestore → usuarios → tu uid) con `roles: ["ADMIN"]`.
   Desde esta versión una cuenta de Authentication **sin documento ya no entra** (antes entraba como administrador).
2. Despliega las funciones: `firebase deploy --only functions` (trae `usuarioEscrito`, `sincronizarClaims`,
   `gestionarUsuario`, `eliminarConPapelera` y los cambios de `crearOperacion`/`verificarIntegridad`).
3. Entra como admin → **Usuarios → "🔐 Sincronizar permisos"**. El aviso lista las *cuentas sin perfil*: dales perfil
   o bórralas en Authentication.
4. En la consola de Firebase → Authentication → Configuración → **desactiva "Permitir la creación de cuentas"**
   (registro público). Las altas se hacen desde Usuarios.
5. Publica la web.
6. **Reglas (punto de parada P1):** `npm run test:rules` en tu máquina; si pasa, `firebase deploy --only firestore:rules,storage`.

## Qué cambia para los usuarios
- **Sin perfil = sin acceso.** Si una cuenta no tiene documento en Usuarios, está desactivada o es de cliente, el login
  explica el motivo y no abre la sesión. Antes "Perfil no encontrado" se mostraba como "contraseña incorrecta" y la
  sesión quedaba abierta con acceso total.
- **El perfil se aplica en vivo**: si un admin cambia los roles de alguien, se reflejan sin recargar; si lo desactiva o lo
  borra, su sesión se cierra.
- **Red de la oficina**: en Roles hay una casilla **"Requiere red de la oficina (IP)"**. Se revisa al iniciar sesión y
  también al abrir la app con una sesión guardada (antes la revisión leía campos que nadie llenaba y nunca se aplicaba).
  La IP es la misma del Reloj Checador (se guardan `ipOficial` e `ipOficina`).
- **Pagos**: aplicar, editar y borrar un pago se hace en una transacción que vuelve a leer cada factura. Si otro usuario
  ya aplicó un pago, aparece un aviso y no se guarda nada (antes el último que guardaba borraba el pago del otro).
  Al borrar un pago de una factura en dólares, el saldo ya usa el total en dólares (antes usaba la conversión a pesos).
- **Nómina**: al generar o editar una nómina se revisa en una transacción que ninguna operación esté ya en otra nómina
  (lista las referencias si lo están). El folio sale de un contador por día (sin duplicados). El historial se ordena por
  fecha de pago con "Cargar más"; los saldos de préstamo y ahorro salen del historial completo del operador.
- **Facturación**: no se puede eliminar una factura con pagos aplicados. Al agregar, quitar o mover operaciones se
  recalcula el total en la moneda de la factura (`subtotalMonedaFactura`) respetando totales capturados a mano.
  Corrección: las facturas de proveedor en dólares tomaban el emisor de pesos.
- **Autorizaciones**: solo un administrador guarda la configuración; "Ver como" ya no relaja reglas si el usuario real no
  es admin; un rol llamado "ADMINISTRATIVO" ya no cuenta como admin; las solicitudes aprobadas solo se aplican a
  colecciones de módulos autorizables (nunca usuarios ni permisos).
- **Eliminar con papelera** es atómico (copia y borrado en un solo paso).

## Servidor (functions/)
- `acceso.ts`: `exigirPersonal`/`exigirAdmin` leen el perfil (un usuario dado de baja no usa callables ni un minuto).
- `usuarios.ts` (nuevo): `usuarioEscrito` (claims `{personal, admin, cliente}` desde `usuarios/{uid}`; al perder el
  acceso revoca sus sesiones), `sincronizarClaims` (backfill + cuentas sin perfil), `gestionarUsuario` (alta/baja con
  Admin SDK; "eliminar" deshabilita la cuenta de Auth).
- `papelera.ts` (nuevo): `eliminarConPapelera` (transacción; no borra colecciones de seguridad, pagos ni facturas con pagos).
- `crearOperacion`: payload validado con zod; mismo patrón de prefijo que `renumerarOperacion`.
- `verificarIntegridad`: solo admin y como máximo una vez cada 10 min (devuelve el último reporte si se pide antes).
- App Check preparado (`ENFORCE_APP_CHECK=true` en `functions/.env` cuando el tráfico ya traiga token; en la web,
  `VITE_APPCHECK_SITE_KEY`).
- `bloqueoRed.ts`: función bloqueante de red de oficina para cuando haya Identity Platform (no se exporta todavía).

## Reglas (firestore.rules / storage.rules) — punto de parada P1
- Personal (claim o perfil válido) lee todo; escribe si su perfil sigue existiendo.
- Nadie se cambia sus propios roles; usuarios, roles, autorizaciones, seguridad y banderas: solo admin (revisado en el
  documento, no en el token). Bitácora: solo agregar. `meta/*`: solo funciones. Clientes: solo su perfil.
- Compromiso documentado: un usuario dado de baja puede LEER hasta 1 hora (lo que dura su token); ya no puede escribir.
- Pruebas: `firebase-tests/firestore.rules.test.ts` (20 casos, incluido el contrato de la app móvil).

## Banderas nuevas (configuracion/flags, todas apagadas)
- `usuariosPorServidor`: altas/bajas por `gestionarUsuario`. Encender tras desplegar funciones.
- `eliminarPorServidor`: borrados por `eliminarConPapelera`. Encender tras desplegar funciones.

## Verificación
- `tsc -b` ✔ · trinquete ESLint ✔ (any 2,855 → 2,834) · vitest web 60 ✔ · functions 6 ✔ · build ✔.
- Revisión independiente del diff: 9 hallazgos, todos corregidos (totales con filas importadas, cierre de sesión sin red,
  revocación inmediata para escribir, configuración de la empresa, nóminas sin `fechaPago`, candado de integridad,
  mensajes de error, doble revisión de red).
- **No probado en navegador ni emulador**: login/cierre de sesión, sincronización de claims, transacciones de pagos y
  nómina con datos reales, reglas (`npm run test:rules`). Probar primero con un usuario de prueba.
