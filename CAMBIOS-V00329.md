# V00329 — Módulo Historial de Cambios · fix: los inputs de texto ya no pierden el foco

## Archivos que cambian (respetar rutas)
- `src/App.tsx`
- `src/features/historialCambios/HistorialCambiosDashboard.tsx` y `.css` (NUEVOS — crear la carpeta)
- `src/features/empresas/components/FormularioEmpresa.tsx`
- `src/config/version.ts` + `public/version.json` — V00329.

## 1) 🕘 Historial de Cambios (informe para la gerencia)
Nuevo módulo en el menú (junto al Reporte de Vencimiento):
- Lista TODOS los cambios registrados del sistema con FECHA y HORA,
  versión, título y explicación en lenguaje cotidiano.
- Rango de fechas "De / a" + buscador (filtran el listado y el informe).
- Botón "📋 Copiar para WhatsApp": arma el informe del rango en lenguaje
  cotidiano (con negritas y emojis de WhatsApp) y lo deja en el
  portapapeles listo para pegar y enviar a la gerencia.
- Solo los Admin registran cambios: botón "➕ Registrar cambio" (fecha,
  hora, versión, título, explicación sencilla y detalle opcional) y
  "📥 Importación masiva" para pegar varios renglones de una vez con el
  formato: `fecha | versión | título | explicación`
  (ej. `2026-09-21 | V00327 | Campos bloqueados visibles | Ahora los campos que requieren autorización se ven con candado`).
- Los datos viven en la colección `historial_cambios` (compartidos y en
  vivo para todos).

**Para activarlo**: en Bases de Datos → Roles, asigna el módulo
"Historial de Cambios" a los roles que deben verlo (gerencia incluida).

## 2) Razón Social y demás inputs de texto — corregidos
El velo de Autorizaciones (V00327) envolvía los campos con un componente
definido DENTRO del formulario; React lo recreaba en cada tecla y el
input se remontaba: se perdía el foco/cursor al escribir. El velo ahora
vive fuera del componente (identidad estable) y los campos envueltos
(Razón Social, RFC, días/límite de crédito, selects) escriben normal,
conservando candado, "Agregar libre" y solicitudes tal cual.

## Verificación
- `tsc --noEmit` ✓ · eslint: App.tsx 72 = baseline exacto, formulario 21
  = baseline exacto, módulo nuevo en 0 · `npm run build` completo ✓

## Al instalar
Reemplaza los archivos + versión (crea `src/features/historialCambios/`),
`npm run build` y publica. Luego asigna el módulo en Roles.
