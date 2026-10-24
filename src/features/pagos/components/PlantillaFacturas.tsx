// src/features/pagos/components/PlantillaFacturas.tsx
// ✅ V00484 — Descargar plantilla / Cargar plantilla en Registrar pago y Editar pago: marca las
// Transacciones pendientes cuyo número de factura (y monto, si viene) coincide, y lista las que no.
import { useRef, useState } from 'react';
import { Download, FileSpreadsheet, X } from 'lucide-react';
import { cruzarPlantilla } from '../services/plantillaFacturas';
import type { FacturaConocida, FacturaParaCruce, ResultadoPlantilla } from '../services/plantillaFacturas';
import { descargarPlantillaFacturas, leerPlantillaFacturas } from '../services/plantillaFacturasExcel';
import './PlantillaFacturas.css';

interface Props {
  /** Empresa del pago (para el nombre del archivo y los avisos). */
  entidad: string;
  /** Las que se pueden marcar: con saldo abierto de esa empresa. */
  pendientes: readonly FacturaParaCruce[];
  /** Para explicar los renglones que no están entre las pendientes (pagadas, de otra empresa).
   *  Función: la lista se arma solo al cargar un archivo, no en cada pintado. */
  conocidas?: () => readonly FacturaConocida[];
  /** Números de factura que ya están en el pago (Editar pago). */
  enEstePago?: readonly string[];
  onMarcar: (facturas: FacturaParaCruce[]) => void;
}

type Resultado = ResultadoPlantilla & { archivo: string };

export default function PlantillaFacturas({ entidad, pendientes, conocidas, enEstePago, onMarcar }: Props) {
  const entrada = useRef<HTMLInputElement>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [error, setError] = useState('');

  const descargar = async () => {
    setError('');
    try {
      await descargarPlantillaFacturas(entidad);
    } catch (e: unknown) {
      console.error('No se pudo generar la plantilla:', e);
      setError('No se pudo generar la plantilla. Intenta de nuevo.');
    }
  };

  const cargar = async (archivo: File) => {
    setLeyendo(true);
    setError('');
    setResultado(null);
    try {
      const filas = await leerPlantillaFacturas(archivo);
      if (filas.length === 0) {
        setError(`"${archivo.name}" no trae facturas: escribe los números en la columna Factura de la plantilla.`);
        return;
      }
      const r = cruzarPlantilla(filas, pendientes, { entidad, conocidas: conocidas?.(), enEstePago });
      if (r.marcar.length > 0) onMarcar(r.marcar);
      setResultado({ ...r, archivo: archivo.name });
    } catch (e: unknown) {
      console.error('No se pudo leer la plantilla:', e);
      setError(`No se pudo leer "${archivo.name}". Usa la plantilla en Excel (.xlsx) o un .csv.`);
    } finally {
      setLeyendo(false);
    }
  };

  return (
    <>
      <div className="ptf-barra">
        <button type="button" className="ptf-btn" onClick={() => { void descargar(); }}
          title="Excel con las columnas Factura y Monto (opcional) para marcar varias facturas de una vez">
          <Download size={14} aria-hidden="true" /> Descargar plantilla
        </button>
        <button type="button" className="ptf-btn ptf-btn--cargar" onClick={() => entrada.current?.click()} disabled={leyendo}
          title="Sube la plantilla llena: se marcan las facturas que coinciden">
          <FileSpreadsheet size={14} aria-hidden="true" /> {leyendo ? 'Leyendo…' : 'Cargar plantilla'}
        </button>
        <input ref={entrada} type="file" accept=".xlsx,.xls,.csv" className="ptf-input-oculto" tabIndex={-1} aria-hidden="true"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void cargar(f); }} />
      </div>
      {error && <p className="ptf-error" role="alert">{error}</p>}
      {resultado && (
        <div className="ptf-resultado" role="status">
          <div className="ptf-resultado__linea">
            <span>
              <b className={resultado.marcar.length > 0 ? 'ptf-ok' : 'ptf-cero'}>{resultado.marcar.length}</b>
              {resultado.marcar.length === 1 ? ' factura marcada' : ' facturas marcadas'} de {resultado.renglones} {resultado.renglones === 1 ? 'renglón' : 'renglones'} de {resultado.archivo}
              {resultado.avisos.length > 0 && <> · <b className="ptf-aviso">{resultado.avisos.length}</b> sin marcar</>}
            </span>
            <button type="button" className="ptf-cerrar" onClick={() => setResultado(null)} aria-label="Cerrar el resultado de la plantilla"><X size={14} aria-hidden="true" /></button>
          </div>
          {resultado.avisos.length > 0 && (
            <ul className="ptf-avisos">
              {resultado.avisos.map((a) => (
                <li key={`${a.fila}-${a.factura}`}>
                  <span className="ptf-factura">{a.factura || '—'}</span>
                  <span className="ptf-motivo">{a.motivo}</span>
                  <span className="ptf-fila">renglón {a.fila}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
