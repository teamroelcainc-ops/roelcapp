# PLAN-REFACTOR.md — refactorización de acceso a datos (fases 0–8)

Fuente: "Prompt de Plan de Acción" del code review del 10/oct/2026. Cada fase salió como una versión
(ver `CAMBIOS-Vxxxxx.md`). Este archivo dice **qué hay que hacer en producción, en qué orden y qué
bandera se enciende después**. Nada de lo nuevo cambia el comportamiento hasta seguir estos pasos.

## Puntos de parada (requieren a Omaf/Jesús, con evidencia)
| # | Antes de… | Evidencia que hay que ver |
|---|---|---|
| P1 | Publicar `firestore.rules` / `storage.rules` | `npm run test:rules` en verde + backfill de claims hecho |
| P2 | Correr cualquier migración en producción | dry-run revisado + export de respaldo hecho |
| P3 | Aplicar la reconciliación de saldos de facturas | reporte de diferencias factura por factura aprobado |
| P4 | Borrar campos o colecciones legadas | todo encendido y estable al menos 2 semanas |

## Respaldo (antes de P2/P3)
```bash
gcloud firestore export gs://roelcaapp.appspot.com/respaldos/$(date +%Y%m%d-%H%M) --project roelcaapp
```

## Banderas (`configuracion/flags`)
Se crean a mano en Firestore (documento `configuracion/flags`, campos booleanos). Si el documento no existe, todas están apagadas.

| Bandera | Fase | Encender cuando… | Qué hace |
|---|---|---|---|
| `usuariosPorServidor` | 1.3 | funciones V00437 desplegadas | Altas/bajas de usuarios por `gestionarUsuario` (sin "app secundaria") |
| `eliminarPorServidor` | 1.6 | funciones V00437 desplegadas | `eliminarRegistro` usa `eliminarConPapelera` (transacción en servidor) |
| `canonicosEnServidor` | 4.4 | funciones V00440 desplegadas, ANTES de la migración (P2) | `crearOperacion` y `operacionEscrita` escriben y mantienen los campos canónicos de las operaciones |
| `dineroPorServidor` | 5.1–5.5, 5.8 | funciones V00441 desplegadas + reglas V00441 publicadas (P1) + `diferencias.csv` de la reconciliación aprobado (P3); justo ANTES de `reconciliar --aplicar` | Facturación y Pagos por callables con transacción; trigger de saldo con la regla única y agregados en centavos; tablas hijas renglones/aplicaciones; las reglas bloquean los campos de dinero desde el navegador |
| `cobroPuenteEnServidor` | 5.7 | funciones V00441 desplegadas | El peaje lo cobra `operacionEscrita` al cambiar de estatus (web, Mis Operaciones y app móvil); la web deja de calcularlo |
| `propagacionEnServidor` | 6.2 | funciones V00442 desplegadas + `npm run nombres -- --aplicar` (P2) con `cambios.csv` revisado | Los nombres de empresas, status, tipos de operación, unidades y empleados se copian solos a operaciones, facturas, pagos, tarifarios y convenios; se ocultan los botones "Sincronizar nombres" y "🏷 Razón social" |
| `saldosCorrientes` | 5.6 | funciones V00441 desplegadas + `npm run saldos:diesel -- --aplicar` (P2) con `paridad.csv` revisado | La tarjeta Saldo Diesel lee `saldos_corrientes` (1 documento por proveedor) en vez de 3,000 referencias |
| `consultasCanonicas` | 7 | índices V00443 "Habilitados" + `canonicosEnServidor` encendida + migración v2 aplicada (P2, integridad en cero) + `npm run usos -- --aplicar` | Las pantallas consultan por `estadoGrupo`/`fechaServicioISO`/`empresasIds`/`porFacturar*`/`*Id` con páginas y topes, y los conteos salen de `usos/`. El modal de Pagos acotado necesita además `dineroPorServidor` |

