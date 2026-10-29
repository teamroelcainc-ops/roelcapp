// @vitest-environment jsdom
// ✅ V00516 — "Analizar documento" en la Ficha de Factura: descarga el documento YA guardado y lo
// compara con la factura. fetch simulado (el XML imita la forma de un CFDI del SIT, datos ficticios).
import { Blob as BlobNode } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { FacturaEsperada } from '../services/documentoFactura';
import { esGuardadoRevisable, tipoPorContenido } from '../services/leerDocumentoFactura';
import DocumentoFichaCliente from './DocumentoFichaCliente';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Serie="I" Folio="8663" Fecha="2026-10-28T11:06:43" Moneda="USD" TipoCambio="18.6525" SubTotal="200.00" Total="200.00" TipoDeComprobante="I">
<cfdi:Emisor Nombre="EMISOR DE PRUEBA" Rfc="AAA010101AAA" />
<cfdi:Receptor Nombre="CLIENTE EXTRANJERO,INC." Rfc="XEXX010101000" NumRegIdTrib="123456789" />
<cfdi:Conceptos>
<cfdi:Concepto Descripcion="IMPORTACION CAJA POR LAREDO CARGADA TR-271026-026 27/10/2026 CAJA ETX53269" Importe="150.00" />
<cfdi:Concepto Descripcion="EXPORTACION TROMPO POR LAREDO TR-271026-010 27/10/2026 CAJA ETX53269" Importe="50.00" />
</cfdi:Conceptos>
</cfdi:Comprobante>`;

const esperado: FacturaEsperada = {
  folio: 'I8663', moneda: 'USD', monto: 200,
  cliente: { nombre: 'Cliente Extranjero, Inc.', rfc: '123456789', moneda: 'USD' },
  ops: [{ ref: 'TR-271026-026', importe: 150, tc: 0 }, { ref: 'TR-271026-010', importe: 50, tc: 0 }],
};

// El Blob de jsdom no tiene text(); el de Node sí (como el del navegador).
const respuesta = (cuerpo: string, status = 200) => ({ ok: status >= 200 && status < 300, status, blob: async () => new BlobNode([cuerpo]) as unknown as Blob });

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('qué se puede revisar', () => {
  it('por el contenido: PDF, XML u otra cosa (los registros viejos no traen extensión)', () => {
    expect(tipoPorContenido('%PDF-1.7\n')).toBe('pdf');
    expect(tipoPorContenido('﻿  <?xml version="1.0"?>')).toBe('xml');
    expect(tipoPorContenido('\u0089PNG')).toBe('otro');
  });
  it('las imágenes no se descargan; un archivo sin extensión sí', () => {
    expect(esGuardadoRevisable({ url: 'https://x/f.png', nombre: 'f.png' })).toBe(false);
    expect(esGuardadoRevisable({ url: 'https://x/f', nombre: 'factura', tipo: 'image/jpeg' })).toBe(false);
    expect(esGuardadoRevisable({ url: 'https://x/f', nombre: 'factura' })).toBe(true);
  });
});

describe('Analizar documento', () => {
  it('descarga el documento guardado y dice si coincide con la factura', async () => {
    const fetchSim = vi.fn(async () => respuesta(XML));
    vi.stubGlobal('fetch', fetchSim);
    render(<DocumentoFichaCliente archivos={[{ url: 'https://x/ok', nombre: 'I8663' }]} esperado={esperado} onAbrir={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Analizar documento' }));
    expect(await screen.findByText('✅ El documento coincide con la factura.')).toBeTruthy();
    expect(fetchSim).toHaveBeenCalledWith('https://x/ok');
    // Ocultar y volver a abrir no lo descarga otra vez.
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar análisis' }));
    fireEvent.click(screen.getByRole('button', { name: 'Analizar documento' }));
    await screen.findByText('✅ El documento coincide con la factura.');
    expect(fetchSim).toHaveBeenCalledTimes(1);
  });
  it('dice qué no coincide', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respuesta(XML)));
    render(<DocumentoFichaCliente archivos={[{ url: 'https://x/otro', nombre: 'I8663.xml' }]} esperado={{ ...esperado, folio: 'I8670', monto: 210 }} onAbrir={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Analizar documento' }));
    expect(await screen.findByText(/no coincide con la factura \(2 diferencias\)/)).toBeTruthy();
    expect(screen.getByText(/El número no es el mismo/)).toBeTruthy();
    expect(screen.getByText(/Ese total no concuerda con la factura/)).toBeTruthy();
  });
  it('si no se pudo descargar lo dice y lo reintenta al volver a analizar', async () => {
    const fetchSim = vi.fn(async () => respuesta('', 404));
    vi.stubGlobal('fetch', fetchSim);
    render(<DocumentoFichaCliente archivos={[{ url: 'https://x/borrado', nombre: 'a.pdf' }]} esperado={esperado} onAbrir={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Analizar documento' }));
    expect(await screen.findByText(/ya no está en el almacenamiento/)).toBeTruthy();
    fetchSim.mockImplementation(async () => { throw new TypeError('Failed to fetch'); });
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar análisis' }));
    fireEvent.click(screen.getByRole('button', { name: 'Analizar documento' }));
    expect(await screen.findByText(/falta permitir que la app lea el almacenamiento/)).toBeTruthy();
    expect(fetchSim).toHaveBeenCalledTimes(2);
  });
  it('sin PDF ni XML no hay botón', () => {
    render(<DocumentoFichaCliente archivos={[{ url: 'https://x/foto.jpg', nombre: 'foto.jpg' }]} esperado={esperado} onAbrir={() => {}} />);
    expect(screen.queryByRole('button', { name: /Analizar/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ver documentos' })).toBeTruthy();
  });
});
