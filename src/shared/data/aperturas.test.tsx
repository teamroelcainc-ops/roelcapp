// @vitest-environment jsdom
// ✅ V00502 — pedido de apertura: se atiende con el módulo ya montado, espera a sus datos y vence.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { abrirRegistro, pedidoAperturaDe, useAtenderApertura, VIGENCIA_APERTURA_MS } from './aperturas';
import type { PedidoApertura } from './aperturas';

afterEach(() => { cleanup(); vi.useRealTimers(); });

function Modulo({ abrir, listo = true }: { abrir: (p: PedidoApertura) => boolean; listo?: boolean }) {
  useAtenderApertura('empresas', abrir, listo);
  return null;
}

describe('aperturas', () => {
  it('un módulo YA montado abre el registro pedido y lo marca atendido; otro módulo no lo toma', () => {
    const abrir = vi.fn(() => true);
    const otro = vi.fn(() => true);
    render(<><Modulo abrir={abrir} /><OtroModulo abrir={otro} /></>);
    const nav = vi.fn();
    window.addEventListener('roelca:navegar', nav);
    act(() => abrirRegistro('empresas', 'E1'));
    expect(abrir).toHaveBeenCalledWith(expect.objectContaining({ modulo: 'empresas', id: 'E1' }));
    expect(otro).not.toHaveBeenCalled();
    expect(pedidoAperturaDe('empresas')).toBeNull();
    expect((nav.mock.calls[0][0] as CustomEvent).detail).toEqual({ modulo: 'empresas' });
    window.removeEventListener('roelca:navegar', nav);
  });

  it('un módulo que se monta después lo atiende al montarse; si aún no tiene datos, espera', () => {
    act(() => abrirRegistro('empresas', 'E2'));
    const abrir = vi.fn(() => true);
    const { rerender } = render(<Modulo abrir={abrir} listo={false} />);
    expect(abrir).not.toHaveBeenCalled();
    rerender(<Modulo abrir={abrir} listo />);
    expect(abrir).toHaveBeenCalledTimes(1);
    expect(pedidoAperturaDe('empresas')).toBeNull();
  });

  it('si abrir devuelve false se queda pendiente; un pedido vencido se descarta sin abrir', () => {
    vi.useFakeTimers();
    act(() => abrirRegistro('empresas', 'E3'));
    render(<Modulo abrir={() => false} />);
    expect(pedidoAperturaDe('empresas')?.id).toBe('E3');
    cleanup();
    vi.setSystemTime(Date.now() + VIGENCIA_APERTURA_MS + 1);
    const abrir = vi.fn(() => true);
    render(<Modulo abrir={abrir} />);
    expect(abrir).not.toHaveBeenCalled();
    expect(pedidoAperturaDe('empresas')).toBeNull();
  });
});

function OtroModulo({ abrir }: { abrir: (p: PedidoApertura) => boolean }) {
  useAtenderApertura('pagos', abrir);
  return null;
}
