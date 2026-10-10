// src/shared/dominio/texto.ts — ✅ V00436: normalización de texto (una sola regla).
// Sin acentos, espacios colapsados, minúsculas. Es la misma regla que usaban
// por separado el motor relacional (normR), Operaciones (sinAcentosOD) y otros.

/** Quita acentos, colapsa espacios y pasa a minúsculas. */
export const normalizarTexto = (t: unknown): string =>
  String(t ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/** ¿Parece un ID de documento de Firestore/AppSheet (8+ caracteres hex o 20 alfanuméricos)? */
export const pareceId = (v: unknown): boolean => {
  const t = String(v ?? '').trim();
  if (!t) return false;
  return /^[0-9a-f]{8}$/i.test(t) || /^[A-Za-z0-9]{20}$/.test(t);
};
