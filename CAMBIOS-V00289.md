# V00289 — Formulario de tarifa ancho, moneda desplegable, sin desbordes y "Sincronizar convenios"

## Archivos que cambian (respetar rutas)
- `src/features/tarifarioClientes/components/TarifarioClientesDashboard.tsx` y `.css`
- `src/features/tarifarioProveedores/components/TarifarioProveedoresDashboard.tsx` y `.css`
- `src/config/version.ts` y `public/version.json` — bump a V00289.

## 1) "Cotizado En" vuelve a ser lista desplegable
Select con "Selecciona una moneda" / USD / MXN (obligatoria, como siempre).
Tarifa (catálogo) y Status siguen siendo campos de búsqueda.

## 2) Formulario más ancho
El modal de Agregar/Editar tarifa pasa de 560px a 900px (o el 94% de la
pantalla en monitores chicos) — las 3 columnas respiran.

## 3-4) El modal del tarifario ya no se desborda
Aplica a Nuevo Tarifario Y a Editar Tarifario (que es el mismo modal del
pre convenio): ahora tiene tope del 92% de la altura de la pantalla con
scroll interno — con un cliente de 15 tarifas la lista se recorre dentro
del modal en vez de salirse de la pantalla.

## 5) El ✏ trae la tarifa AL INSTANTE
Al abrir la edición de una línea, la descripción de la tarifa se toma de
LA PROPIA LÍNEA (viaja con el registro, sin esperar el catálogo). Antes el
campo dependía de encontrar el id en el catálogo: si la línea era migrada
(sin tarifaReferenciaId) o el catálogo aún cargaba, se veía vacío.

## 6) Líneas sin # de convenio — botón "⟳ Sincronizar convenios"
En la ficha del pre convenio (junto a + Agregar tarifa). Para cada línea
SIN consecutivo: (1) busca su detalle equivalente en Convenios (mismo
convenio, misma tarifa del catálogo y mismo monto) y ADOPTA su CONV-###,
alineando status y tarifarioId; (2) si no existe y el tarifario ya tiene
convenio, CREA el detalle con consecutivo nuevo. Al terminar dice cuántas
ligó y cuántas creó. Junto con el motor relacional v1.2 (que sincroniza
las que SÍ tienen consecutivo en cada escritura), lo del tarifario y lo de
Convenios queda igual, tal cual, en ambos sentidos.

## Verificación
- `tsc --noEmit`: 0 errores. ESLint: ambos tarifarios 0. `style={{`: 0.
- `npm run build`: OK (PWA generada).
