// functions/vitest.config.ts — ✅ V00436: pruebas de la lógica de las Cloud Functions
// (sin emulador: lógica pura y callables con un Firestore simulado).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
