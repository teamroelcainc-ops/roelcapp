# V00288 — Formulario de tarifa a 3 columnas con listas de búsqueda, clics corregidos y cliente no editable a mano

## Archivos que cambian (respetar rutas)
- `src/features/tarifarioClientes/components/TarifarioClientesDashboard.tsx` y `.css`
- `src/features/tarifarioProveedores/components/TarifarioProveedoresDashboard.tsx` y `.css`
- `src/config/version.ts` y `public/version.json` — bump a V00288.

## 1) Tres columnas
El formulario de Agregar/Editar tarifa quedó en cuadrícula de 3 columnas.

## 2) Listas de BÚSQUEDA en lugar de desplegables
Tarifa (catálogo), Cotizado En y Status ahora son campos con búsqueda
(escribe y filtra, igual que Origen/Destino): al empezar a escribir
aparecen las coincidencias y al elegir la tarifa se precargan Origen y
Destino. Si el status escrito no es de la lista, el guardado lo avisa;
la moneda sigue validándose como USD/MXN.

## 3) El ✏ de la fila ya no dispara el "¿Seguro que quieres salir?"
Dos candados: el clic de ✏ y 🗑 ya no burbujea (stopPropagation), y el
fondo del formulario solo pregunta cuando el clic empieza y termina
DIRECTO sobre el fondo (e.target === e.currentTarget) — nunca por un clic
que venga de un botón interior.

## 4) El nombre del cliente NO se edita a mano en el tarifario
En "Editar Tarifario" (clientes Y proveedores) el nombre queda de SOLO
LECTURA — es la razón social de Empresas. Para cambiar de cliente/
proveedor está el botón **Cambiar**, que abre la lista de búsqueda: solo
se puede ELEGIR una empresa, nunca escribir un nombre libre. Si se elige
otra, la cabecera guarda la relación real (clienteId/proveedorId + razón
social) al presionar Guardar cambios.

## Verificación
- `tsc --noEmit`: 0 errores. ESLint: ambos tarifarios 0. `style={{`: 0.
- `npm run build`: OK (PWA generada).
