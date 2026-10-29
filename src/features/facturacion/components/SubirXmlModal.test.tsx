// @vitest-environment jsdom
// ✅ V00513 — Subir XML: se elige el archivo, se lee, se coteja y solo lo que cuadra se puede registrar.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cotejarCfdi } from '../services/cotejoCfdi';
import type { ClienteCotejo, OpCotejo } from '../services/cotejoCfdi';
import type { Cfdi } from '../services/leerCfdi';
import SubirXmlModal from './SubirXmlModal';

afterEach(cleanup);

const xml = (folio: string, importe: string) => `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Serie="I" Folio="${folio}" Fecha="2026-10-28T12:20:56" Moneda="USD" TipoCambio="18.6525" SubTotal="${importe}" Total="${importe}" TipoDeComprobante="I">
<cfdi:Receptor Nombre="CLIENTE USA,INC." Rfc="XEXX010101000" NumRegIdTrib="999" />
<cfdi:Conceptos><cfdi:Concepto Descripcion="IMPORTACION CAJA POR LAREDO CARGADA
TR-271026-025
CAJA 145" Importe="${importe}" /></cfdi:Conceptos>
<cfdi:Complemento><tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" UUID="UUID-${folio}" /></cfdi:Complemento>
</cfdi:Comprobante>`;

const OPS: OpCotejo[] = [{ id: 'op1', ref: 'TR-271026-025', clienteId: 'c1', facturaFolio: '', enRevision: false, importeUSD: 150, importeMXN: 2797.88, tipoCambio: 18.65 }];
const CLIENTES = new Map<string, ClienteCotejo>([['c1', { nombre: 'Cliente USA, Inc.', rfc: '999', moneda: 'USD' }]]);
const cotejar = (c: Cfdi) => cotejarCfdi(c, OPS, CLIENTES, []);

const subir = (archivos: File[]) => {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: archivos } });
};

describe('SubirXmlModal', () => {
  it('una factura que cuadra se puede registrar y entrega el resultado y el archivo', async () => {
    const onRegistrar = vi.fn();
    render(<SubirXmlModal cotejar={cotejar} nombreCliente={() => 'Cliente USA, Inc.'} onRegistrar={onRegistrar} onCerrar={() => {}} oculto={false} />);
    const archivo = new File([xml('8668', '150.00')], 'I8668.xml', { type: 'text/xml' });
    subir([archivo]);
    const boton = await screen.findByRole('button', { name: 'Registrar factura' });
    expect(screen.getByText('I8668')).toBeTruthy();
    fireEvent.click(boton);
    expect(onRegistrar).toHaveBeenCalledTimes(1);
    expect(onRegistrar.mock.calls[0][0].opsIds).toEqual(['op1']);
    expect(onRegistrar.mock.calls[0][1]).toBe(archivo);
    expect(onRegistrar.mock.calls[0][2]).toBeNull();
    expect(screen.getByText('⚠ Sin PDF')).toBeTruthy();
  });

  it('el PDF se junta con su XML y se entrega al registrar; un PDF sin XML se avisa', async () => {
    const onRegistrar = vi.fn();
    render(<SubirXmlModal cotejar={cotejar} nombreCliente={() => ''} onRegistrar={onRegistrar} onCerrar={() => {}} oculto={false} />);
    const xmlF = new File([xml('8668', '150.00')], 'ROE-I8668.xml', { type: 'text/xml' });
    const pdfF = new File(['%PDF-1.4'], 'ROE-I8668.pdf', { type: 'application/pdf' });
    const suelto = new File(['%PDF-1.4'], 'otra.pdf', { type: 'application/pdf' });
    subir([pdfF, xmlF, suelto]);
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar factura' }));
    expect(onRegistrar.mock.calls[0][1]).toBe(xmlF);
    expect(onRegistrar.mock.calls[0][2]).toBe(pdfF);
    expect(screen.getByText('📄 PDF')).toBeTruthy();
    expect(screen.getByText('PDF sin su XML: otra.pdf')).toBeTruthy();
  });

  it('otros tipos de archivo se quitan con aviso', async () => {
    const alerta = vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<SubirXmlModal cotejar={cotejar} nombreCliente={() => ''} onRegistrar={() => {}} onCerrar={() => {}} oculto={false} />);
    subir([new File(['a'], 'datos.xlsx', { type: 'application/vnd.ms-excel' })]);
    await waitFor(() => expect(alerta).toHaveBeenCalledWith('Solo se aceptan los PDF y XML de las facturas; se quitaron: datos.xlsx'));
    alerta.mockRestore();
  });

  it('una que no cuadra no se puede registrar y dice la diferencia', async () => {
    render(<SubirXmlModal cotejar={cotejar} nombreCliente={() => ''} onRegistrar={() => {}} onCerrar={() => {}} oculto={false} />);
    subir([new File([xml('8669', '160.00')], 'I8669.xml', { type: 'text/xml' })]);
    await screen.findByText(/el XML cobra 160.00 USD y la app 150.00/);
    expect(screen.queryByRole('button', { name: 'Registrar factura' })).toBeNull();
  });

  it('el mismo XML dos veces: el segundo queda como repetido', async () => {
    render(<SubirXmlModal cotejar={cotejar} nombreCliente={() => ''} onRegistrar={() => {}} onCerrar={() => {}} oculto={false} />);
    subir([new File([xml('8668', '150.00')], 'a.xml', { type: 'text/xml' }), new File([xml('8668', '150.00')], 'b.xml', { type: 'text/xml' })]);
    await waitFor(() => expect(screen.getAllByText(/I8668/).length).toBe(2));
    expect(screen.getByText(/XML repetido en esta carga/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Registrar factura' }).length).toBe(1);
  });
});
