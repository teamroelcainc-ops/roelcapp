# V00326 — Reglas "AGREGAR sí, EDITAR no" en Autorizaciones (ej. la Moneda de Empresas)

## Archivos que cambian (respetar rutas)
- `src/features/autorizaciones/autorizaciones.ts`
- `src/features/autorizaciones/useAutorizacionesCampos.ts`
- `src/features/autorizaciones/components/AutorizacionesDashboard.tsx`
- `src/features/empresas/components/FormularioEmpresa.tsx`
- `src/features/vencimientos/ReporteVencimientosDashboard.tsx`
- `src/config/version.ts` + `public/version.json` — V00326.

## 1) Los tres apartados del Reporte de Vencimiento — YA bajo Autorizaciones
Confirmado desde V00325: las TRES pestañas (Vencidos y por vencer, Sin
fechas, Documentos sin clasificar) escriben por los mismos cuatro caminos
y TODOS pasan por Autorizaciones: cambiar tipo de documento, editar
fechas, el check de vencimiento, reclasificar y el editor de documento.

## 2) NUEVO matiz por campo: "Agregar libre"
Las reglas siempre fueron de crear / editar / borrar. Ahora cada CAMPO
controlado tiene además el botón "Agregar libre" en el configurador:
- ✓ Agregar libre → capturar el PRIMER valor del campo NO requiere
  autorización (campo vacío → valor); CAMBIARLO después SÍ.
- Sin marcar → el campo se controla siempre (como hasta hoy).

**El caso que pediste — Moneda de Empresas**: entra a Autorizaciones →
módulo "Empresas" → marca el campo "Moneda" y actívale "Agregar libre".
Resultado: al CREAR la empresa cualquiera captura la moneda; una vez
guardada, el campo queda BLOQUEADO en el formulario (candado con opción
de "Solicitar autorización" temporal, como los demás campos controlados).

Aplica a cualquier campo de cualquier módulo integrado — también a las
fechas del Reporte de Vencimiento (llenar una fecha vacía puede quedar
libre y corregirla requerir aprobación).

## Detalle técnico
- `ReglaAut.soloEditar` + `evaluarAutorizacion(..., valoresAnteriores)`:
  con el matiz activo, un campo cuyo valor anterior está vacío no exige
  autorización. Sin información de valores anteriores, la regla se aplica
  completa (conservador). Compatibilidad total con las llamadas actuales.
- El hook `useAutorizacionesCampos` recibe los valores del registro
  abierto (`setValoresActuales`) — el FormularioEmpresa ya se los pasa.

## Verificación
- `tsc --noEmit` ✓ · eslint: los 5 archivos en sus baselines exactos
  (nada nuevo) · `npm run build` completo ✓

## Al instalar
Reemplaza los 5 archivos + versión, `npm run build` y publica. Luego
configura el caso de la Moneda en Autorizaciones → Empresas.
