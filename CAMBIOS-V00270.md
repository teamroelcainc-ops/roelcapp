# V00270 — Direcciones con USO relacional, Unidades con acciones en el detalle y Diagrama ER

## Archivos que cambian (respetar rutas)
- `src/features/direcciones/components/DireccionesDashboard.tsx` y `.css`
- `src/features/unidades/components/UnidadesDashboard.tsx` y `.css`
- `src/config/version.ts` y `public/version.json` — bump a V00270.
- **Aparte (no va en la app):** `Roelca-Diagrama-ER.html` — ábrelo con doble
  clic en cualquier navegador.

## 1) Directorio de Direcciones — columna "Uso (Empresas / Colab.)"
Cada dirección muestra 🏢 cuántas EMPRESAS la usan (como Dirección de
Facturación `direccionId` o en cualquiera de sus `direccionesPorTipo` del
V00268) y 👤 cuántos COLABORADORES pertenecen a esas empresas (contactos
por `id_cliente`). El tooltip lista las empresas. Caché de 5 minutos.
Las relaciones del directorio quedan confirmadas y vivas: paisId/estadoId/
municipioId/coloniaId/cpId/calleId → catálogos "Direcciones / …", con los
nombres como caché (la tabla ya prefiere nombre con respaldo del id).

## 2) Unidades Propias — igual que Empresas (V00267)
En la fila solo quedan ✏ Editar y 🗑 Eliminar. Los demás botones viven en
la cabecera del DETALLE de la unidad (clic en la fila): 📦 exportar
carpetas, 📄 ver documentos y ⬆ subir documento. Mismo comportamiento.

## 3) Diagrama Entidad-Relación (HTML + CSS puro)
`Roelca-Diagrama-ER.html`: mapa completo de colecciones agrupado por
dominio (Núcleo, Dinero, Tarifas y convenios, Catálogos, Directorio de
direcciones, Flota y personas, Motor relacional), con cada campo FK y a
qué colección apunta, las reglas vigentes (el convenio manda, moneda de
emisión, el ID es la verdad) y la tabla de cardinalidades al final.
Úsalo para auditar que todo esté conectado; cuando cambiemos el esquema
lo actualizo.

## Verificación
- `tsc --noEmit`: 0 errores. ESLint: Direcciones 9 (idéntico al original)
  y Unidades 38 (el original tenía 42 — BAJÓ al quitar hovers inline).
- `npm run build`: OK (PWA generada).

## Pendientes que siguen abiertos
- Confirmar el deploy de los 4 triggers (Eventarc) del V00266.
- ¿"Servicios Ofrecidos" = catalogo_tipo_servicio o catálogo nuevo?
