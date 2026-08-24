// scripts/bump-version.mjs — ✅ V00126: incrementa la versión en 1 (V00126 → V00127)
//   y sincroniza public/version.json. Lo ejecuta el hook pre-commit en cada commit
//   (cualquier cambio, por mínimo que sea, sube la versión) o manualmente con
//   `npm run version:bump`.
import { leerVersion, escribirVersion, incrementar } from './version-utils.mjs';
const actual = leerVersion();
const nueva = incrementar(actual);
escribirVersion(nueva);
console.log(`[version] ${actual} → ${nueva}`);
