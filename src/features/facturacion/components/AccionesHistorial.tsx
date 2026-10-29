// src/features/facturacion/components/AccionesHistorial.tsx
// ✅ V00482 — barra del Historial de Facturas (Clientes y Proveedores), en la misma fila que Filtros:
// buscar, Corregir monedas y montos, Columnas y Exportar Excel. Quitados: Encabezado Remisión,
// Verificar y Sincronizar con Empresas.
import { Columns3, Download, Search, Wand2, X } from 'lucide-react';
import './AccionesHistorial.css';

interface Props {
  /** Buscador sobre la tabla (Clientes lo tiene; Proveedores busca desde Filtros). */
  buscar?: { valor: string; onCambiar: (v: string) => void; placeholder: string };
  /** Corregir monedas y montos (solo Proveedores: Clientes lo quitó en la V00522). */
  onCorregir?: () => void;
  /** Mientras se cargan las facturas no se puede revisar. */
  corregirDeshabilitado?: boolean;
  onColumnas: () => void;
  onExportar: () => void;
  exportando: boolean;
}

export default function AccionesHistorial({ buscar, onCorregir, corregirDeshabilitado, onColumnas, onExportar, exportando }: Props) {
  return (
    <div className="ahi-barra">
      {buscar && (
        <label className="ahi-buscar">
          <Search size={15} aria-hidden="true" />
          <input type="search" className="ahi-buscar__input" placeholder={buscar.placeholder} value={buscar.valor}
            onChange={(e) => buscar.onCambiar(e.target.value)} aria-label="Buscar facturas" />
          {buscar.valor && (
            <button type="button" className="ahi-buscar__limpiar" onClick={() => buscar.onCambiar('')} aria-label="Limpiar búsqueda"><X size={14} /></button>
          )}
        </label>
      )}
      {onCorregir && (
        <button type="button" className="ahi-btn ahi-btn--corregir" onClick={onCorregir} disabled={corregirDeshabilitado}
          title="Pone en cada factura la moneda de su empresa (Empresas) y el total de sus operaciones en esa moneda">
          <Wand2 size={15} aria-hidden="true" /> Corregir monedas y montos
        </button>
      )}
      <button type="button" className="ahi-btn" onClick={onColumnas} title="Elegir y ordenar las columnas de la tabla">
        <Columns3 size={15} aria-hidden="true" /> Columnas
      </button>
      <button type="button" className="ahi-btn ahi-btn--exportar" onClick={onExportar} disabled={exportando}>
        <Download size={15} aria-hidden="true" /> {exportando ? 'Exportando…' : 'Exportar Excel'}
      </button>
    </div>
  );
}
