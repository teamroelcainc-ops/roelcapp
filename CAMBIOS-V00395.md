# V00395 — Otros Cruces (Referencias de Puentes)

- Nueva pestaña "Otros Cruces" (entre Asignar Operaciones e Historial) con botón "+ Agregar cruce".
- Campos: Referencia (automática), Fecha, Hora (precargadas con ahora), Puente (catálogo; precarga su
  importe), Monto, Unidad (lista de unidades o texto libre, ej. "carro particular") y Usuario que
  registra (automático, sesión actual).
- Referencia: continúa la serie del puente — AVI-DDMMAA-NNN, PT3-DDMMAA-NNN o PTC-DDMMAA-NNN —
  compartida con las referencias de operaciones.
- Al guardar se crea directamente en referencias_puentes (tipo "otroCruce"), así aparece al instante
  en el Historial (con chip "Otro cruce", unidad y usuario) y en la tabla de la pestaña. Se puede eliminar.
- Descuenta del saldo: Saldos de Puentes (libro, historial) y las tarjetas de puente de Operaciones
  Activas incluyen estos cruces.

## Archivos
src/features/puentes/components/ReferenciasPuentesDashboard.tsx + .css
src/features/saldosPuentes/components/SaldosPuentesDashboard.tsx
src/features/operaciones/components/TarjetaCasetas.tsx
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint igual que antes (Referencias 51; Saldos y Tarjeta 0); build OK.
