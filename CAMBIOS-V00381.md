# V00381 — Control de saldos de puentes + documentos de factura visibles

## Saldos de Puentes (rediseño de la vista; la lógica de cuentas no cambia)
- Sin íconos caricatura en títulos, botones, conceptos, alertas ni reporte.
- Paleta sobria (grafito + azul de acento); el color solo significa algo:
  verde = abono, rojo = cargo / crítico / sobregiro, ámbar = saldo bajo.
- Letras más grandes y de alto contraste, cifras con dígitos tabulares.
- Resumen por moneda: Disponible grande + Recargado · Consumido · Hoy (cruces y monto).
- NUEVA tabla "Control de saldos por puente": tarifa, recargado, # cruces, consumido,
  disponible, "alcanza para N cruces" y Estado (Correcto / Saldo bajo / Crítico / Sobregirado).
  Clic en la fila abre su libro.
- Libro: 4 indicadores, aviso según estado, filtros Desde/Hasta/Tipo, conteo,
  totales del filtro en el pie y "Exportar Excel" del libro.
- Historial por moneda con columnas Tipo y Puente.

## Facturación Clientes y Proveedores
- Componente NUEVO TarjetaDocumentoFactura (.tsx/.css):
  verde "Documento cargado" (nombre, fecha, quién, Ver documento / Reemplazar),
  azul "Listo para subir" (nombre, tamaño, cuándo se sube, Cambiar / Quitar),
  ámbar "Sin documento" (Subir documento).
- Ficha de Factura: la tarjeta va en el cuerpo (antes era un chip chico en el encabezado);
  al subir desde la ficha se actualiza al instante.
- Confirmar Factura y Editar Factura: misma tarjeta.
- Fila de la tabla: píldora "Doc ✓" verde / "Sin doc" ámbar (sin emojis).
- Clic en cualquier parte de la fila abre la Ficha (los botones de la fila siguen igual).

## Archivos
- src/features/saldosPuentes/components/SaldosPuentesDashboard.tsx + .css
- NUEVOS src/features/facturacion/components/TarjetaDocumentoFactura.tsx + .css
- src/features/facturacion/components/FacturacionClientesDashboard.tsx
- src/features/facturacion/components/FacturacionProveedoresDashboard.tsx
- src/config/historialCambios.ts, public/version.json

Verificación: tsc 0; eslint Clientes 308 y Proveedores 335 (idénticos a la base),
Saldos y Tarjeta en 0; build OK.
