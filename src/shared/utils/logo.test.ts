// @vitest-environment jsdom
// ✅ V00534 — El logo como archivo: rutas, dataURL al generar y el logo registrado.
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

const respuestaPng = () => ({ ok: true, blob: async () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }) });

describe('logo.ts', () => {
  it('urlCompleta arma la URL con el origen de la app', async () => {
    const { urlCompleta, RUTA_LOGO_ROELCA } = await import('./logo');
    expect(urlCompleta(RUTA_LOGO_ROELCA)).toBe(`${window.location.origin}/logo-roelca.png`);
  });
  it('logoListo: la URL completa hasta que se convierte; después el dataURL (una sola descarga)', async () => {
    const fetchFalso = vi.fn(async () => respuestaPng());
    vi.stubGlobal('fetch', fetchFalso);
    const { logoListo, logoComoDataUrl, RUTA_LOGO_ROELCA } = await import('./logo');
    expect(logoListo(RUTA_LOGO_ROELCA)).toBe(`${window.location.origin}/logo-roelca.png`);
    const dataUrl = await logoComoDataUrl(RUTA_LOGO_ROELCA);
    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(logoListo(RUTA_LOGO_ROELCA)).toBe(dataUrl);
    await logoComoDataUrl(RUTA_LOGO_ROELCA);
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });
  it('si la descarga falla devuelve null y reintenta la próxima vez', async () => {
    const fetchFalso = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce(respuestaPng());
    vi.stubGlobal('fetch', fetchFalso);
    const { logoComoDataUrl, RUTA_LOGO_ROELCA_CHICO } = await import('./logo');
    expect(await logoComoDataUrl(RUTA_LOGO_ROELCA_CHICO)).toBeNull();
    expect(await logoComoDataUrl(RUTA_LOGO_ROELCA_CHICO)).toMatch(/^data:image\/png/);
    expect(fetchFalso).toHaveBeenCalledTimes(2);
  });
  it('el logo registrado gana sobre el de Roelca', async () => {
    const { setLogoPdf, getLogoPdf, logoPdfPorDefecto } = await import('./logo');
    expect(logoPdfPorDefecto()).toMatch(/\/logo-roelca\.png$/);
    setLogoPdf('data:image/png;base64,AAA');
    expect(getLogoPdf()).toBe('data:image/png;base64,AAA');
    expect(logoPdfPorDefecto()).toBe('data:image/png;base64,AAA');
    setLogoPdf(null);
    expect(getLogoPdf()).toBe('');
  });
  it('cargarLogoDataUrl sin URL devuelve null sin descargar', async () => {
    const fetchFalso = vi.fn();
    vi.stubGlobal('fetch', fetchFalso);
    const { cargarLogoDataUrl } = await import('./logo');
    expect(await cargarLogoDataUrl('')).toBeNull();
    expect(fetchFalso).not.toHaveBeenCalled();
  });
});
