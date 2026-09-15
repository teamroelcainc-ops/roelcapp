# V00252 — Operaciones: clientes/proveedores de tarifarios siempre visibles + sin altas rápidas

## Archivos que cambian (respetar rutas)
- `src/features/operaciones/components/FormularioOperacion.tsx`
- `src/config/version.ts` y `public/version.json` — bump a V00252.

## 1) Cliente (Paga) / Proveedor (Transporte) — REGLA nueva
- ANTES el buscador exigía DOS cosas: tener el tipo de empresa correcto
  ("Cliente (Paga)" / "Proveedor (Transporte)" + status Activa) Y tener
  tarifario aprobado o detalle de convenio activo. Por eso Transportes Roal
  no salía aunque tuviera TARI-019 aprobado.
- AHORA basta con estar en su tarifario (aprobado) o tener un detalle de
  convenio activo: aparece SIEMPRE en la operación, tenga o no el tipo de
  empresa marcado. Aplica a ambos lados (cliente y proveedor).
- Respaldo adicional por NOMBRE: si el clienteId/proveedorId guardado en el
  tarifario no coincidiera con el doc de Empresas (datos migrados), la
  empresa se encuentra igual por su nombre.
- Nota: la empresa SÍ debe existir en Empresas (el formulario toma de ahí la
  moneda y demás datos). Si algún cliente siguiera sin salir, sería porque no
  existe en Empresas con ese nombre — avísame y lo revisamos.

## 2) Botones "+" de alta rápida retirados
- Se quitaron los 4 "+" de clientes y proveedores: Cliente (Paga),
  Cliente (Mercancía), Proveedor (Servicios) y Proveedor (Transporte).
  Ahora se dan de alta en Empresas / sus tarifarios.
- Se CONSERVARON los "+" que no son clientes/proveedores: Remolque,
  Origen, Destino, Operador, etc. Si también quieres quitar alguno de esos,
  me dices.

## Verificación
- `tsc --noEmit`: 0 errores.
- ESLint: 385 problemas, exactamente los mismos 385 preexistentes del
  original (ninguno nuevo; los `any` nuevos se tiparon).
- `grep "style={{"`: 27, igual que el original (sin inline styles nuevos).
- `npm run build`: OK (PWA generada).
