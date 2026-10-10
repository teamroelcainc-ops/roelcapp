# V00436 — Fase 0: línea base y red de seguridad (sin cambios visibles)

## Qué se agregó
- **CLAUDE.md** (reglas del repo) y **code-notes.md** (decisiones) y **PLAN-REFACTOR.md** (pasos en producción).
- **Medidor de lecturas** (solo desarrollo): `npm run dev:medir` cambia `firebase/firestore` por
  `src/shared/data/medidor/firestoreMedido.ts`, que cuenta documentos por colección, por módulo y por acción.
  En la consola: `__lecturas.marcar('Abrir Facturación')`, `__lecturas.tabla()`, `__lecturas.acciones()`,
  `__lecturas.listeners()`. En producción no existe.
- **Reglas e índices en el repo**: `firestore.rules`, `storage.rules`, `firestore.indexes.json` (los de la app
  móvil, V00435) declarados en `firebase.json`, más la configuración de emuladores.
  ⚠ Desde esta versión **no corras `firebase deploy` sin `--only`**: publicaría reglas e índices.
  Las funciones siguen igual: `firebase deploy --only functions`.
- **Pruebas**: `npm test` (vitest, lógica pura), `npm run test:rules` (reglas contra el emulador; requiere
  `npm i -g firebase-tools`), `npm --prefix functions test`.
- **Trinquete de ESLint**: `node scripts/verificar-lint.mjs` compara contra `scripts/lint-baseline.json`
  (91 archivos, 2,855 `any`): ningún archivo puede empeorar. `npm run verificar` = tsc + trinquete + pruebas.
- **Lógica pura compartida web ↔ functions**: `src/shared/dominio/` (constantes, moneda, fechas, números, texto) con
  copia generada en `functions/src/dominio/` (`node scripts/sincronizar-dominio.mjs`, corre sola al compilar functions).
- `.gitignore` ignora `.env` y `.env.*`; se agrega `.env.example`.

## Línea base de lecturas (estimada desde el código; N ≈ 7,500 operaciones, F ≈ 6,600 facturas)
La medición real se hace con `npm run dev:medir` siguiendo estas acciones; la estimación sale del análisis del código.

| Acción | Lecturas estimadas hoy |
|---|---|
| Abrir Facturación Clientes (sin caché) | ~14,000–15,000 (hasta 20k ops facturables + 12k facturas + empresas + pagos) |
| Abrir Facturación Proveedores | ~15,000–20,000 |
| Abrir FormularioOperacion | ~19 colecciones completas (9 getDocs + 6 listeners + direcciones/flujos/roles) |
| Abrir el modal de convenio en el formulario | N (~7,500: lee toda `operaciones`) |
| Abrir Detalles de Convenio | ≥ N |
| Marcar Verde/Completado | T + 3G + 7 en ~8 viajes secuenciales (T = tarifas_gastos_incluidos, G = catalogo_tipos_gastos) |
| Resumen del día | N + todas las referencias de diésel |
| Reportes por rango | N |
| Una tecla en el buscador superior | hasta 5 consultas (con Facturación montada) |
| Clic en una celda de Estadísticas | todas las facturas_* + todos los pagos |
| Admin con todos los módulos visitados | ~45 listeners vivos, ~25 sin límite |

## Verificación
- `tsc -b` ✔, trinquete ESLint ✔ (sin problemas nuevos), `vitest` ✔ (31 pruebas), `vite build` ✔.
- No probado en navegador: el medidor se probó con un SDK simulado (prueba unitaria) y compilando en modo `medir`.
