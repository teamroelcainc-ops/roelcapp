// @vitest-environment jsdom
// ✅ V00451 — ventana "Documento firmado" del tarifario: Guardar solo con cambios, sube la lista
//   completa y le entrega a la pantalla la lista guardada (para seguir con la aprobación).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ArchivoGuardado } from '../../../shared/archivos/adjuntos';

const guardarDocsFirmados = vi.fn();
vi.mock('../services/docsFirmados', () => ({
  MAX_DOCS_FIRMADOS: 10,
  guardarDocsFirmados: (...a: unknown[]) => guardarDocsFirmados(...a),
}));
vi.mock('../../../shared/data/avisos', () => ({ avisar: vi.fn() }));

const { default: ModalDocsFirmados } = await import('./ModalDocsFirmados');

const guardado: ArchivoGuardado = { url: 'https://x/a.pdf', nombre: 'a.pdf', fecha: '2026-10-01' };
const pdf = (nombre: string) => new File([new Uint8Array(10)], nombre, { type: 'application/pdf' });

const abrir = (props: Partial<Parameters<typeof ModalDocsFirmados>[0]> = {}) => {
  const onCerrar = vi.fn();
  const onGuardado = vi.fn();
  const ui = render(
    <ModalDocsFirmados lado="clientes" id="TAR-001" consecutivo="TAR-001" nombreEntidad="ACME" guardados={[guardado]}
      obligatorio onCerrar={onCerrar} onGuardado={onGuardado} {...props} />,
  );
  const elegir = (...files: File[]) => {
    const input = ui.container.querySelector('input[type="file"][multiple]');
    if (!input) throw new Error('sin selector de archivos');
    fireEvent.change(input, { target: { files } });
  };
  return { onCerrar, onGuardado, elegir };
};

beforeEach(() => {
  guardarDocsFirmados.mockReset();
  URL.createObjectURL = vi.fn(() => 'blob:local');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(window, 'alert').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('ModalDocsFirmados', () => {
  it('muestra lo guardado y no deja guardar sin cambios', () => {
    abrir();
    expect(screen.getByText(/Documento firmado de TAR-001/)).toBeTruthy();
    expect(screen.getByText('a.pdf')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Guardar' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('agrega archivos, guarda la lista completa y entrega la lista guardada', async () => {
    const final: ArchivoGuardado[] = [guardado, { url: 'https://x/b.pdf', nombre: 'b.pdf' }];
    guardarDocsFirmados.mockResolvedValue(final);
    const { onCerrar, onGuardado, elegir } = abrir({ aprobarDespues: true });
    expect(screen.getByText(/la aprobación continúa/)).toBeTruthy();
    elegir(pdf('b.pdf'));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(onGuardado).toHaveBeenCalledWith(final));
    expect(onCerrar).toHaveBeenCalledTimes(1);
    const [lado, id, entidad, adjuntos, antes] = guardarDocsFirmados.mock.calls[0];
    expect([lado, id, entidad]).toEqual(['clientes', 'TAR-001', 'ACME']);
    expect((adjuntos as { estado: string }[]).map((a) => a.estado)).toEqual(['guardado', 'nuevo']);
    expect(antes).toEqual([guardado]);
  });

  it('si falla la subida avisa y no cierra', async () => {
    guardarDocsFirmados.mockRejectedValue(new Error('sin red'));
    const { onCerrar, onGuardado, elegir } = abrir();
    elegir(pdf('b.pdf'));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(window.alert).toHaveBeenCalled());
    expect(onCerrar).not.toHaveBeenCalled();
    expect(onGuardado).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Guardar' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