## Orden de despliegue
| Versión | Pasos |
|---|---|
| V00436 | Nada en producción (herramientas). |
| V00437 | Ver "Antes de publicar" en CAMBIOS-V00437.md: perfil del admin → funciones → "Sincronizar permisos" → desactivar registro público → web → (P1) reglas. |
| V00438 | Solo web. |
| V00439 | Solo web. Revisar en Roles si ADMINISTRATIVO necesita el permiso `EDITAR REF` (ver CAMBIOS-V00439.md). |
| V00440 | Web → `firebase deploy --only functions` → encender `canonicosEnServidor` → **P2**: respaldo, `npm run migrar:v2` (simulación), revisar reportes, `-- --aplicar --confirmo-respaldo`, Verificar integridad. Detalle en CAMBIOS-V00440.md. |
| V00441 | Web → functions → **P1** reglas (`npm run test:rules`) → **P2** `npm run saldos:diesel` (simulación → `--aplicar`) → `saldosCorrientes` → **P3** `npm run reconciliar` (simulación, el negocio revisa `diferencias.csv`) → `dineroPorServidor` (esperar 1 min) → `reconciliar -- --aplicar --confirmo-respaldo` → `cobroPuenteEnServidor`. Detalle en CAMBIOS-V00441.md. |
| V00442 | Web → functions (**borrar `operacionMontoCambiado` cuando lo pregunte**) → `firebase deploy --only firestore:indexes` → P1 reglas → alerta de `[reintentos]` → **P2** `npm run usos` y `npm run nombres` (simulación → `--aplicar`) → `propagacionEnServidor`. Detalle en CAMBIOS-V00442.md. |
| V00443 | Web → `firebase deploy --only firestore:indexes` (esperar "Habilitado") → con los requisitos de la tabla de banderas, `consultasCanonicas` → medir con `npm run dev:medir`. Detalle en CAMBIOS-V00443.md. |
| V00444 | Solo web (orden interno, sin banderas). Revisar en el navegador lo de "No probado aquí" de CAMBIOS-V00444.md. |

## Reconciliación de facturas (Fase 5, P3)
- Script: `functions/scripts/reconciliarFacturas.ts` → `npm --prefix functions run reconciliar` (simulación por defecto).
- Reportes: `functions/reportes/reconciliacion-<fecha>/`: `resumen.json`, `diferencias.csv` (una fila por factura y campo:
  total manual propuesto, total legado vs. regla única, pagado guardado vs. libro de pagos, saldo, status, saldo a favor).
- `--aplicar` exige `dineroPorServidor` encendida (si no, el trigger de saldo con la regla anterior deshace lo escrito).
- Criterio de aceptación: el negocio aprueba `diferencias.csv`; después de aplicar, una segunda simulación sale sin
  diferencias (salvo `montoPagado` si no se usó `--pagado-desde-pagos`).

## Saldo corriente de diésel (Fase 5.6, P2)
- Script: `functions/scripts/reconstruirSaldosDiesel.ts` → `npm --prefix functions run saldos:diesel`. `paridad.csv` compara la
  tarjeta de siempre contra la nueva por cada saldo; `--limite` solo en simulación.

## Contadores de uso y nombres (Fase 6, P2)
- `npm --prefix functions run usos`: recuento de `usos/{tipo}_{id}` desde cero (`usos.csv`: antes/después).
- `npm --prefix functions run nombres`: pone al día todas las copias `*Nombre` con el mapa de `src/shared/dominio/nombres.ts`
  (`cambios.csv`). Se corre antes de encender `propagacionEnServidor`.

## Migración del esquema v2 (Fase 4, P2)
- Script: `functions/scripts/migrarEsquemaV2.ts` → `npm --prefix functions run migrar:v2` (simulación por defecto).
- Reportes: `functions/reportes/migracion-v2-<fecha>/` (fuera de git): `resumen.json`, `cambios.csv`, `pendientes.csv`,
  `avisos.csv`, `paridad.csv`, `errores.csv`.
- Criterio de aceptación: Verificar integridad con `opsSinEsquemaV2 = opsSinFechaISO = opsSinEstadoGrupo = 0` (salvo
  los casos listados en `pendientes.csv`) y `paridad.csv` revisado (las diferencias son datos raros: status por ID
  vs. por nombre, operaciones dentro de una factura sin `facturaClienteId`).
