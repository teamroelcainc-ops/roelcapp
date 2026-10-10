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

## Orden de despliegue
| Versión | Pasos |
|---|---|
| V00436 | Nada en producción (herramientas). |
| V00437 | Ver "Antes de publicar" en CAMBIOS-V00437.md: perfil del admin → funciones → "Sincronizar permisos" → desactivar registro público → web → (P1) reglas. |
| V00438 | Solo web. |
| V00439 | Solo web. Revisar en Roles si ADMINISTRATIVO necesita el permiso `EDITAR REF` (ver CAMBIOS-V00439.md). |
| V00440 | Web → `firebase deploy --only functions` → encender `canonicosEnServidor` → **P2**: respaldo, `npm run migrar:v2` (simulación), revisar reportes, `-- --aplicar --confirmo-respaldo`, Verificar integridad. Detalle en CAMBIOS-V00440.md. |

## Migración del esquema v2 (Fase 4, P2)
- Script: `functions/scripts/migrarEsquemaV2.ts` → `npm --prefix functions run migrar:v2` (simulación por defecto).
- Reportes: `functions/reportes/migracion-v2-<fecha>/` (fuera de git): `resumen.json`, `cambios.csv`, `pendientes.csv`,
  `avisos.csv`, `paridad.csv`, `errores.csv`.
- Criterio de aceptación: Verificar integridad con `opsSinEsquemaV2 = opsSinFechaISO = opsSinEstadoGrupo = 0` (salvo
  los casos listados en `pendientes.csv`) y `paridad.csv` revisado (las diferencias son datos raros: status por ID
  vs. por nombre, operaciones dentro de una factura sin `facturaClienteId`).
- Emulador (recomendado antes de producción): `firebase emulators:start --only firestore --import <export>` y
  `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm --prefix functions run migrar:v2 -- --aplicar`.
