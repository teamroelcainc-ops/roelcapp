# V00534 — Paso 1 del refactor: cada pantalla baja mucho menos la primera vez

**Solo web.** Va encima de la V00533 (tal como está en tu `main`). Sin funciones, reglas, índices, banderas ni dependencias.
**Tipo:** rendimiento. No cambia lo que se ve.

## Qué cambió y por qué
| Causa (auditoría) | Qué se hizo |
| --- | --- |
| 1. El login importaba el logo en base64 (140 KB) y con él todo `pdfGenerator.ts` | El logo es un archivo: `public/logo-roelca.png`. La pantalla usa la ruta y los PDF lo convierten a dataURL al generarse (`shared/utils/logo.ts`). `escaparHTML`/`escaparTextos` pasaron a `shared/utils/html.ts`; `pdfGenerator.ts` los reexporta. El logo chico que iba en base64 en el Excel de Facturación, la Remisión y los documentos de proveedor ahora es `public/logo-roelca-chico.png`. |
| 2. `xlsx` estático en 26 archivos | Todos usan `cargarXlsx()` (`shared/utils/excel.ts`) dentro del botón que exporta o lee. |
| 3. `html2pdf.js` estático en 8 archivos | Todos usan `cargarHtml2pdf()` (`shared/utils/pdf.ts`). pdf.js (leer PDF) también pasa por ahí (`cargarPdfjs`). |
| 4. `exceljs` estático en `exportarExcelProfesional.ts` | Usa `cargarExcelJS()`. `jszip` también se carga al armar el .zip (`shared/utils/zip.ts`). |
| 5. Formularios estáticos en Operaciones | `FormularioOperacion` (y lo que arrastra: Empresa, Empleado, Dirección, Unidad, Remolque, Costos adicionales…) se carga aparte en TODAS las pantallas que lo abren (`FormularioOperacionDiferido`). Se precarga en segundo plano después de pintar la pantalla (`usePrecargarAlPintar`), así ✎ sigue abriendo al instante. Los PDF de una operación cargan `pdfGenerator` al generarse (`utils/pdfOperacionDiferido.ts`). La Auditoría de Facturación Clientes y los Resúmenes diarios de Operaciones se cargan al abrirlos. |
| 6. `firebase/storage` en el arranque | `cargarStorage()` en `config/firebase.ts`, al subir o borrar un archivo; fuera de `manualChunks`. |
| 7. Precache completo | `globIgnores` para html2pdf, pdf.js, ExcelJS, xlsx y jszip, y `CacheFirst` cuando se usan. |
| 8. `App.tsx` estáticos | Mi Perfil, Reloj Checador y Mis documentos se cargan al abrirlos. Las tarjetas de casetas y diésel se dejaron estáticas (se ven en cuanto entras; ahorrarían ~7 KB). |

**Sin conexión:** generar un PDF o un Excel requiere haberlo hecho antes una vez con conexión en ese navegador (las librerías ya no se guardan al instalar la app; se guardan la primera vez que se usan).

## Medición (`node scripts/medir-pantallas.mjs`, KB gzip de la primera visita)
| Pantalla | Antes (V00533) | Ahora | Diferencia | Meta |
| --- | ---: | ---: | ---: | ---: |
| Arranque (login) | 391 | 260 | −34 % | ~276 |
| Operaciones Activas (inicio) | 699 | 333 | −52 % | ~375 |
| Servicios Completados | 557 | 344 | −38 % | ~373 |
| Facturación Clientes | 1,344 | 390 | −71 % | ~482 |
| Facturación Proveedores | 1,334 | 365 | −73 % | ~472 |
| Estadísticas | 970 | 315 | −67 % | ~372 |
| Empresas | 637 | 349 | −45 % | ~372 |
| Pagos | 428 | 301 | −30 % | ~313 |
| Precache del Service Worker | 7.87 MB (230) | 5.07 MB (257) | −2.80 MB | ~5.1 MB |

Repintados (`npm run medir:render`): iguales en cada acción; el arranque varía ±1 entre corridas, igual que antes.

## Archivos (76)
- Nuevos: `public/logo-roelca.png`, `public/logo-roelca-chico.png`, `scripts/medir-pantallas.mjs`, `refactor-progress.md`, `src/shared/utils/{excel,pdf,zip,logo,html}.ts`, `src/shared/hooks/usePrecargarAlPintar.ts`, `src/features/operaciones/components/FormularioOperacionDiferido.tsx`, `src/features/operaciones/services/cargarFormularioOperacion.ts`, `src/utils/pdfOperacionDiferido.ts` y sus pruebas.
- Cambiados: los 26 archivos con `xlsx`, los 8 con `html2pdf.js`, los que importaban el logo, `config/firebase.ts` y los 4 que usan Storage, las 9 pantallas que abren el formulario de operación, `App.tsx`, `vite.config.ts`, `CLAUDE.md` (la versión nueva que mandaste, con las líneas de este paso al día), `scripts/lint-baseline.json`, `code-notes.md`, versión e historial.
- Movimientos: ninguno (solo archivos nuevos en `src/shared/`).

## Pasos manuales
1. Aplica el zip encima de la V00533 (no hay archivos borrados). Como trae archivos fuera de `src`, agrega todo:
   `git add src public CAMBIOS-V00534.md code-notes.md CLAUDE.md refactor-progress.md scripts vite.config.ts`
   El conteo debe dar **76**.
2. Publica la web.

## Qué revisar en el navegador
1. **Login**: el logo se ve igual.
2. **Operaciones Activas**:
   - Abre una operación → **Check List**: el PDF se descarga con el logo.
   - **Nueva operación** y ✎ abren el formulario como siempre.
   - **Exportar a Excel** descarga el archivo.
3. **Servicios Completados / Cancelados**: ✎ abre el formulario; Solicitud de retiro o Check List bajan el PDF.
4. **Facturación Clientes**:
   - ✎ de una operación abre el formulario.
   - **🔍 Auditar** abre la auditoría.
   - Exportar el historial (Excel con logo) y la **Remisión** salen con el logo chico.
5. **Facturación Proveedores**: Confirmación de tarifa / Rate en PDF con logo; Exportar a Excel.
6. **Estadísticas**: un PDF y un Excel.
7. **Tarifarios** (Clientes y Proveedores): exportar el PDF; el logo se ve.
8. **Empresas / Empleados / Unidades**: "Estructura de carpetas" baja el .zip.
9. **Documentos**: subir un archivo a una operación y a la configuración de la empresa (Storage se carga al subir).
10. **Sin conexión** (opcional): con la app ya instalada, abre las pantallas sin red. Un PDF o Excel que ya generaste antes en ese navegador sale; uno nuevo pide conexión la primera vez.

## Lo que no pude probar en el navegador real
tsc, ESLint, Vitest y el build pasan. En el simulador (Firebase falso) probé: el formulario se precarga después de pintar y abre; Check List descarga el PDF; Exportar a Excel descarga el archivo; la Auditoría se carga al abrirla; los dos logos se sirven. **No probé:** Storage real (subir y borrar), el Service Worker real con su CacheFirst, ni cada uno de los ~40 botones de PDF y Excel. Revísalos con la lista de arriba.
