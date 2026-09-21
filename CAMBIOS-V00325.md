# V00325 — El Reporte de Vencimiento queda BAJO el módulo de Autorizaciones

## Archivos que cambian (respetar rutas)
- `src/features/autorizaciones/autorizaciones.ts`
- `src/features/vencimientos/ReporteVencimientosDashboard.tsx` y `.css`
- `src/config/version.ts` + `public/version.json` — V00325.

## Qué cambia
Ya NO todos pueden cambiar documentos o fechas en el Reporte de
Vencimiento: todas sus ediciones pasan por el sistema de Autorizaciones.

1) **Nuevo módulo en Autorizaciones**: "Reporte de Vencimiento", con sus
   campos controlables: Tipo de documento, Carpeta/clasificación, Fecha
   de expedición, Fecha de vencimiento y Control de vencimiento (sí/no).
   Ahí configuras, por ROL, qué requiere aprobación (como en los demás
   módulos integrados).

2) **El reporte respeta esas reglas** en TODAS sus ediciones: cambiar el
   tipo de documento en la tabla, editar fechas de expedición o
   vencimiento, reclasificar documentos sin clasificar y el editor de
   documento:
   - Usuario AUTORIZADO (o admin) → guarda directo, como siempre.
   - Usuario NO autorizado → el cambio NO se aplica: se crea una
     SOLICITUD en Autorizaciones (con el valor anterior, el propuesto y
     el motivo) y se aplica solo cuando la aprueben. El usuario ve el
     aviso con la explicación.
   - Chip "🔒 Ediciones controladas por Autorizaciones" en el encabezado
     cuando hay reglas activas (los admin no lo ven).

## Para activarlo
Después de publicar, entra a Autorizaciones → módulo "Reporte de
Vencimiento" y define las reglas (qué roles requieren aprobación por
acción o por campo). Sin reglas configuradas, todo sigue como hoy.

## Verificación
- `tsc --noEmit` ✓ · eslint: reporte 11 = su baseline exacto;
  autorizaciones.ts 13 = su baseline exacto (nada nuevo) ·
  `npm run build` completo ✓

## Al instalar
Reemplaza los 3 archivos + versión, `npm run build` y publica.
