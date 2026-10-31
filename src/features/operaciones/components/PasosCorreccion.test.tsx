// @vitest-environment jsdom
// ✅ V00538 — Pasos de una corrección: no se puede aplicar sin prueba, respaldo y APLICAR.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const descargas = vi.hoisted(() => ({ excel: 0, json: 0 }));
vi.mock('../services/excelOperaciones', () => ({ descargarExcel: vi.fn(async () => { descargas.excel += 1; }) }));
vi.mock('../services/marcarFacturadasF1', () => ({ TEXTO_AUTORIZACION: 'APLICAR', descargarJSON: vi.fn(() => { descargas.json += 1; }) }));

import PasosCorreccion from './PasosCorreccion';

const montar = (aplicar = vi.fn(async () => ({ hechas: 2, omitidas: [{ id: 'x', ref: 'TR-1', motivo: 'Cambió desde la prueba' }], error: '' })), pideFunciones = false) => {
  const onAplicado = vi.fn();
  render(
    <PasosCorreccion nombre="Tomar lo de la factura" cantidad={3} unidad={['operación', 'operaciones']} ayudaPrueba="p" ayudaRespaldo="r"
      pideFunciones={pideFunciones} armarPrueba={() => ({ filas: [], columnasMoneda: [] })} armarRespaldo={() => ({})} aplicar={aplicar} onAplicado={onAplicado} />,
  );
  return { aplicar, onAplicado };
};

describe('PasosCorreccion', () => {
  afterEach(() => { cleanup(); descargas.excel = 0; descargas.json = 0; });
  const desactivado = (el: HTMLElement): boolean => (el as HTMLButtonElement | HTMLInputElement).disabled;
  it('en orden: prueba → respaldo → APLICAR; luego aplica y dice cuántas y por qué no las demás', async () => {
    const { aplicar, onAplicado } = montar();
    const boton = screen.getByRole('button', { name: /Corregir 3 operaciones/ });
    expect(desactivado(boton)).toBe(true);
    expect(desactivado(screen.getByRole('button', { name: /Descargar el respaldo/ }))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Descargar la prueba/ }));
    await waitFor(() => expect(descargas.excel).toBe(1));
    fireEvent.click(screen.getByRole('button', { name: /Descargar el respaldo/ }));
    expect(descargas.json).toBe(1);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'aplicar' } });
    expect(desactivado(boton)).toBe(false);
    fireEvent.click(boton);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('2 operaciones corregidas; 1 no'));
    expect(screen.getByRole('status').textContent).toContain('Cambió desde la prueba');
    expect(aplicar).toHaveBeenCalledTimes(1);
    expect(onAplicado).toHaveBeenCalledWith(expect.objectContaining({ hechas: 2 }));
  });
  it('si escribe sobre facturadas, pide confirmar las funciones de la V00496', async () => {
    montar(undefined, true);
    fireEvent.click(screen.getByRole('button', { name: /Descargar la prueba/ }));
    await waitFor(() => expect(desactivado(screen.getByRole('button', { name: /Descargar el respaldo/ }))).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: /Descargar el respaldo/ }));
    expect(desactivado(screen.getByRole('textbox'))).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(desactivado(screen.getByRole('textbox'))).toBe(false);
  });
});
