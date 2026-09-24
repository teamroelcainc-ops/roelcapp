# V00357 — UTILIDAD (Transfer) en la ficha · saldo de puente a TODAS las operaciones

## Archivos que cambian (respetar rutas)
- `src/features/operaciones/components/OperacionesDashboard.tsx` y `.css`
- `src/features/saldosPuentes/components/SaldosPuentesDashboard.tsx` y `.css`
- `src/config/historialCambios.ts` + `src/config/version.ts` + `public/version.json` — V00357.

## 1) 💰 Utilidad (Transfer) — en la ficha, pestaña del FINANCIERO
Cuando la operación es TRANSFER, debajo de "Total Gastos" aparece el
desglose completo con tu fórmula:
  **Generado** (tarifa del cliente, + cargos adicionales al cliente si hay)
  **− Saldo del puente** (el colocado al completar)
  **− Gastos adicionales** (los del proveedor, si hay)
  **− Sueldo del proveedor** (su monto base)
  **= Utilidad** — verde si gana, rojo si pierde.
Los montos en pesos se convierten a dólares con el TC aprobado de la
operación (se muestra la conversión); si la operación no tiene TC, se
avisa en ámbar. Si alguna línea no corresponde a lo que llamas "gastos
adicionales" o "sueldo", dime y la cambio — el desglose te deja verlo.

## 2) 🧮 "Aplicar a operaciones" — en Saldos de Puentes
Coloca el saldo del puente a TODAS las operaciones COMPLETADAS que no lo
tengan: Importación → Caseta AVI · Exportación → Caseta Puente III.
Para cada operación usa el saldo registrado en la tabla con fecha más
cercana a su fecha de servicio (o el vigente del catálogo si no hay
histórico). Las que ya lo tienen NO se tocan; puedes presionarlo cuando
quieras. Al terminar te dice cuántas actualizó.

## 3) Sobre el plan de mejoras
Estos dos puntos eran los concretos de hoy. El PANEL DE RENTABILIDAD
(utilidad por cliente/ruta/mes para presumir con el jefe) es el
siguiente — la utilidad Transfer de este zip es justo su primer ladrillo.

## Verificación
- `tsc --noEmit` ✓ · eslint: Operaciones 127 = baseline exacto, Saldos 0 ·
  `npm run build` ✓

## Al instalar
Reemplaza los archivos + versión, `npm run build`, publica y presiona
"🧮 Aplicar a operaciones" una vez para el retroactivo.
