# V00433 — Cambiar el sueldo del operador con motivo

Pedido: a veces los operadores se equivocan y no se les paga nada; hace falta cambiar el monto del sueldo
dejando el PORQUÉ como nota en la operación.

## Qué hay
- Componente nuevo `CambioSueldoOperador.tsx` (+ .css): botón "✎ Cambiar sueldo" → ventana con el sueldo
  actual, el NUEVO monto (puede ser 0) y el MOTIVO (obligatorio, mín. 5 caracteres).
- Se guarda en la operación: sueldoOperador, sueldoTotal (= nuevo + extra), sueldoManual, ultimoCambioSueldo
  y el historial `cambiosSueldo[]` {fecha, de, a, motivo, usuario, uid}; además queda en el Historial de
  Actividad.
- Nota visible: bloque "📝 Cambios del sueldo del operador" en el detalle (motivo, de → a, quién y cuándo).
- Si la operación está en FALSO, el monto capturado es el FINAL (no se vuelve a partir a la mitad).
- Si la nómina ya se pagó (referencia de nómina), avisa antes de cambiar.

## Dónde
- Operaciones Activas → Detalle → Unidad y Operador.
- Servicios Completados → Detalle → Unidad y Operador.
- Formulario de la operación: el Sueldo Operador ya NO se escribe a mano — solo con "✎ Cambiar sueldo"
  (respeta el bloqueo por Autorizaciones). En una operación ya guardada se guarda al instante; en una nueva
  se guarda junto con la operación. El cambio manual no lo pisa el sueldo automático del convenio ni la
  regla del Trompo.

## Archivos
src/features/operaciones/components/CambioSueldoOperador.tsx + .css (nuevos)
src/features/operaciones/components/OperacionesDashboard.tsx
src/features/operaciones/components/ServiciosCompletados.tsx
src/features/operaciones/components/FormularioOperacion.tsx + .css
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint igual que antes (Formulario 376, Operaciones 125, Completados 163, nuevo 0); build OK.
