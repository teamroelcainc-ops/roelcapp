// src/utils/claveConsecutivo.ts
// ✅ V00425: el consecutivo de un convenio se guarda en formatos distintos según
//   quién lo escribió ("CONV-054", "054", 54). Para relacionar el TARIFARIO
//   (padre) con sus CONVENIOS (detalles) se compara SIEMPRE por su número.
export const claveConsecutivo = (v: unknown): string => {
  const n = String(v ?? '').replace(/\D/g, '').replace(/^0+/, '');
  return n || '';
};
export const mismoConsecutivo = (a: unknown, b: unknown): boolean => {
  const ka = claveConsecutivo(a);
  return !!ka && ka === claveConsecutivo(b);
};
