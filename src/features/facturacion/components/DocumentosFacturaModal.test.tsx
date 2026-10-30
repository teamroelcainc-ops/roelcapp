// @vitest-environment jsdom
// ✅ V00451 — "Documentos de la factura": la píldora de la fila, la tarjeta de la Ficha y el modal.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Adjunto } from '../../../shared/archivos/adjuntos';

const guardarDocsFactura = vi.fn<(lado: string, fila: Record<string, unknown>, adjuntos: readonly Adjunto[]) => Promise<unknown>>();
vi.mock('../services/guardarDocsFactura', () => ({ guardarDocsFactura: (...args: [string, Record<string, unknown>, readonly Adjunto[]]) => guardarDocsFactura(...args) }));

const { default: DocumentosFacturaModal } = await import('./DocumentosFacturaModal');
const { default: TarjetaDocumentoFactura, PildoraDocsFactura } = await import('./TarjetaDocumentoFactura');

const a = { url: 'https://x/a.pdf', nombre: 'a.pdf' };
const b = { url: 'https://x/b.png', nombre: 'b.png' };

afterEach(() => { cleanup(); vi.restoreAllMocks(); guardarDocsFactura.mockReset(); });

describe('píldora y tarjeta', () => {
  it('la píldora dice cuántos documentos hay y abre el modal sin abrir la fila', () => {
    const onAbrir = vi.fn();
    const onFila = vi.fn();
    render(<div onClick={onFila}><PildoraDocsFactura archivos={[a, b]} onAbrir={onAbrir} /></div>);
    fireEvent.click(screen.getByRole('button', { name: 'Doc ✓ (2)' }));
    expect(onAbrir).toHaveBeenCalledTimes(1);
    expect(onFila).not.toHaveBeenCalled();
  });
  it('la tarjeta lista los archivos y, sin ninguno, invita a subirlos', () => {
    const { rerender } = render(<TarjetaDocumentoFactura archivos={[a, b]} onAbrir={() => {}} />);
    expect(screen.getByText('2 documentos cargados')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'b.png' }).getAttribute('href')).toBe(b.url);
    rerender(<TarjetaDocumentoFactura archivos={[]} onAbrir={() => {}} />);
    expect(screen.getByRole('button', { name: 'Subir documentos' })).toBeTruthy();
  });
  it('✅ V00531: "Ver documento" abre la factura (el PDF) en otra pestaña y "Agregar o cambiar" abre el modal', () => {
    const onAbrir = vi.fn();
    const xml = { url: 'https://x/c.xml', nombre: 'c.xml' };
    render(<TarjetaDocumentoFactura archivos={[xml, b, a]} onAbrir={onAbrir} />);
    const ver = screen.getByRole('link', { name: 'Ver documento' });
    expect(ver.getAttribute('href')).toBe(a.url);
    expect(ver.getAttribute('target')).toBe('_blank');
    fireEvent.click(screen.getByRole('button', { name: 'Agregar o cambiar' }));
    expect(onAbrir).toHaveBeenCalledTimes(1);
  });
});

describe('modal "Documentos de la factura"', () => {
  const fila = { id: 'F1', invoice: 'INV-7', docsFactura: [a, b] };

  it('abre con los documentos de la factura y Guardar apagado hasta que algo cambie', () => {
    render(<DocumentosFacturaModal lado="clientes" fila={fila} onGuardado={() => {}} onCerrar={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'Documentos de la factura INV-7' })).toBeTruthy();
    expect(screen.getByText('a.pdf')).toBeTruthy();
    expect(screen.getByText('b.png')).toBeTruthy();
    expect(screen.getByTitle('Vista previa de a.pdf')).toBeTruthy(); // el primero ya se ve
    expect((screen.getByRole('button', { name: 'Guardar' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('quitar un documento y Guardar manda la lista que quedó', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const escrituras = [{ id: 'F1', campos: { docsFactura: [b] } }];
    guardarDocsFactura.mockResolvedValue(escrituras);
    const onGuardado = vi.fn();
    const onCerrar = vi.fn();
    render(<DocumentosFacturaModal lado="proveedores" fila={fila} onGuardado={onGuardado} onCerrar={onCerrar} />);
    fireEvent.click(screen.getByRole('button', { name: 'Quitar a.pdf' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(onCerrar).toHaveBeenCalled());
    const [lado, filaEnviada, adjuntos] = guardarDocsFactura.mock.calls[0];
    expect(lado).toBe('proveedores');
    expect(filaEnviada).toBe(fila);
    expect(adjuntos.map((x) => (x.estado === 'guardado' ? x.archivo.url : x.file.name))).toEqual([b.url]);
    expect(onGuardado).toHaveBeenCalledWith(escrituras);
  });

  it('si falla, avisa el motivo y no se cierra', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const alerta = vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    guardarDocsFactura.mockRejectedValue({ code: 'storage/unauthorized' });
    const onCerrar = vi.fn();
    render(<DocumentosFacturaModal lado="clientes" fila={fila} onGuardado={() => {}} onCerrar={onCerrar} />);
    fireEvent.click(screen.getByRole('button', { name: 'Quitar b.png' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(alerta).toHaveBeenCalled());
    expect(String(alerta.mock.calls[0][0])).toContain('storage/unauthorized');
    expect(onCerrar).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Guardar' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
