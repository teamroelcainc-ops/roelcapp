# V00262 — Convenios: descripción con tarifa · Facturación: Empresas manda, monedas unificadas, buscador y modal de exportación

## Archivos que cambian (respetar rutas)
- `src/features/conveniosDetalles/components/DetallesConvenioDashboard.tsx`
- `src/features/facturacion/components/FacturacionClientesDashboard.tsx` y `.css`
- `src/config/version.ts` y `public/version.json` — bump a V00262.

## 1) Descripción (automática) del detalle del convenio
Nueva fórmula: **CONV-### - Tarifa (catálogo) - Origen - Destino**
(ej. "CONV-105 - Flete de Importacion - Plana - Cargado - Nuevo Laredo - Merida").
Antes llevaba el nombre del cliente; ahora lleva la TARIFA, que es lo que
distingue un convenio de otro dentro del mismo cliente. Aplica al crear,
al editar, al campo en vivo del modal y al botón "⟳ Rearmar nombres"
(córrelo UNA vez tras publicar para actualizar los guardados; propaga
también el nombre a las operaciones, como siempre).

## 2-5) Facturación de Clientes — EMPRESAS MANDA
- **Moneda**: la tabla y el Excel muestran la moneda del cliente EN
  EMPRESAS (respaldo: la guardada), siempre canónica.
- **Uniformidad**: solo existen DOS monedas — USD/DÓLARES/DOLARES →
  **Dólares**; MXN/PESOS → **Pesos** (como el catálogo Monedas).
- **Nombre del cliente**: el de Empresas (resuelto por id o por nombre).
- **Botón "⇄ Sincronizar con Empresas"** (barra del historial): recorre
  TODAS las facturas guardadas y escribe nombre + moneda canónica del
  cliente según Empresas (lotes de 400, resumen al final, no toca montos
  ni invoices, limpia cachés y recarga el historial). Córrelo UNA vez.

## 6) Buscador en la tabla
Input siempre visible en la barra del historial (invoice, cliente, CCP,
referencia, remolque…) — es el mismo criterio del panel de Filtros, ahora
a la vista sin abrir nada.

## 7) Exportar Excel con modal de columnas
"Exportar Excel" ahora abre el MISMO modal que Servicios Completados:
cuadrícula de 3 columnas, selección con checkbox y ORDEN por Drag & Drop
(con las columnas de facturación), botón "Columnas de la tabla" para
copiar la configuración actual, y Exportar genera el archivo con ese
orden (y con las referencias reales del V00260-V00261).

## Verificación
- `tsc --noEmit`: 0 errores. ESLint: 308 (idéntico a la entrega anterior)
  y DetallesConvenioDashboard en 0.
- `npm run build`: OK (PWA generada).
- Nota: los 2 botones nuevos de la barra usan el patrón btnDirStyle inline
  de esa barra (preexistente) por consistencia; buscador y modal van con
  clases CSS.

## Al publicar (una sola vez)
1. Convenio de Clientes → "⟳ Rearmar nombres" (nueva descripción).
2. Facturación → Historial → "⇄ Sincronizar con Empresas".
