// ✅ V00534 — Los PDF de una operación cargan pdfGenerator al generar.
import { describe, expect, it, vi } from 'vitest';

const avisar = vi.hoisted(() => vi.fn());
vi.mock('../shared/data/avisos', () => ({ avisar }));

import { cargadorPdfOperacion, generarCartaInstruccionesPDF, generarCheckListPDF, generarInstruccionesServicioPDF, generarPruebaEntregaPDF, generarSolicitudRetiroPDF } from './pdfOperacionDiferido';

const generadores = {
  generarSolicitudRetiroPDF: vi.fn(),
  generarInstruccionesServicioPDF: vi.fn(),
  generarCheckListPDF: vi.fn(),
  generarPruebaEntregaPDF: vi.fn(),
  generarCartaInstruccionesPDF: vi.fn(),
};
vi.spyOn(cargadorPdfOperacion, 'cargar').mockImplementation(async () => generadores as never);

describe('pdfOperacionDiferido', () => {
  it('cada función carga el generador al usarse y le pasa los mismos datos', async () => {
    const datos = { referencia: 'TR-1' } as never;
    generarSolicitudRetiroPDF(datos);
    generarInstruccionesServicioPDF(datos);
    generarCheckListPDF(datos);
    generarPruebaEntregaPDF(datos);
    generarCartaInstruccionesPDF(datos);
    await vi.waitFor(() => Object.values(generadores).forEach((g) => expect(g).toHaveBeenCalledWith(datos)));
    expect(cargadorPdfOperacion.cargar).toHaveBeenCalledTimes(5);
  });
  it('si no se puede cargar, avisa', async () => {
    vi.mocked(cargadorPdfOperacion.cargar).mockRejectedValueOnce(new Error('sin conexión'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    generarCheckListPDF({} as never);
    await vi.waitFor(() => expect(avisar).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'alerta', titulo: 'No se pudo generar el PDF' })));
    error.mockRestore();
  });
});
