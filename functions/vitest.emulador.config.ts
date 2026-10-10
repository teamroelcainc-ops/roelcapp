// functions/vitest.emulador.config.ts — ✅ V00441 (Fase 5): pruebas de dinero contra el
// EMULADOR de Firestore (concurrencia real de transacciones). Se corren con
// `npm run test:emulador` (levanta el emulador con firebase-tools); sin emulador se saltan.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test-emulador/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60000,
    fileParallelism: false,
  },
});
