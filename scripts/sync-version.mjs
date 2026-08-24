// scripts/sync-version.mjs — ✅ V00126: se ejecuta en `prebuild` (local y Cloudflare).
//   Copia APP_VERSION de src/config/version.ts a public/version.json para que la
//   campana de "nueva versión" (App.tsx consulta /version.json) se encienda en
//   cada deploy. Antes version.json se quedaba rezagado (V00105) y nunca avisaba.
import { sincronizarJson } from './version-utils.mjs';
const v = sincronizarJson();
console.log(`[version] public/version.json sincronizado → ${v}`);
