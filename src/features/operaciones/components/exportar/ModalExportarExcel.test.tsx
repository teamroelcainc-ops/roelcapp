// @vitest-environment jsdom
// ✅ V00498 — ventanas del Excel: configuración guardada → columnas → Exportar; el rango se valida.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../../../config/firebase', () => ({ db: {}, auth: { currentUser: null } }));
vi.mock('firebase/firestore', () => ({}));
afterEach(cleanup);

vi.mock('../../services/configsExportExcel', async () => {
  const real = await vi.importActual<typeof import('../../services/configsExportExcel')>('../../services/configsExportExcel');
  return {
    ...real,
    listarConfigsExcel: vi.fn(async () => [{ id: 'c1', nombre: 'Conf. Rol', columnas: [{ id: 'status', visible: true }, { id: 'ref', visible: true }, { id: 'cliente', visible: false }] }]),
    guardarConfigExcel: vi.fn(async () => 'c2'),
    borrarConfigExcel: vi.fn(async () => {}),
    guardarUltimaSeleccion: vi.fn(),
    leerUltimaSeleccion: vi.fn(() => null),
  };
});

const { default: ModalExportarExcel } = await import('./ModalExportarExcel');
const columnas = () => [{ id: 'ref', label: '# Referencia', visible: true }, { id: 'status', label: 'Status', visible: true }, { id: 'cliente', label: 'Cliente', visible: false }];

describe('ModalExportarExcel', () => {
  it('Usar una configuración arma el Excel con sus columnas, en su orden', async () => {
    const onExportar = vi.fn(async () => true);
    const onCerrar = vi.fn();
    render(<ModalExportarExcel moduloConfigs="serviciosCompletados" claveUltima="k" columnasPorDefecto={columnas} onExportar={onExportar} onCerrar={onCerrar} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Usar' }));
    expect(screen.getByText('(2 columnas)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Exportar' }));
    await waitFor(() => expect(onCerrar).toHaveBeenCalled());
    expect(onExportar).toHaveBeenCalledWith([{ id: 'status', label: 'Status' }, { id: 'ref', label: '# Referencia' }]);
  });

  it('con rango: "Desde" después de "Hasta" no exporta', async () => {
    const onExportar = vi.fn(async () => true);
    const alerta = vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<ModalExportarExcel moduloConfigs="m" claveUltima="k" columnasPorDefecto={columnas} rango={{ desde: '2026-10-31', hasta: '2026-10-01' }} onCambiarRango={() => {}} onExportar={onExportar} onCerrar={() => {}} />);
    expect(screen.getByRole('alert').textContent).toContain('posterior');
    fireEvent.click(await screen.findByRole('button', { name: /Nueva configuración/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Exportar' }));
    expect(alerta).toHaveBeenCalled();
    expect(onExportar).not.toHaveBeenCalled();
  });
});
