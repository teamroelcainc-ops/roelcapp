# V00421 — Carta de Instrucciones para todos · configurable · datos del cliente · Completados rápido

## 1. Servicios Completados lento
La consulta rápida (solo el rango de fechas) dependía de una marca guardada en CADA navegador; sin ella
se descargaban TODOS los completados. Ahora, con fecha inicio y fin, siempre se consulta solo ese rango.

## 2 y 3. Carta de Instrucciones
- Disponible en todas las operaciones (Logística Cruces, Transfer, Logística Fletes, Rentas), en Activas,
  Completados y Cancelados (antes solo Fletes).
- Botón "⚙ Carta" (Admin o rol con "Editar Formularios") → "¿Cuándo mostrar la Carta?":
  · En todas las operaciones (por defecto), o
  · Solo para los TIPOS de operación y/o DESTINOS (bodegas) marcados (se muestra si coincide el tipo O el destino).
  Se guarda para todos en config_documentos/cartaInstrucciones.
  (Prueba de Entrega sigue igual.)

## Contenido de la carta (mensaje del cliente)
- REFERENCIA CLIENTE resaltada junto a la Referencia Roelca.
- Bloque CLIENTE: Cliente Paga, Cliente Mercancía, Ref. Cliente.
- ORIGEN (donde se engancha) y DESTINO (donde se entrega).
- Franja amarilla: Descripción de mercancía · BULTOS (cantidad + embalaje).

## Archivos
src/utils/configCartaInstrucciones.ts (nuevo), src/features/operaciones/components/ConfigCartaModal.tsx + .css (nuevos)
src/utils/docPorId.ts (nombreEmpresaPdf), src/utils/pdfGenerator.ts
src/features/operaciones/components/{OperacionesDashboard, ServiciosCompletados, ServiciosCancelados}.tsx
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Firestore: colección nueva `config_documentos` (lectura para todos, escritura para quien edita formularios).
Verificación: tsc 0; eslint igual que antes; build OK.
