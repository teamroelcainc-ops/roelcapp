// vitest.rules.config.ts — ✅ V00436 (Fase 0): pruebas de firestore.rules contra el
// EMULADOR (nunca contra producción). Se corren con `npm run test:rules`, que
// levanta el emulador con firebase-tools (instalado global: npm i -g firebase-tools).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['firebase-tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
