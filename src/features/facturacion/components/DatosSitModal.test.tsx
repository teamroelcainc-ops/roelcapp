// @vitest-environment jsdom
// ✅ V00513 — Datos para el SIT: se ve la descripción y el importe, y se copian.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DatosSitModal from './DatosSitModal';

afterEach(cleanup);

const datos = {
  moneda: 'MXN' as const, subtotal: 3131.4,
  conceptos: [{ id: 'o1', ref: 'LO-211026-008', convenio: 'Cruce de Importacion', lineas: ['LO-211026-008', '21/10/2026', 'CAJA RP116', 'TC 18.4200'], importe: 3131.4, tipoCambio: 18.42 }],
};

describe('DatosSitModal', () => {
  it('muestra la descripción y copia el importe sin comas', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<DatosSitModal cliente="Temm Truck" datos={datos} onCerrar={() => {}} />);
    expect(screen.getByText(/CAJA RP116/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copiar importe' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('3131.40'));
    expect(await screen.findByRole('button', { name: '✔ Copiado' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copiar descripción' }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('LO-211026-008\n21/10/2026\nCAJA RP116\nTC 18.4200'));
  });
});
