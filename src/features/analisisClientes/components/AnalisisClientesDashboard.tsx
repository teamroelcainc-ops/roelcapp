// src/features/analisisClientes/components/AnalisisClientesDashboard.tsx
// ---------------------------------------------------------------------------
// ✅ V00479 — ANÁLISIS DE CLIENTES: qué clientes crecen, bajan, dejaron de operar o son nuevos,
// con las operaciones del año (una lectura por rango, guardada con TanStack Query).
//   · Resumen            — "Qué está cambiando" por Cliente Paga y Cliente Mercancía.
//   · Cliente Paga / Mercancía — tabla con estado y ficha del cliente.
//   · Días y pausas      — cuántos días opera cada cliente y sus pausas.
// Cada nombre abre sus operaciones, de la más reciente a la primera.
// ---------------------------------------------------------------------------
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import CargandoDatos from '../../../shared/components/CargandoDatos';
import { idReal, useCatalogo } from '../../../shared/data/catalogos';
import { hoyLocalISO } from '../../../utils/fechaHoraLocal';
import { aOpAnalisis, analizarClientes, fmtDiaMes, periodoDelAnio } from '../services/analisisClientes';
import type { EstadoCliente, FichaCliente, OpAnalisis, RolCliente } from '../services/analisisClientes';
import { CLAVE_ANALISIS_CLIENTES, leerOperacionesDelPeriodo } from '../services/analisisClientesDatos';
import ResumenClientes from './ResumenClientes';
import TablaClientes from './TablaClientes';
import DiasYPausas from './DiasYPausas';
import OperacionesDeCliente from './OperacionesDeCliente';
import './AnalisisClientesDashboard.css';

type Pestana = 'resumen' | RolCliente | 'pausas';
const PESTANAS: { clave: Pestana; texto: string }[] = [
  { clave: 'resumen', texto: 'Resumen' },
  { clave: 'paga', texto: 'Cliente Paga' },
  { clave: 'mercancia', texto: 'Cliente Mercancía' },
  { clave: 'pausas', texto: 'Días y pausas' },
];

export default function AnalisisClientesDashboard() {
  const hoy = hoyLocalISO();
  const anioActual = Number(hoy.slice(0, 4));
  const [anio, setAnio] = useState(anioActual);
  const [pestana, setPestana] = useState<Pestana>('resumen');
  const [filtroEstado, setFiltroEstado] = useState<Record<RolCliente, EstadoCliente | null>>({ paga: null, mercancia: null });
  const [opsDe, setOpsDe] = useState<{ rol: RolCliente; id: string; nombre: string } | null>(null);
  const periodo = useMemo(() => periodoDelAnio(anio, hoy), [anio, hoy]);
  const mesFin = Number(periodo.fin.slice(5, 7)) - 1;

  const { datos: empresas } = useCatalogo('empresas');
  const consulta = useQuery({
    queryKey: [...CLAVE_ANALISIS_CLIENTES, periodo.inicio, periodo.fin],
    queryFn: () => leerOperacionesDelPeriodo(periodo),
    staleTime: 10 * 60 * 1000,
  });

  // Nombre ACTUAL de la empresa (catálogo); si no está, el que guardó la operación.
  const nombreEmpresa = useMemo(() => {
    const m = new Map<string, string>();
    empresas.forEach((e) => {
      const n = String(e.nombre ?? '').trim();
      if (n) { m.set(String(e.id), n); m.set(idReal(e), n); }
    });
    return (id: string) => m.get(id);
  }, [empresas]);
  const ops = useMemo<OpAnalisis[]>(
    () => (consulta.data ?? []).map((d) => aOpAnalisis(d, nombreEmpresa)).filter((o): o is OpAnalisis => o !== null),
    [consulta.data, nombreEmpresa],
  );
  const fichas = useMemo(() => ({ paga: analizarClientes(ops, 'paga', periodo), mercancia: analizarClientes(ops, 'mercancia', periodo) }), [ops, periodo]);

  const verOps = (rol: RolCliente, f: FichaCliente) => setOpsDe({ rol, id: f.id, nombre: f.nombre });
  const verEstado = (rol: RolCliente, estado: EstadoCliente) => {
    setFiltroEstado((prev) => ({ ...prev, [rol]: estado }));
    setPestana(rol);
  };
  const anios = [anioActual, anioActual - 1, anioActual - 2];

  return (
    <div className="module-container acs-modulo">
      <header className="acs-encabezado">
        <div>
          <h1 className="acs-titulo">Análisis de clientes</h1>
          <p className="acs-sub">
            {consulta.isSuccess
              ? `${ops.length.toLocaleString('es-MX')} operaciones del ${fmtDiaMes(periodo.inicio)} al ${fmtDiaMes(periodo.fin)} de ${anio} (sin canceladas)`
              : `Operaciones del ${fmtDiaMes(periodo.inicio)} al ${fmtDiaMes(periodo.fin)} de ${anio}`}
          </p>
        </div>
        <div className="acs-acciones">
          <label className="acs-anio">
            <span>Año</span>
            <select className="form-control" value={anio} onChange={(e) => setAnio(Number(e.target.value))}>
              {anios.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <button type="button" className="acs-actualizar" onClick={() => { void consulta.refetch(); }} disabled={consulta.isFetching}>
            <RefreshCw size={15} aria-hidden="true" className={consulta.isFetching ? 'acs-girando' : undefined} />
            {consulta.isFetching ? 'Actualizando…' : 'Actualizar'}
          </button>
        </div>
      </header>

      <nav className="acs-pestanas" aria-label="Vistas del análisis">
        {PESTANAS.map((p) => (
          <button key={p.clave} type="button" className={`acs-pestana${pestana === p.clave ? ' acs-pestana--activa' : ''}`}
            aria-current={pestana === p.clave ? 'page' : undefined} onClick={() => setPestana(p.clave)}>
            {p.texto}
          </button>
        ))}
      </nav>

      {consulta.isPending ? (
        <CargandoDatos texto="Leyendo las operaciones del año…" />
      ) : consulta.isError ? (
        <div className="acs-error">
          <p>No se pudieron leer las operaciones. Revisa tu conexión.</p>
          <button type="button" className="btn btn-outline" onClick={() => { void consulta.refetch(); }}>Reintentar</button>
        </div>
      ) : pestana === 'resumen' ? (
        <ResumenClientes fichas={fichas} totalOps={ops.length} onVerOps={verOps} onVerEstado={verEstado} />
      ) : pestana === 'pausas' ? (
        <DiasYPausas fichas={fichas} onVerOps={verOps} />
      ) : (
        <TablaClientes
          key={pestana}
          rol={pestana}
          fichas={fichas[pestana]}
          filtroEstado={filtroEstado[pestana]}
          onFiltroEstado={(e) => setFiltroEstado((prev) => ({ ...prev, [pestana]: e }))}
          onVerOps={(f) => verOps(pestana, f)}
          mesFin={mesFin}
        />
      )}

      {opsDe && (
        <OperacionesDeCliente ops={ops} rol={opsDe.rol} clienteId={opsDe.id} nombre={opsDe.nombre} periodo={periodo} onCerrar={() => setOpsDe(null)} />
      )}
    </div>
  );
}
