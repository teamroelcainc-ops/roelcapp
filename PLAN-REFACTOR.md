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
_Se completa en cada fase._
