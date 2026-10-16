# V00458 — Otros Cruces: el puente viene en Caseta AVI y se puede cambiar

**Solo web** (deploy de hosting de siempre). Sin reglas, índices, banderas ni Cloud Functions.

## Qué cambia
- En **Referencias de Puentes → Otros Cruces → + Agregar cruce**, el **Puente** viene elegido en **Caseta AVI** (como en la V00457), pero ahora la lista trae **todos los puentes** del catálogo y se puede cambiar.
- Al cambiar el puente se pone el **monto** de ese puente (con su moneda) y la lista **Enviar a la referencia** muestra las referencias de ese puente (o *+ Crear referencia nueva* con su consecutivo: AVI-…, PT3-… o PTC-…). El cruce descuenta del saldo de ese puente.
- Cada vez que se abre el formulario vuelve a venir en Caseta AVI.

## Técnico
- `ReferenciasPuentesDashboard.tsx`: `otroPuenteElegido` (null = el predeterminado, `casetaAviOtrosCruces`); el select ya no está deshabilitado. Al cambiar: monto del catálogo y referencia en blanco (la lista depende del puente). Mismo guardado que antes (`upsertReferenciaAuto` en la referencia elegida).
- Banco de pruebas: al abrir viene Caseta AVI (23.75, Dólares, referencias AVI); al elegir Caseta Puente III cambia a 144 Pesos y referencias PT3; registrar guarda en la referencia PT3 con grupo PT3; al volver a abrir regresa a Caseta AVI. Sin errores de consola.

## Qué revisar con datos reales
1. *+ Agregar cruce*: viene Caseta AVI con su monto.
2. Cambia a otro puente: cambia el monto y salen sus referencias. Registra uno y revisa que esté en el Acumulado de ese puente.
