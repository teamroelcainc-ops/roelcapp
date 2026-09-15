# V00250 — Tarifarios: logo CTPAT, descarga directa y base relacional

## Archivos que cambian (respetar rutas)
- `src/utils/logoCtpat.ts` **(NUEVO)** — logo CTPAT incrustado en base64 (`LOGO_CTPAT_B64`).
- `src/features/tarifarioClientes/components/TarifarioClientesDashboard.tsx`
- `src/features/tarifarioProveedores/components/TarifarioProveedoresDashboard.tsx`
- `src/features/catalogos/components/CatalogosDashboard.tsx`
- `src/config/version.ts` y `public/version.json` — bump a V00250.

## 1) Logo CTPAT al pie del tarifario
- El texto "CTPAT™" se sustituyó por el logo, centrado DEBAJO del recuadro de
  "NOMBRE, FIRMA Y SELLO DE ACEPTACION DE TARIFAS" (donde marcaste el recuadro rojo).
- Aplica a Tarifario Clientes y Tarifario Proveedores.
- El PNG va aplanado sobre blanco (lección V00247: html2canvas pinta de negro la transparencia).
- Es una recreación del wordmark; para usar el logo oficial "CTPAT Partner" de CBP,
  solo hay que reemplazar la cadena base64 en `src/utils/logoCtpat.ts`.

## 2) Descarga directa (como Operaciones)
- `exportarPDF` ya NO abre ventana ni diálogo de impresora: un clic descarga
  `TARIFAS_<NOMBRE>_<AÑO>.pdf` directo (html2pdf + div temporal fuera de pantalla
  + espera de imágenes, la misma técnica de pdfGenerator).
- Los estilos del PDF ahora van con prefijo `#tarifario-pdf-hoja` para no
  contaminar la app (el HTML se monta momentáneamente en el propio documento).

## 3) Base más relacional (Catálogos)
- El núcleo del botón "⟳ Rearmar descripciones" se extrajo a
  `propagarDescripcionesTarifas()` y ahora también propaga a
  **tarifario_proveedores** (antes solo clientes).
- Al GUARDAR una edición en Tarifas de Referencia o en sus catálogos fuente
  (Tipos de Servicios, Tipo de Remolque, C/V, Aduanas) con cambio de nombre,
  la cascada corre SOLA y en silencio: catálogo → Detalles del Convenio
  (clientes y proveedores) → Tarifario Clientes → Tarifario Proveedores →
  Operaciones. Ya no hay que presionar el botón.
- El botón manual sigue disponible para normalizaciones masivas.
- Nota: la cascada lee las colecciones completas al ejecutarse (igual que el
  botón). Es una acción de edición puntual, aceptable en lecturas de Firebase.

## Verificación
- `tsc --noEmit`: 0 errores.
- ESLint: tarifarios y logoCtpat en 0; CatalogosDashboard con los mismos 113
  problemas preexistentes del original (ninguno nuevo).
- `grep "style={{"`: sin inline styles nuevos.
- `npm run build`: OK (PWA generada). En Linux hubo que instalar los binarios
  nativos de rollup/esbuild porque los node_modules del 7z son de Windows —
  en tu máquina no aplica.
