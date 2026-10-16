// src/features/operaciones/components/ModalHistorialResumen.tsx
// ✅ V00456: al presionar la tarjeta Tipo de cambio o Diesel (Operaciones Activas)
//   se ven los últimos registros capturados. Lectura única acotada (TanStack Query:
//   volver a abrir no vuelve a leer; se invalida al capturar uno nuevo).
import { useEffect, useEffectEvent, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import CargandoDatos from '../../../shared/components/CargandoDatos';
import { hoyLocalISO } from '../../../utils/fechaHoraLocal';
import { CLAVE_ULTIMOS_DIESEL, CLAVE_ULTIMOS_TC, leerUltimosDiesel, leerUltimosTipoCambio } from '../services/resumenDiaDatos';
import { filasDiesel, filasTipoCambio, LITROS_POR_GALON } from '../services/resumenDia';
import './ModalHistorialResumen.css';

interface Props {
  tipo: 'tc' | 'diesel';
  /** Tipo de cambio vigente (para el precio por litro en pesos del diesel). */
  tcActual: number | null;
  onCerrar: () => void;
}

const fechaLarga = (iso: string) => {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const dia = d.toLocaleDateString('es-MX', { weekday: 'short' }).replace('.', '');
  return `${dia} ${d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }).replace(' de ', ' ').replace(' de ', ' ')}`;
};
const horaDe = (creado: string) => {
  const d = creado ? new Date(creado) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '—';
};

function TablaTipoCambio() {
  const hoy = hoyLocalISO();
  const q = useQuery({ queryKey: [...CLAVE_ULTIMOS_TC, hoy], queryFn: () => leerUltimosTipoCambio(hoy) });
  if (q.isPending) return <CargandoDatos texto="Cargando tipos de cambio…" />;
  if (q.isError) return <p className="mhr-vacio">No se pudieron leer los tipos de cambio. Revisa tu conexión y vuelve a abrir.</p>;
  const filas = filasTipoCambio(q.data);
  if (filas.length === 0) return <p className="mhr-vacio">Aún no hay tipos de cambio capturados.</p>;
  return (
    <table className="mhr-tabla">
      <thead><tr><th>Fecha</th><th className="mhr-num">Tipo de cambio</th><th className="mhr-num">Cambio</th><th className="mhr-num">Capturado</th></tr></thead>
      <tbody>
        {filas.map((f) => (
          <tr key={f.id} className={f.fecha === hoy ? 'mhr-fila--hoy' : ''}>
            <td>{fechaLarga(f.fecha)}{f.fecha === hoy && <span className="mhr-chip">hoy</span>}</td>
            <td className="mhr-num mhr-valor">${f.tc.toFixed(4)}</td>
            <td className={`mhr-num ${f.variacion == null || f.variacion === 0 ? 'mhr-igual' : f.variacion > 0 ? 'mhr-sube' : 'mhr-baja'}`}>
              {f.variacion == null ? '—' : f.variacion === 0 ? 'Igual' : `${f.variacion > 0 ? '▲ +' : '▼ '}${f.variacion.toFixed(4)}`}
            </td>
            <td className="mhr-num mhr-tenue">{horaDe(f.creadoEn)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TablaDiesel({ tcActual }: { tcActual: number | null }) {
  const hoy = hoyLocalISO();
  const q = useQuery({ queryKey: [...CLAVE_ULTIMOS_DIESEL], queryFn: () => leerUltimosDiesel() });
  if (q.isPending) return <CargandoDatos texto="Cargando capturas de diesel…" />;
  if (q.isError) return <p className="mhr-vacio">No se pudieron leer las capturas de diesel. Revisa tu conexión y vuelve a abrir.</p>;
  const filas = filasDiesel(q.data);
  if (filas.length === 0) return <p className="mhr-vacio">Aún no hay capturas de diesel.</p>;
  return (
    <table className="mhr-tabla">
      <thead><tr><th>Fecha</th><th>Proveedor</th><th className="mhr-num">Por galón</th><th className="mhr-num">Descuento</th><th className="mhr-num">Costo real</th><th className="mhr-num">Por litro</th><th className="mhr-num">Capturado</th></tr></thead>
      <tbody>
        {filas.map((f) => {
          const litroUsd = f.costo / LITROS_POR_GALON;
          return (
            <tr key={f.id} className={f.fecha === hoy ? 'mhr-fila--hoy' : ''}>
              <td>{fechaLarga(f.fecha)}{f.fecha === hoy && <span className="mhr-chip">hoy</span>}</td>
              <td>{f.proveedor || '—'}{f.masBajoDelDia && <span className="mhr-chip mhr-chip--bajo" title="El costo real más bajo de ese día">más bajo</span>}</td>
              <td className="mhr-num mhr-valor mhr-valor--diesel">${f.costo.toFixed(2)}</td>
              {/* ✅ V00460: descuento por galón (Murphy) y lo que de verdad cuesta el galón. */}
              <td className={`mhr-num ${f.descuento > 0 ? 'mhr-desc' : 'mhr-tenue'}`}>{f.descuento > 0 ? `−$${f.descuento.toFixed(2)}` : '—'}</td>
              <td className="mhr-num mhr-valor">${f.costoReal.toFixed(2)}</td>
              <td className="mhr-num mhr-tenue">${litroUsd.toFixed(2)} USD{tcActual != null ? ` · $${(litroUsd * tcActual).toFixed(2)} MXN` : ''}</td>
              <td className="mhr-num mhr-tenue">{horaDe(f.creadoEn)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function ModalHistorialResumen({ tipo, tcActual, onCerrar }: Props) {
  // Escape cierra; el foco entra al modal (botón cerrar) y vuelve a donde estaba al cerrar.
  // ✅ V00457: con useEffectEvent el efecto corre UNA vez (onCerrar llega nuevo en cada
  //   repintado de App y movía el foco en cada snapshot).
  const cerrarRef = useRef<HTMLButtonElement>(null);
  const alTeclear = useEffectEvent((e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); });
  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null;
    cerrarRef.current?.focus();
    const escuchar = (e: KeyboardEvent) => alTeclear(e);
    window.addEventListener('keydown', escuchar);
    return () => { window.removeEventListener('keydown', escuchar); previo?.focus?.(); };
  }, []);
  const titulo = tipo === 'tc' ? 'Últimos tipos de cambio' : 'Últimas capturas de diesel';
  const nota = tipo === 'tc' ? 'Los 30 registros más recientes (pesos por dólar).' : 'Las 40 capturas más recientes. Costo real = por galón − descuento (Murphy descuenta $0.20 por galón). El precio por litro es sin descuento, en pesos con el tipo de cambio vigente.';
  return createPortal(
    <div className="modal-overlay mhr-fondo" onClick={onCerrar}>
      <div className={`mhr-caja mhr-caja--${tipo}`} role="dialog" aria-modal="true" aria-label={titulo} onClick={(e) => e.stopPropagation()}>
        <div className="mhr-enc">
          <div>
            <h2 className="mhr-titulo">{titulo}</h2>
            <p className="mhr-nota">{nota}</p>
          </div>
          <button type="button" className="mhr-x" onClick={onCerrar} aria-label="Cerrar" ref={cerrarRef}>✕</button>
        </div>
        <div className="mhr-marco">
          {tipo === 'tc' ? <TablaTipoCambio /> : <TablaDiesel tcActual={tcActual} />}
        </div>
        <div className="mhr-pie"><button type="button" className="mhr-btn" onClick={onCerrar}>Cerrar</button></div>
      </div>
    </div>,
    document.body,
  );
}
