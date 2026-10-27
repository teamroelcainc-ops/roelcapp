// src/features/buscador/components/PanelBuscador.tsx
// ---------------------------------------------------------------------------
// ✅ V00502 — LISTA DEL BUSCADOR GLOBAL (se carga la primera vez que se abre el buscador: la regla de
// dinero, los listeners de facturas y pagos y las consultas no van en el arranque de la app).
// Resultados agrupados, la mejor coincidencia marcada (Enter la abre), ↑ ↓ para moverse; vacío,
// lo abierto hace poco. Las teclas llegan desde la caja (BuscadorTopbar) con `registrarTeclas`.
// ---------------------------------------------------------------------------
import { useEffect, useState } from 'react';
import { Building2, BusFront, Clock3, Container, FileText, Handshake, Truck, UserRound, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import CargandoDatos from '../../../shared/components/CargandoDatos';
import { useResultadosBusqueda } from '../hooks/useResultadosBusqueda';
import { MIN_LETRAS_OPERACIONES } from '../services/buscarOperaciones';
import { guardarReciente, recientes } from '../services/recientes';
import type { GrupoResultado, ResultadoBusqueda } from '../services/resultados';
import './PanelBuscador.css';

const ICONOS: Record<GrupoResultado, LucideIcon> = {
  operaciones: Truck, facturas: FileText, pagos: Wallet, empresas: Building2,
  convenios: Handshake, empleados: UserRound, unidades: BusFront, remolques: Container,
};

/** Tecla de la caja → true si el panel la usó. */
export type ManejadorTeclas = (tecla: string) => boolean;

interface Props {
  id: string;
  texto: string;
  /** Qué filtra además el módulo en pantalla (null = no filtra nada). */
  filtraModulo: string | null;
  registrarTeclas: (fn: ManejadorTeclas | null) => void;
  onAbrir: (r: ResultadoBusqueda) => void;
}

function Fila({ r, activa, onAbrir }: { r: ResultadoBusqueda; activa: boolean; onAbrir: (r: ResultadoBusqueda) => void }) {
  const Icono = ICONOS[r.grupo];
  return (
    <li role="option" aria-selected={activa}>
      <button type="button" tabIndex={-1} className={`bgl-fila${activa ? ' bgl-fila--activa' : ''}`}
        onMouseDown={(e) => e.preventDefault() /* el foco se queda en la caja de texto */} onClick={() => onAbrir(r)}>
        <Icono size={16} className="bgl-icono" aria-hidden="true" />
        <span className="bgl-textos">
          <span className="bgl-titulo">{r.titulo}</span>
          {r.detalle && <span className="bgl-detalle">{r.detalle}</span>}
        </span>
        <span className="bgl-datos">
          {r.fecha && <span className="bgl-fecha">{r.fecha}</span>}
          {r.monto && <span className="bgl-monto">{r.monto}</span>}
          {r.estado && <span className={`bgl-estado bgl-estado--${r.estado.tono}`}>{r.estado.texto}</span>}
        </span>
      </button>
    </li>
  );
}

export default function PanelBuscador({ id, texto, filtraModulo, registrarTeclas, onAbrir }: Props) {
  const { grupos, buscando } = useResultadosBusqueda(texto, true);
  /** null = la mejor coincidencia (la que abre Enter); un número = la elegida con las flechas. */
  const [activo, setActivo] = useState<{ texto: string; i: number } | null>(null);
  const hayTexto = texto.trim().length > 0;
  const lista = hayTexto ? grupos.flatMap((g) => g.resultados) : recientes();
  const mejor = hayTexto ? lista.reduce((m, r, i) => (r.puntaje > lista[m].puntaje ? i : m), 0) : 0;
  // Al cambiar el texto vuelve a la mejor coincidencia (lo elegido con flechas era de otra búsqueda).
  const actual = activo && activo.texto === texto ? Math.min(activo.i, Math.max(lista.length - 1, 0)) : mejor;

  const abrir = (r: ResultadoBusqueda) => { guardarReciente(r); onAbrir(r); };

  const manejar: ManejadorTeclas = (tecla) => {
    if (lista.length === 0) return false;
    if (tecla === 'ArrowDown') { setActivo({ texto, i: (actual + 1) % lista.length }); return true; }
    if (tecla === 'ArrowUp') { setActivo({ texto, i: (actual - 1 + lista.length) % lista.length }); return true; }
    if (tecla === 'Enter') { abrir(lista[actual]); return true; }
    return false;
  };
  useEffect(() => {
    registrarTeclas(manejar);
    return () => registrarTeclas(null);
  });

  if (!hayTexto && lista.length === 0) return null;
  const indiceDe = new Map(lista.map((r, i) => [r.clave, i]));
  const filas = (rs: ResultadoBusqueda[]) => rs.map((r) => (
    <Fila key={r.clave} r={r} activa={indiceDe.get(r.clave) === actual} onAbrir={abrir} />
  ));

  return (
    <div className="bgl-panel" id={id} role="listbox" aria-label="Resultados de la búsqueda">
      {!hayTexto ? (
        <section className="bgl-seccion">
          <h3 className="bgl-grupo"><Clock3 size={13} aria-hidden="true" /> Abiertos hace poco</h3>
          <ul className="bgl-lista">{filas(lista)}</ul>
        </section>
      ) : (
        <>
          {filtraModulo && <p className="bgl-nota">También filtra {filtraModulo} en esta pantalla.</p>}
          {grupos.map((g) => (
            <section className="bgl-seccion" key={g.grupo}>
              <h3 className="bgl-grupo">{g.titulo}{g.cargando && g.resultados.length > 0 && <span className="bgl-grupo-cargando">actualizando…</span>}</h3>
              {g.cargando && g.resultados.length === 0 && <CargandoDatos compacto texto={`Buscando en ${g.titulo.toLowerCase()}…`} />}
              {g.error && <p className="bgl-error">No se pudo buscar en {g.titulo.toLowerCase()}: {g.error}</p>}
              {g.resultados.length > 0 && <ul className="bgl-lista">{filas(g.resultados)}</ul>}
            </section>
          ))}
          {!buscando && grupos.length === 0 && <p className="bgl-vacio">Sin resultados para «{texto.trim()}».</p>}
          {texto.trim().length < MIN_LETRAS_OPERACIONES && (
            <p className="bgl-nota">Escribe {MIN_LETRAS_OPERACIONES} letras o más para buscar también en las operaciones.</p>
          )}
        </>
      )}
      <p className="bgl-pie">Las operaciones se encuentran por el inicio de su referencia, de la ref. cliente o del remolque. ↑ ↓ para moverte · Enter abre · Esc cierra.</p>
    </div>
  );
}
