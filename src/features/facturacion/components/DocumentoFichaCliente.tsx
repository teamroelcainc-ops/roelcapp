// src/features/facturacion/components/DocumentoFichaCliente.tsx
// ---------------------------------------------------------------------------
// ✅ V00516 — Documento de la factura en la Ficha de Factura de CLIENTES: la tarjeta de siempre más
// el botón "Analizar documento", que descarga el PDF / XML ya guardado y lo compara con lo capturado
// en Facturación (número, cliente, moneda, operaciones, costo de cada una y subtotal). Solo avisa.
// La Ficha lo monta con key por factura: al abrir otra factura el análisis empieza cerrado.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import type { ArchivoGuardado } from '../../../shared/archivos/adjuntos';
import type { FacturaEsperada } from '../services/documentoFactura';
import { esGuardadoRevisable } from '../services/leerDocumentoFactura';
import { RevisionDocumentosGuardados } from './RevisionDocumentosFactura';
import TarjetaDocumentoFactura from './TarjetaDocumentoFactura';

interface Props {
  archivos: readonly ArchivoGuardado[];
  esperado: FacturaEsperada;
  onAbrir: () => void;
}

export default function DocumentoFichaCliente({ archivos, esperado, onAbrir }: Props) {
  const [analizando, setAnalizando] = useState(false);
  const hayRevisables = archivos.some(esGuardadoRevisable);
  return (
    <>
      <TarjetaDocumentoFactura archivos={archivos} onAbrir={onAbrir} onAnalizar={hayRevisables ? () => setAnalizando((v) => !v) : undefined} analizando={analizando} />
      {analizando && <RevisionDocumentosGuardados archivos={archivos} esperado={esperado} onCerrar={() => setAnalizando(false)} />}
    </>
  );
}
