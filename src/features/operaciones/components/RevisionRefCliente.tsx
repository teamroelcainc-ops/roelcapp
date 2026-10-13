// src/features/operaciones/components/RevisionRefCliente.tsx
// ✅ V00450: pestaña "Revisión" — operaciones cuya Ref Cliente ya existe en otra operación.
//   La usan Operaciones Activas y Facturación de Clientes. Muestra con quién choca cada una,
//   abre la operación y marca "No es duplicado" (todas las del grupo).
import { useState } from 'react';
import CargandoDatos from '../../../shared/components/CargandoDatos';
import { NOMBRE_MODULO_REVISION } from '../../../shared/data/avisos';
import type { ModuloRevision } from '../../../shared/data/avisos';
import { describirOp, etiquetaEstado } from '../services/refClienteDuplicado';
import type { InfoDuplicado, OpRefResumen } from '../services/refClienteDuplicado';
import { marcarNoDuplicado } from '../services/refClienteDuplicadoServidor';
import { idDeLista } from '../hooks/useRefClienteDuplicados';
import './RevisionRefCliente.css';

type Datos = Record<string, unknown>;

interface Props {
  modulo: ModuloRevision;
  /** Las operaciones de la lista que están en Revisión. */
  ops: readonly Datos[];
  duplicados: ReadonlyMap<string, InfoDuplicado>;
  /** La lista o la consulta al servidor siguen trabajando. */
  cargando: boolean;
  /** Nombre del cliente (ID del catálogo, nombre guardado en la operación). */
  nombreCliente: (clienteId: string, nombreGuardado: string) => string;
  onVer: (op: Datos) => void;
  etiquetaVer?: string;
  /** Ya se marcaron en Firestore (solo `hechas`): la pantalla actualiza su lista. */
  onMarcadas: (clave: string, hechas: readonly OpRefResumen[]) => void;
}

const MAX_OTRAS = 4;

const claseEstado = (o: OpRefResumen): string => {
  if (o.facturada) return 'facturada';
  if (o.estado === 'activa') return 'activa';
  return 'completada';
};

const texto = (v: unknown): string => (v === null || v === undefined || typeof v === 'object' ? '' : String(v));

export default function RevisionRefCliente({ modulo, ops, duplicados, cargando, nombreCliente, onVer, etiquetaVer = 'Ver', onMarcadas }: Props) {
  const [marcando, setMarcando] = useState<string | null>(null);

  const noEsDuplicado = async (info: InfoDuplicado, refCliente: string): Promise<void> => {
    const porMarcar = info.grupo.filter((g) => !g.revisada);
    const lista = info.grupo.map(describirOp).join(', ');
    const ok = window.confirm(
      `¿Confirmas que la Ref Cliente "${refCliente}" NO es un duplicado?\n\n`
      + `Se marcarán ${porMarcar.length} operación(es) con esa Ref: ${lista}.\n\n`
      + 'Si después cambia la Ref Cliente de alguna, se vuelve a revisar.',
    );
    if (!ok) return;
    setMarcando(info.clave);
    try {
      const { hechas, fallidas } = await marcarNoDuplicado(info.clave, info.grupo, NOMBRE_MODULO_REVISION[modulo]);
      onMarcadas(info.clave, hechas);
      if (fallidas.length > 0) {
        alert(`Se marcaron ${hechas.length} de ${hechas.length + fallidas.length} operaciones.\n\nNo se pudieron marcar: ${fallidas.map(describirOp).join(', ')}. Vuelve a intentarlo; esas siguen en Revisión.`);
      }
    } catch (e) {
      console.error('[REF Cliente] No se pudo marcar como no duplicado:', e);
      alert(`No se pudo guardar "No es duplicado".\n\nDetalle: ${String((e as { message?: string })?.message || e)}`);
    } finally {
      setMarcando(null);
    }
  };

  return (
    <div className="rrc-caja">
      <div className="rrc-aviso">
        <b className="rrc-aviso-titulo">⚠️ Ref Cliente duplicada.</b> Estas operaciones tienen una Ref Cliente que ya existe en
        otra operación (de cualquier cliente; no cuentan las canceladas ni las de prueba). Corrige la Ref si es un error,
        o marca <b>No es duplicado</b> si es correcta. Si después cambia la Ref, se vuelve a revisar.
      </div>
      {ops.length === 0 ? (
        cargando
          ? <CargandoDatos texto="Buscando Ref Cliente duplicadas…" />
          : <div className="rrc-vacio">No hay operaciones en revisión. ✅</div>
      ) : (
        <div className="rrc-tabla-caja">
          {cargando && <div className="rrc-verificando"><CargandoDatos compacto texto="Verificando más Ref Cliente…" /></div>}
          <table className="rrc-tabla">
            <thead>
              <tr>
                <th>Ref</th>
                <th>Ref Cliente</th>
                <th>Cliente</th>
                <th>Fecha servicio</th>
                <th>También está en</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {ops.map((op) => {
                const id = idDeLista(op);
                const info = duplicados.get(id);
                if (!info) return null;
                const refCliente = texto(op.refCliente).trim();
                const otras = info.otras.slice(0, MAX_OTRAS);
                return (
                  <tr key={id}>
                    <td className="rrc-ref">{texto(op.ref) || '—'}</td>
                    <td><span className="rrc-ref-cliente">{refCliente}</span> <span className="rrc-insignia">Duplicada</span></td>
                    <td>{nombreCliente(texto(op.clientePaga) || texto(op.clienteId), texto(op.clienteNombre) || texto(op.clientePagaNombre)) || '—'}</td>
                    <td className="rrc-fecha">{texto(op.fechaServicio).slice(0, 10) || '—'}</td>
                    <td>
                      <div className="rrc-otras">
                        {otras.map((o) => (
                          <span key={o.id} className="rrc-otra">
                            <b className="rrc-otra-ref">{o.ref || 'sin ref'}</b>
                            <span className="rrc-otra-cliente">{nombreCliente(o.clienteId, o.clienteNombre) || '—'}</span>
                            {o.refCliente !== refCliente && <span className="rrc-otra-captura" title="Así está capturada en esa operación">“{o.refCliente}”</span>}
                            <span className={`rrc-estado rrc-estado--${claseEstado(o)}`}>{etiquetaEstado(o)}</span>
                            {o.revisada && <span className="rrc-estado rrc-estado--revisada" title="Ya se marcó como no duplicada">Revisada</span>}
                          </span>
                        ))}
                        {info.otras.length > MAX_OTRAS && <span className="rrc-mas">y {info.otras.length - MAX_OTRAS} más</span>}
                      </div>
                    </td>
                    <td className="rrc-acciones">
                      <button type="button" className="rrc-btn" onClick={() => onVer(op)}>{etiquetaVer}</button>
                      <button type="button" className="rrc-btn rrc-btn--ok" disabled={marcando !== null} onClick={() => { void noEsDuplicado(info, refCliente); }}>
                        {marcando === info.clave ? 'Guardando…' : 'No es duplicado'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
