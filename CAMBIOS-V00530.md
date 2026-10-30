# V00530 — Facturación: subir el XML de la factura · ordenar Corregir · barra horizontal siempre visible

**Solo web.** Va encima de la V00529. Sin funciones, reglas, índices, banderas ni dependencias.

## 1. El XML de la factura no se podía subir
Estas cargas solo aceptaban **PDF o imagen**:
- **Subir documentos / Ver documentos** de la Ficha y de la fila del Historial (Documentos de la factura);
- **Archivos** de Generar factura;
- **Archivos** de Editar factura.

Pasa en Clientes y en Proveedores. Con eso:
- el XML (CFDI) **no aparecía** en la ventana para elegir archivos;
- si se arrastraba, salía "no es PDF ni imagen".

Ahora aceptan **PDF, XML o imagen**. La revisión del documento (V00514) ya sabía leer el XML, y la factura guarda el XML como un documento más.

En **Subir PDF y XML** (Asignar Operaciones) también cambia algo: si un XML no se puede cotejar por un dato raro, sale como problema de **ese archivo** y la ventana sigue funcionando.

## 2. Corregir se ordena por columna
- Clic en el nombre de una columna: de **menor a mayor** (▲).
- Otro clic: de **mayor a menor** (▼).
- Otro clic: **como estaba**.

Cómo ordena:
- Los importes se ordenan como números.
- Los folios y las referencias se ordenan en orden natural (I8650 antes que I8657).
- Los vacíos van al final.

La flecha ↕ indica que la columna se puede ordenar.

## 3. La barra horizontal siempre a la vista
- **Antes:** la barra para moverse a los lados estaba al final de la tabla y había que bajar hasta abajo.
- **Ahora:** se queda pegada **abajo de la pantalla** mientras se ve la tabla, y se mueve junto con la tabla. Con el trackpad o con Shift + rueda la tabla se sigue moviendo directo.
- Es un componente reutilizable, `ScrollHorizontalFijo`. Se puede poner en otras tablas anchas.

## Archivos (18)
- `src/shared/archivos/adjuntos.ts` y `adjuntos.test.ts`
- `src/shared/components/AdjuntosArchivos.tsx`
- `src/shared/components/ScrollHorizontalFijo.tsx` y `.css` (nuevos)
- `src/features/facturacion/services/ordenCorregir.ts` y `ordenCorregir.test.ts` (nuevos)
- `src/features/facturacion/components/CorregirTotalesFacturas.tsx` y `.css`
- `src/features/facturacion/components/DocumentosFacturaModal.tsx`
- `src/features/facturacion/components/SubirXmlModal.tsx`
- `src/features/facturacion/components/FacturacionClientesDashboard.tsx`
- `src/features/facturacion/components/FacturacionProveedoresDashboard.tsx`
- `src/config/version.ts`, `public/version.json`, `src/config/historialCambios.ts`, `code-notes.md`, `CAMBIOS-V00530.md`

## Pasos manuales
1. Aplica el zip encima de la V00529 (no hay archivos borrados) y haz el commit. El conteo debe dar **18**.
2. Publica la web.
3. Prueba:
   1. En la Ficha de una factura, **Subir documentos** → elige su PDF y su XML. Los dos se aceptan y abajo sale la revisión.
   2. En Corregir, clic en **Total** tres veces: ▲, ▼ y como estaba.
   3. La barra horizontal se ve abajo sin bajar hasta el final.
