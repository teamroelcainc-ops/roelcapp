# V00255 — Estadísticas: el C/V (Hazmat, Trompo, etc.) se deriva del convenio

## Archivos que cambian (respetar rutas)
- `src/features/estadisticas/components/EstadisticasOperativas.tsx`
- `src/features/estadisticas/components/EstadisticasDashboard.tsx`
- `src/config/version.ts` y `public/version.json` — bump a V00255.

## El hallazgo (con tu Excel en mano)
"Hazmat" casi nunca vive en el campo C/V de la operación: vive dentro del
NOMBRE DEL CONVENIO, que se arma como
"Tipo de Operación - Tipo de Remolque - C/V - Aduana"
(p. ej. "Cruce de Importacion - Caja - Hazmat - 800 Colombia").
Por eso el Excel de Servicios Completados sí las muestra (exporta la
descripción del convenio tal cual) y Estadísticas solo contaba las ~38 que
además traían el campo `carga` = "Hazmat" capturado directo.

## El arreglo
Cuando la operación no trae C/V propio (o trae "N/A"), ahora se DERIVA del
nombre del convenio: se recorren sus segmentos de derecha a izquierda
comparándolos contra el catálogo Cargada/Vacía, y el que coincida es el C/V.
Aplica en:
- La pestaña Diario · Semanal · Mensual · Clientes (filtros y matriz
  Tipo × C/V).
- La dimensión C/V del Desglose del Dashboard (mismo derivador).

## Validado contra tu Excel (7,546 filas)
Simulé la lógica nueva sobre el archivo exportado:
Cargado 5,347 · Vacio 1,279 · Hazmat 485 · Trompo 209 · Falso 178 · N/A 48.
Hazmat por mes: Ene 49, Feb 59, Mar 71, Abr 68, May 61, Jun 58, Jul 50,
Ago 46, Sep 23 — TODOS los meses cuentan. (En la app el total puede variar
unas unidades respecto a tu 464 según los filtros del rango, porque además
se suman las que sí traen el campo directo.)

## Verificación
- `tsc --noEmit`: 0 errores.
- ESLint: mismos problemas preexistentes (Operativas 5, Dashboard 32).
- `npm run build`: OK (PWA generada).
