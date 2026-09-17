# V00269 — Empresas ↔ Operaciones: conteo por ROL exacto, referencias consistentes y editar rápido

## Archivos que cambian (respetar rutas)
- `src/features/empresas/components/EmpresasDashboard.tsx` y `.css`
- `src/features/empresas/components/FormularioEmpresa.tsx`
- `src/config/version.ts` y `public/version.json` — bump a V00269.

## 1) Cantidad de operaciones DESGLOSADA POR ROL, al momento
Al abrir el detalle de una empresa, la pestaña de Referencias muestra
píldoras con el conteo EXACTO por rol, directo del servidor en ese
instante (sin caché): Cliente (Paga): N · Cliente (Mercancía): N ·
Prov. Servicios: N · Prov. Unidad: N · Origen: N · Destino: N.
Se cuentan tanto las operaciones que guardan la empresa por ID como las
MIGRADAS que la guardan por NOMBRE — la relación completa.

## 2) "Referencias (2)" y no había ninguna — corregido de raíz
La causa: el contador venía de un mapa cacheado 15 min que contaba ids y
nombres mezclados, y la lista consultaba solo por id (máx. 15). Ahora el
número del tab "Referencias (N)" y la lista salen de la MISMA consulta:
el N es la suma de los conteos exactos por rol, y la lista trae hasta 50
operaciones recientes por rol buscando por id Y por nombre. Si dice 2,
hay 2. La celda "CANTIDAD DE OPERACIONES" de la tabla también resuelve
los nombres migrados al id de la empresa (mismo criterio) y su caché
bajó de 15 a 5 minutos.

## 3) Editar / detalle instantáneos
El formulario esperaba TODAS sus colecciones desde cero en cada apertura
(por eso los selects salían vacíos unos segundos y "la información no
estaba"). Ahora régimen fiscal, direcciones, tipos de factura, tipos de
empresa/servicio y monedas se SIEMBRAN al instante desde el caché del
módulo y el snapshot en vivo los refresca por detrás: la primera
apertura carga igual que siempre; a partir de la segunda, todo pinta de
inmediato. El detalle ya venía instantáneo (usa la fila) y ahora sus
conteos llegan exactos.

## Verificación
- `tsc --noEmit`: 0 errores. ESLint: EmpresasDashboard 72 y
  FormularioEmpresa 21 — idénticos a la entrega anterior.
- `npm run build`: OK (PWA generada).

## Nota relacional
Este es el mismo principio del motor V00266 aplicado a la lectura: la
relación Empresas ↔ Operaciones se consulta contra la base real (id +
nombre migrado), no contra copias cacheadas con criterios distintos.
Pendiente que confirmes el deploy de los 4 triggers (Eventarc) y sigue
abierta la pregunta del catálogo de "Servicios Ofrecidos" para cerrar
la tarea 3 del formulario relacional.
