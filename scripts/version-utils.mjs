// scripts/version-utils.mjs — ✅ V00126: utilidades de versión (ESM, sin dependencias)
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const RUTA_VERSION_TS = resolve(raiz, 'src/config/version.ts');
export const RUTA_VERSION_JSON = resolve(raiz, 'public/version.json');

export const leerVersion = () => {
  const ts = readFileSync(RUTA_VERSION_TS, 'utf8');
  const m = ts.match(/APP_VERSION\s*=\s*'([^']+)'/);
  if (!m) throw new Error('No se encontró APP_VERSION en src/config/version.ts');
  return m[1];
};

export const escribirVersion = (nueva) => {
  const ts = readFileSync(RUTA_VERSION_TS, 'utf8').replace(/APP_VERSION\s*=\s*'[^']+'/, `APP_VERSION = '${nueva}'`);
  writeFileSync(RUTA_VERSION_TS, ts);
  sincronizarJson(nueva);
};

export const sincronizarJson = (version = leerVersion()) => {
  writeFileSync(RUTA_VERSION_JSON, JSON.stringify({ version, publicadaEn: new Date().toISOString() }) + '\n');
  return version;
};

export const incrementar = (v) => {
  const m = String(v).match(/^([A-Za-z]*)(\d+)$/);
  if (!m) throw new Error(`Formato de versión no reconocido: ${v}`);
  const n = String(parseInt(m[2], 10) + 1).padStart(m[2].length, '0');
  return `${m[1]}${n}`;
};
