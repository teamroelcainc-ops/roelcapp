// vitest.config.ts — ✅ V00436 (Fase 0): pruebas de lógica pura y de componentes.
// Separado de vite.config.ts para no cargar la PWA en las pruebas.
// · Lógica pura (src/shared/dominio, utils, services): entorno node.
// · Componentes: agregar `// @vitest-environment jsdom` al inicio del archivo de prueba.
// · Las reglas de seguridad tienen su propia config (vitest.rules.config.ts) porque
//   necesitan el emulador de Firestore.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
    environment: 'node',
  },
});
