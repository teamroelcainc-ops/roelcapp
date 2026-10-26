# V00497 — Facturación con la lista de facturas en vivo

**Solo web.** Va encima de la V00496. Sin funciones, reglas, índices ni banderas.

Corrige el punto 5 de la revisión de la V00495.

## Qué pasaba
- Facturación (Clientes y Proveedores) bajaba **todas** las facturas una sola vez, al entrar. En otra computadora con el módulo abierto desde ayer se veía la lista de ayer: una operación facturada hoy en otro lado seguía en "Pendientes" y se podía volver a facturar.
- Cada entrada costaba más de 12,000 lecturas por colección. Proveedores, además, bajaba otra vez todas las de clientes para el cruce, y Pagos y Estadísticas tenían su propia copia en vivo de las mismas facturas.

## Qué cambia
- `src/features/facturacion/hooks/useFacturasEnVivo.ts` (nuevo): Facturación usa el **mismo listener compartido** que Pagos y Estadísticas (`useColeccionViva('pagos:facturas_clientes' / 'pagos:facturas_proveedores')`). Lo usan Clientes, Proveedores y el cruce de Proveedores con las facturas de clientes.
- La lista está siempre al día: si otra persona crea, edita o borra una factura, se ve al momento y sus operaciones salen de "Pendientes" sin recargar.
- Lecturas: una sola carga para toda la app (con la caché del navegador) y después solo los cambios. En el simulador, con 12,510 facturas de clientes y 6,000 de proveedores:

| Entrar a | Antes | Ahora |
|---|---|---|
| Facturación Clientes | 12,510 | 12,510 |
| Facturación Proveedores | 18,510 | 6,000 |
| Pagos | 12,510 | 0 |
| Volver a Facturación Clientes | 0 | 0 |

- Lo que se acaba de guardar se sigue viendo al instante (parche local); en cuanto el listener trae la versión nueva, manda la del servidor. El parche nunca deja dos filas de la misma factura (con una escritura desde la web, el listener ya trae la factura nueva antes de que termine el guardado).
- Al entrar, el Historial y Pendientes muestran "Cargando…" hasta que el **servidor** confirma la lista. La caché del navegador puede tener solo una parte (por ejemplo, solo las facturas abiertas que usa Pagos) y con ella Pendientes saldría mal unos segundos. Sin conexión a internet se queda en "Cargando…" (antes salía un error).
- **Refrescar** / **↻ Actualizar** ahora solo vuelven a leer las operaciones. Las facturas ya se actualizan solas; si su conexión falló, Refrescar la reabre. Si falla, aparece un aviso.

## Pasos manuales
1. Aplicar el zip (no hay archivos borrados).
2. No hay que desplegar funciones.

## Técnico
- Se quitaron `descargarFacturas`, `recargarFacturas` y las cargas al entrar de los dos tableros (y la descarga del cruce en Proveedores). `descargarTodasLasFacturas` queda para quien la necesite fuera de React (Pagos → Unir duplicados usa `descargarFacturasComoVivas`).
- `setFacturasGlobales(prev => …)` sigue igual en cada acción; el hook guarda el parche con la versión del listener sobre la que se hizo y lo descarta con la siguiente (code-notes.md, V00497).
- En Proveedores, si una operación está en varias facturas de cliente, el cruce muestra la más reciente (antes la primera por id interno).
- Revisado por un agente independiente: se corrigieron la fila duplicada por el parche (que además hacía que "Editar" escribiera dos veces el mismo documento) y la caché parcial al entrar.
- Probado en el simulador: lecturas de la tabla; una factura creada desde "otra computadora" saca su operación de Pendientes y aparece en el Historial sin recargar; un cambio de total se ve en 70–600 ms; la prueba de la V00494 (facturas importadas, borrar el duplicado, formulario de una facturada) pasa igual.
- No probado contra Firestore real: el tiempo de la primera carga con la caché del navegador y el comportamiento con varias pestañas.
