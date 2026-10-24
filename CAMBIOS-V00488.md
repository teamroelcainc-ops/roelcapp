# V00488 — Facturación: el filtro de fechas del Historial reconoce cualquier formato de fecha

**Solo web.** Va encima de la V00487. Sin funciones, reglas, índices ni banderas.

## Qué pasaba
Al filtrar el Historial de Facturas por **Desde / Hasta**, se quedaban fuera, sin aviso, las facturas cuya fecha estaba guardada en un formato que la app no reconocía:
- fecha de Firebase (Timestamp);
- número de Excel (por ejemplo 46188);
- año de dos dígitos (15/06/26);
- mes con nombre (15 de junio de 2026, Jun 15, 2026).

Las fechas en texto tipo 15/06/2026 o 6/15/2026 ya se convertían al cargar, así que no eran la causa.

## Qué cambia
- Esas fechas se reconocen: la tabla las muestra bien y entran en el filtro, en los conteos y en el Excel exportado (Clientes y Proveedores).
- Las facturas **sin fecha** siguen sin entrar en un rango de fechas, pero ahora un aviso junto a los filtros dice cuántas son ("⚠ N facturas sin fecha no entran en el rango"). Se corrigen en Editar factura.

## Pasos manuales
1. Exportar otra vez el reporte con el mismo rango y compararlo.
2. Si sale el aviso de facturas sin fecha, quitar las fechas del filtro, buscarlas y capturarles la fecha.

## Técnico
- `features/facturacion/selectores.ts`: `parseFechaFactura` (Timestamp/Date/{seconds}, serial de Excel y epoch, "Timestamp(seconds=…)" como texto, D/M/AA, mes con nombre) y `fechaFacturaISO` (+ pruebas).
- `FacturacionClientesDashboard` / `FacturacionProveedoresDashboard`: los filtros de fechas usan `fechaFacturaISO`; aviso `sinFechaHist` (`fcd-aviso-sin-fecha` / `fpd-aviso-sin-fecha`).
