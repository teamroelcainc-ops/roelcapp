// src/features/pagos/services/comprobante.ts
// ✅ V00450: reglas del comprobante de un pago (AdjuntoComprobante): tipo, tamaño y nombre legible.

export const MAX_MB_COMPROBANTE = 20;

export const esPdf = (nombre: string, tipo = ''): boolean => tipo === 'application/pdf' || /\.pdf($|\?)/i.test(nombre);
export const esImagen = (nombre: string, tipo = ''): boolean =>
  tipo.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|heic|heif)($|\?)/i.test(nombre);

export const tamanoLegible = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/** Mensaje si el archivo no se acepta; '' si está bien. */
export const validarComprobante = (f: Pick<File, 'name' | 'type' | 'size'>): string => {
  if (!esPdf(f.name, f.type) && !esImagen(f.name, f.type)) return `"${f.name}" no es PDF ni imagen.`;
  if (f.size > MAX_MB_COMPROBANTE * 1024 * 1024) return `"${f.name}" pesa ${tamanoLegible(f.size)}; el máximo es ${MAX_MB_COMPROBANTE} MB.`;
  return '';
};
