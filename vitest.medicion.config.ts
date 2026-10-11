// vitest.medicion.config.ts — ✅ V00446: solo la medición de repintados (`npm run medir:render`).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/__pruebas__/rendimiento.medicion.tsx'],
    environment: 'node',
    reporters: ['verbose'],
  },
});