- Emulador (recomendado antes de producción): `firebase emulators:start --only firestore --import <export>` y
  `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm --prefix functions run migrar:v2 -- --aplicar`.

## Consultas acotadas (Fase 7)
- Capa única: `src/shared/data/consultas.ts` (`paginaOperaciones`, `paginaPorFacturar`, `paginaOperacionesDeEmpresa`,
  `paginaOperacionesDeConvenio`, `paginaFacturasAbiertas`, `operacionesDelDia/DelRango`, `todasLasPaginas` con tope,
  `porIds` en lotes de 30, `usosPorTipo`/`usosEnCache`). Una pantalla nueva consulta por ahí, no con `getDocs` propio.
- Sin índice no hay respaldo de "leer todo": el error se ve en pantalla y el índice va en `firestore.indexes.json`.
- Pendiente (decisión): lista de Pagos por empresa/periodo (necesita un selector de periodo), historial de facturas
  paginado, "Facturadas/Todas" de Facturación por rango, resúmenes diarios precalculados por una función programada
  (`resumenes_diarios/{fecha}`) y `getAggregateFromServer` en Estadísticas. Ver code-notes.md.

## Fase 8 — lo que queda
### 8.2 Unir Facturación Clientes y Proveedores — DECISIÓN DE PRODUCTO (no hecho)
Ya comparten la carga de operaciones (`useOperacionesFacturables`) y los selectores. Lo demás difiere y hay que elegir
qué se queda en cada punto (lista en code-notes.md, Fase 8). Con esa lista aprobada: un `FacturacionDashboard` con
`lado` y las diferencias como configuración (columnas, campos de la operación, documentos PDF propios de cada lado).

### 8.3 Archivos de más de 800 líneas — siguientes pasos (uno por versión, cada uno revisado en el navegador)
1. Facturación (ambos): modales a archivos propios — Emisores de remisión, Vista previa de remisión, Configurar
   columnas, Costo adicional, Diagnóstico, Agregar referencia, Detalle/Edición de factura — pasando sus estilos en
   línea a CSS al moverlos. Luego la tabla de operaciones (`TablaOperacionesFacturables`, virtualizada).
2. OperacionesDashboard y ServiciosCompletados/Cancelados: `FilaOperacion` (memo), `TablaOperaciones` (virtualizada),
   filtros y modales (horarios, ficha, carta) en archivos propios; un hook `useCompletados(rango)`.
3. FormularioOperacion: una pestaña por archivo (General, Pedimento, Manifiesto, Unidad, Cobrar) con un contexto del
   formulario (`formData`/`setFormData`, catálogos) en lugar de pasar 40 props.
4. ReferenciasNomina, ReferenciasDiesel, Catálogos, Tarifarios: igual, cuando se toquen.

### 8.4 Costos y sueldos aparte (`operaciones_finanzas/{opId}`) — DISEÑO, requiere P1 + P2 + app móvil
Firestore no oculta campos: quien lee una operación lee sus montos. Pasos propuestos:
1. Bandera `finanzasAparte`: `operacionEscrita` copia los campos de dinero (montoConvenioCliente, cargosAdicionales*,
   totalAPagarProv, sueldoOperador, sueldoExtra, combustible*, conversiones, `*Centavos`, utilidad) a
   `operaciones_finanzas/{opId}`; script de puesta al día (P2).
2. Pantallas de finanzas (Facturación, Pagos, Nómina, Estadísticas, Reportes) leen de `operaciones_finanzas`.
3. Roelca Móvil: `sueldo.ts` y `ajusteSueldoPorStatus` dejan de leer/escribir `sueldoOperador` en `operaciones` (el
   servidor aplica el ajuste por status). Se publica la app ANTES del paso 4.
4. Reglas (P1): `operaciones_finanzas` solo roles de finanzas; escrituras de dinero en `operaciones` bloqueadas.
5. P4: borrar los campos de dinero de `operaciones`.

