# V00375 — Movimientos sin regla del Verde · el verde de la bitácora SIEMPRE cuenta

## Archivos que cambian (respetar rutas)
- `src/features/operaciones/components/OperacionesDashboard.tsx`
- `src/features/operaciones/components/FormularioOperacion.tsx`
- `src/features/saldosPuentes/components/SaldosPuentesDashboard.tsx`
- `src/config/historialCambios.ts` + `src/config/version.ts` + `public/version.json` — V00375.

## 1) A los MOVIMIENTOS nunca les sale el mensaje
Tu TR-250926-041 tenía tipo "Transfer" pero convenio "Movimiento Nuevo
Laredo - Caja - Cargado" — por eso saltaba el aviso. Ahora el
movimiento se detecta TAMBIÉN por el convenio/tarifa (además del tipo):
si dice "Movimiento", la operación queda exenta de la regla del Verde,
no cobra peaje, no muestra la alerta 🌉⚠ y no entra al reporte. Un
movimiento no hace cruces.

## 2) Con Verde MX / Verde USA marcado, SIEMPRE se puede completar
Tu TR-250926-037 tenía "9.1 Verde Mx (Importación)" en la bitácora y
aun así el candado la frenaba: ese verde entró por TRANSICIÓN
AUTOMÁTICA, que no dejaba la marca que el candado revisaba. Ahora el
candado consulta LA BITÁCORA: si hay cualquier Verde MX / Verde USA
registrado (de importación o exportación, manual o automático), la
operación se puede marcar como SERVICIO COMPLETADO sin traba — en la
ficha, en Registrar Status y en el formulario. (Y si ese verde no
alcanzó a cobrar el peaje, el respaldo al completar lo cobra.)

## Verificación
- `tsc --noEmit` ✓ · eslint: Operaciones 127, Formulario 377,
  Saldos 0 — baselines exactos · `npm run build` ✓

## Al instalar
Reemplaza los archivos + versión, `npm run build` y publica.
