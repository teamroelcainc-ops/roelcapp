# V00355 — Tarifa del puente al COMPLETAR · moneda marcada · aviso diario

## Archivos que cambian (respetar rutas)
- `src/features/operaciones/components/FormularioOperacion.tsx`
- `src/features/operaciones/components/OperacionesDashboard.tsx`
- `src/features/operaciones/components/ServiciosCompletados.tsx`
- `src/features/saldosPuentes/components/SaldosPuentesDashboard.tsx` y `.css`
- `src/features/operaciones/components/TarjetaCasetas.tsx` y `.css`
- `src/config/historialCambios.ts` + `src/config/version.ts` + `public/version.json` — V00355.

## 1) La moneda queda MARCADA en Saldos de Puentes
En la tabla, la moneda de cada tarifa aparece como etiqueta con su
color: Dólares en azul, Pesos en naranja.

## 2) Actualización diaria — recordatorio en la tarjeta
El botón "+ Actualizar saldos" de Operaciones ya registra el día en la
tabla; ahora, mientras HOY no se capture, cada puente de la tarjeta
muestra "· sin captura hoy" en ámbar, para que el equipo lo actualice a
diario (el aviso y el botón desaparecen al capturar).

## 3) Al marcar SERVICIO COMPLETADO se coloca la tarifa (campo nuevo)
La operación guarda automáticamente el campo **Saldo Puente** al quedar
completada — desde el formulario (status calculado) O desde "Registrar
Status" de la ficha:
- Tráfico **Importación** → saldo vigente de **Caseta AVI**.
- Tráfico **Exportación** → saldo vigente de **Caseta Puente III**.
Se guarda el monto, la moneda, el puente y la fecha; NO se pisa si la
operación ya lo tenía (queda la tarifa del día en que se completó). En
Servicios Completados hay una columna nueva "Saldo Puente" (actívala en
el configurador de columnas; también sale en el Excel).

## Verificación
- `tsc --noEmit` ✓ · eslint: Formulario 377, Operaciones 127 y
  Completados 163 = baselines exactos; Saldos y Tarjeta en 0 ·
  `npm run build` ✓

## Al instalar
Reemplaza los archivos + versión, `npm run build` y publica.
