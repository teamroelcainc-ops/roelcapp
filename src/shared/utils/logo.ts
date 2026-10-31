// src/shared/utils/logo.ts
// ---------------------------------------------------------------------------
// ✅ V00534 — EL LOGO DE ROELCA COMO ARCHIVO (public/), NO EN BASE64 DENTRO DEL CÓDIGO. Antes el
// inicio de sesión importaba LOGO_DEFAULT de utils/pdfGenerator.ts (un PNG en base64 de 140 KB) y eso
// metía todo pdfGenerator en la carga de arranque. Ahora:
//   · la pantalla usa la ruta (`<img src={RUTA_LOGO_ROELCA}>`);
//   · un PDF o un Excel lo convierte a dataURL al generarse (cargarLogoDataUrl / logoComoDataUrl),
//     una sola vez por archivo;
//   · las plantillas que se arman sin esperar (síncronas) usan logoPdfPorDefecto(): el dataURL si ya
//     se convirtió, o la URL completa del archivo (mismo origen: html2canvas y las ventanas de
//     impresión la cargan igual).
// También vive aquí el logo "registrado" (setLogoPdf/getLogoPdf: el de la configuración de la empresa),
// para que una pantalla no importe pdfGenerator solo por eso.
// ---------------------------------------------------------------------------

/** Logo grande (400×343): PDF de operaciones, reportes, tarifarios, nómina, mantenimiento, login. */
export const RUTA_LOGO_ROELCA = '/logo-roelca.png';
/** Logo chico (225×172): Excel profesional de Facturación, Remisión y documentos de proveedor. */
export const RUTA_LOGO_ROELCA_CHICO = '/logo-roelca-chico.png';

/** La URL completa de un archivo de la app (una ventana de impresión abierta con document.write no resuelve rutas relativas). */
export const urlCompleta = (ruta: string): string =>
  (typeof window === 'undefined' ? ruta : new URL(ruta, window.location.origin).href);

/**
 * Descarga una imagen y la devuelve como dataURL (base64) para incrustarla en un PDF o Excel.
 * null si no hay URL o falla la descarga (el documento sale sin logo en lugar de un recuadro roto).
 */
export const cargarLogoDataUrl = async (logoUrl?: string | null): Promise<string | null> => {
  if (!logoUrl) return null;
  try {
    const respuesta = await fetch(logoUrl, { mode: 'cors' });
    if (!respuesta.ok) return null;
    const blob = await respuesta.blob();
    return await new Promise<string>((resolve, reject) => {
      const lector = new FileReader();
      lector.onloadend = () => resolve(lector.result as string);
      lector.onerror = reject;
      lector.readAsDataURL(blob);
    });
  } catch (error) {
    console.warn('No se pudo cargar el logo para el documento:', error);
    return null;
  }
};

const enCurso = new Map<string, Promise<string | null>>();
const listos = new Map<string, string>();

/** El logo de un archivo de la app como dataURL, convertido una sola vez (si falla, se reintenta la próxima). */
export const logoComoDataUrl = (ruta: string): Promise<string | null> => {
  const previo = enCurso.get(ruta);
  if (previo) return previo;
  const promesa = cargarLogoDataUrl(urlCompleta(ruta)).then((dataUrl) => {
    if (dataUrl) listos.set(ruta, dataUrl);
    else enCurso.delete(ruta);
    return dataUrl;
  });
  enCurso.set(ruta, promesa);
  return promesa;
};

/** Empieza a convertir los dos logos (se llama después de pintar la app: no retrasa el arranque). */
export const precargarLogosRoelca = (): void => {
  void logoComoDataUrl(RUTA_LOGO_ROELCA);
  void logoComoDataUrl(RUTA_LOGO_ROELCA_CHICO);
};

/** Para plantillas síncronas: el dataURL si ya está listo; si no, la URL completa del archivo. */
export const logoListo = (ruta: string): string => listos.get(ruta) ?? urlCompleta(ruta);

// ── Logo registrado (el de la configuración de la empresa) ──────────────────
let logoRegistrado = '';

/** Registra el logo (idealmente un dataURL base64) que usarán todos los PDF. */
export const setLogoPdf = (logo?: string | null): void => {
  logoRegistrado = logo || '';
};

/** El logo registrado ('' si no hay). */
export const getLogoPdf = (): string => logoRegistrado;

/** El logo de un PDF: el registrado y, si no hay, el de Roelca (dataURL si ya está listo). */
export const logoPdfPorDefecto = (): string => logoRegistrado || logoListo(RUTA_LOGO_ROELCA);
