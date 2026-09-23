# V00343 — Razón Social capturable + el botón 🏷 ya corrige las tablas

## Archivos que cambian (respetar rutas)
- `src/features/empresas/components/FormularioEmpresa.tsx`
- `src/features/empresas/services/sincronizarRazonSocial.ts`
- `src/config/historialCambios.ts` + `src/config/version.ts` + `public/version.json` — V00343.

## Qué pasaba con Caro-Kar
"Caro-Kar Pesos" y "Caro-Kar Transportes" son DOS empresas en tu base, y
cada operación muestra el nombre de la empresa que tiene asignada.
Además, la tabla de Servicios Completados pinta un campo desnormalizado
distinto (`clienteNombre`) del que el botón escribía — por eso no
cambió nada.

## Qué cambia
1) **Campo "Razón Social" en la empresa** (Información General, bajo el
   nombre): el nombre que quieres ver en operaciones, facturación y
   pagos. Si se deja vacío, se usa el nombre normal.
2) **El botón 🏷 Razón social ahora también escribe `clienteNombre`**,
   el campo que pintan las tablas de Completados y Cancelados.

## Pasos para tu caso (1 minuto)
1. Instala esta versión.
2. Edita la empresa **"Caro-Kar Pesos"** → en "Razón Social" escribe
   **Caro-Kar Transportes** → Guardar.
3. En Empresas presiona **🏷 Razón social** y acepta.
Resultado: TODAS sus operaciones, facturas y pagos mostrarán
"Caro-Kar Transportes", sin perder la separación interna de la empresa
en pesos.

## Verificación
- `tsc --noEmit` ✓ · eslint: FormularioEmpresa 21 = baseline, servicio 0
  · `npm run build` ✓

## Al instalar
Reemplaza los archivos + versión, `npm run build` y publica.
