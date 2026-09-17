# V00277 — "Tarifario obligatorio" (Sí/No): la regla del documento firmado, por tarifario

## Archivos que cambian (respetar rutas)
- `src/features/tarifarioClientes/components/TarifarioClientesDashboard.tsx` y `.css`
- `src/features/tarifarioProveedores/components/TarifarioProveedoresDashboard.tsx`
- `src/config/version.ts` y `public/version.json` — bump a V00277.

## 1) El campo nuevo
En el formulario del tarifario (Nuevo y Editar), dentro del bloque
"Tarifario firmado", hay un selector **"Tarifario obligatorio": Sí / No**:
- **Sí** (el default): el candado del V00273 aplica — NO se puede aprobar
  sin el tarifario firmado (al intentar, ofrece subirlo y la aprobación
  continúa sola).
- **No**: se puede aprobar sin documento. El indicador de la fila y la
  ficha dejan de alarmar (📎 gris con "documento opcional" en vez de ⚠
  ámbar), aunque subirlo sigue disponible si se quiere.
El campo se guarda como `docObligatorio` en el tarifario y la etiqueta
del bloque cambia en vivo ("obligatorio para aprobar" / "opcional para
este tarifario"). Aplica a clientes Y proveedores.

## 2) Los registros existentes
Todos los tarifarios que NO traen el campo se tratan como **Sí**
automáticamente (sin migración de datos) — es decir, TODOS tus registros
actuales quedan obligatorios, como pediste. Para el **TARI-072**: ábrelo
con ✏ Editar, cambia "Tarifario obligatorio" a **No** y guarda — listo,
dos clics, y con eso podrá aprobarse sin el documento.

## Verificación
- `tsc --noEmit`: 0 errores. ESLint: AMBOS dashboards en 0 problemas.
  Sin estilos inline.
- `npm run build`: OK (PWA generada).
