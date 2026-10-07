// src/features/conveniosCompartido/StatusOperaciones.tsx
// ---------------------------------------------------------------------------
// ✅ V00429 — STATUS DE CADA OPERACIÓN en los conteos de operaciones por
//   convenio (Tarifario y Convenio de Clientes/Proveedores). Las operaciones
//   guardan el status como ID del catálogo `catalogo_status_servicio` (las
//   viejas, como nombre); aquí se traduce al nombre real ("Servicio
//   Completado", "Cancelado", "4.1 Salida del Patio (Roelca)"…).
// ---------------------------------------------------------------------------
import React from 'react';
import { conteoPorStatus, familiaStatus, type OpConStatus } from './logicaStatusOps';
import './StatusOperaciones.css';

/** Chips "N · Status" (compactos, para la celda de Operaciones). */
export const ResumenStatusOps: React.FC<{ ops: OpConStatus[] }> = ({ ops }) => {
  if (ops.length === 0) return null;
  return (
    <span className="sto-resumen">
      {conteoPorStatus(ops).map(({ nombre, n }) => (
        <span key={nombre} className={`sto-chip sto-chip--${familiaStatus(nombre)}`} title={`${n} operación(es) en "${nombre}"`}>
          <b>{n}</b> {nombre}
        </span>
      ))}
    </span>
  );
};

/** Tabla de operaciones con su status (para fichas y desplegables). */
export const ListaOpsConStatus: React.FC<{ ops: OpConStatus[]; onRef?: (o: OpConStatus) => void }> = ({ ops, onRef }) => {
  if (ops.length === 0) return <div className="sto-vacio">Sin operaciones con este convenio.</div>;
  return (
    <table className="sto-tabla">
      <thead><tr><th>#</th><th>Referencia</th><th>Fecha</th><th>Status</th>{ops.some((o) => o.tipo) && <th>Tipo</th>}</tr></thead>
      <tbody>
        {ops.map((o, i) => (
          <tr key={`${o.id || o.ref}-${i}`}>
            <td className="sto-num">{i + 1}</td>
            <td>{onRef ? <button type="button" className="sto-ref" title={`Abrir ${o.ref}`} onClick={() => onRef(o)}>{o.ref || '—'}</button> : (o.ref || '—')}</td>
            <td>{o.fecha || '—'}</td>
            <td><span className={`sto-chip sto-chip--${familiaStatus(o.statusNombre)}`}>{o.statusNombre || 'Sin status'}</span></td>
            {ops.some((x) => x.tipo) && <td>{o.tipo || '—'}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
};
