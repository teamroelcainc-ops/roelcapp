import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// ✅ V00439 (Fase 3.8): los catálogos se leen por la capa de datos compartida
//   (src/shared/data/catalogos.ts), nunca con getDocs/onSnapshot de la colección
//   completa en un módulo. Los casos que quedan (rutas de escritura que necesitan
//   el id real del documento) están contados en scripts/lint-baseline.json.
const CATALOGOS_REGEX = '^(catalogo_[a-z_]+|empresas|empleados|unidades|remolques|unidades_proveedor|proveedores_unidad|direcciones|convenios_clientes|convenios_clientes_detalles|convenios_proveedores|convenios_proveedores_detalles|tarifario_clientes|tarifario_proveedores|tarifas_gastos_incluidos|tarifas_rendimiento|tipo_cambio|config_flujos_operacion|roles)$'

export default defineConfig([
  globalIgnores(['dist', 'functions/lib']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/shared/data/**'],
    rules: {
      'no-restricted-syntax': ['warn', {
        selector: `CallExpression[callee.name=/^(getDocs|onSnapshot)$/] > CallExpression[callee.name='collection'] > Literal[value=/${CATALOGOS_REGEX}/]`,
        message: 'Catálogo completo: usa useCatalogo/useCatalogos/obtenerCatalogo de src/shared/data/catalogos.ts.',
      }],
    },
  },
])
