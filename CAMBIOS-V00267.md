# V00267 — Empresas (1 de 3): las acciones viven en el DETALLE de la empresa

## Archivos que cambian (respetar rutas)
- `src/features/empresas/components/EmpresasDashboard.tsx` y `.css`
- `src/config/version.ts` y `public/version.json` — bump a V00267.

## Qué hace
- En la FILA de la tabla solo quedan dos botones: ✏ Editar y 🗑 Eliminar.
  La tabla respira y se lee mucho mejor.
- Los demás botones se movieron a la cabecera del DETALLE de la empresa
  (clic en la fila → "Detalle de Empresa"), junto al de subir documentos
  que ya vivía ahí:
  · 💱 Actualizar moneda en todas partes
  · ✔ Dar de Alta / ⊘ Dar de Baja (según el estado)
  · 📦 Exportar carpetas de documentos
  · 📁 Carga masiva de documentos
  · ⬆ Subir documento (ya estaba)
  Todos hacen exactamente lo mismo que hacían en la fila.

## Pendientes de tu pedido (siguiente entrega, V00268)
2) DIRECCIONES MÚLTIPLES etiquetadas por tipo: "Dirección Cliente Paga",
   "Dirección Bodega", etc., con agregar varias por empresa.
3) FORMULARIO RELACIONAL — cada campo alimentado de su catálogo:
   Tipo(s) de Empresa ← "Tipo de Empresa" · Régimen Fiscal ← "Regimen
   Fiscal" · Moneda ← "Monedas" · Tipo de Factura ← "Tipo de Facturas" ·
   Dirección de Facturación ← Directorio de Direcciones.
   PREGUNTA para avanzar: "Servicios Ofrecidos" quedó sin catálogo en tu
   lista — ¿existe un catálogo para eso o lo creamos?

## Verificación
- `tsc --noEmit`: 0 errores. Sin `any` nuevos ni estilos inline nuevos
  (los botones nuevos usan clases con :hover, como marca el CLAUDE.md).
- `npm run build`: OK (PWA generada).
