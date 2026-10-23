// src/features/analisisClientes/components/ResumenClientes.tsx
// ✅ V00479 — Resumen: totales, clientes por estado y "Qué está cambiando" (clientes con 20 o más
// operaciones, por cómo se comportan en los últimos 3 meses frente al resto del año).
import { ETIQUETA_ESTADO, ORDEN_ESTADOS, REGLAS, fmtCambio, fmtDiaMes, queEstaCambiando } from '../services/analisisClientes';
import type { EstadoCliente, FichaCliente, RolCliente } from '../services/analisisClientes';
import './ResumenClientes.css';

const VISIBLES = 6;
const NOMBRE_ROL: Record<RolCliente, string> = { paga: 'Cliente Paga', mercancia: 'Cliente Mercancía' };
const BLOQUES: { clave: 'inactivos' | 'bajando' | 'creciendo' | 'nuevos'; estado: EstadoCliente; titulo: string }[] = [
  { clave: 'inactivos', estado: 'inactivo', titulo: 'Inactivos' },
  { clave: 'bajando', estado: 'bajando', titulo: 'Bajando' },
  { clave: 'creciendo', estado: 'creciendo', titulo: 'Creciendo' },
  { clave: 'nuevos', estado: 'nuevo', titulo: 'Nuevos' },
];

interface Props {
  fichas: Record<RolCliente, FichaCliente[]>;
  totalOps: number;
  onVerOps: (rol: RolCliente, f: FichaCliente) => void;
  onVerEstado: (rol: RolCliente, estado: EstadoCliente) => void;
}

const valorDe = (estado: EstadoCliente, f: FichaCliente): string =>
  estado === 'inactivo' ? `última ${fmtDiaMes(f.ultima)}` : estado === 'nuevo' ? `desde ${fmtDiaMes(f.primera)}` : fmtCambio(f.cambio);

export default function ResumenClientes({ fichas, totalOps, onVerOps, onVerEstado }: Props) {
  const roles: RolCliente[] = ['paga', 'mercancia'];
  const cambios = { paga: queEstaCambiando(fichas.paga), mercancia: queEstaCambiando(fichas.mercancia) };
  const bloques = roles.flatMap((rol) => BLOQUES.map((b) => ({ ...b, rol, lista: cambios[rol][b.clave] }))).filter((b) => b.lista.length > 0);

  return (
    <div className="acr-resumen">
      <div className="acr-totales">
        <div className="acr-total">
          <span className="acr-total-etq">Operaciones</span>
          <span className="acr-total-num">{totalOps.toLocaleString('es-MX')}</span>
        </div>
        {roles.map((rol) => (
          <div className="acr-total" key={rol}>
            <span className="acr-total-etq">{rol === 'paga' ? 'Clientes que pagan' : 'Clientes de mercancía'}</span>
            <span className="acr-total-num">{fichas[rol].length.toLocaleString('es-MX')}</span>
            <ul className="acr-estados">
              {ORDEN_ESTADOS.map((e) => {
                const n = fichas[rol].filter((f) => f.estado === e).length;
                return n > 0 && (
                  <li key={e}>
                    <button type="button" className={`acr-estado acr-estado--${e}`} onClick={() => onVerEstado(rol, e)}>
                      {n} {ETIQUETA_ESTADO[e].toLowerCase()}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <section className="acr-cambiando" aria-labelledby="acr-titulo">
        <h2 id="acr-titulo" className="acr-titulo">Qué está cambiando</h2>
        <p className="acr-descripcion">
          Clientes con {REGLAS.minOps} o más operaciones en el año, agrupados por cómo se comportan en los últimos 3 meses frente al resto del año.
          El número es el cambio en operaciones por semana.
        </p>
        {bloques.length === 0 ? (
          <p className="acr-vacio">Ningún cliente con {REGLAS.minOps} o más operaciones cambió de ritmo: todos están estables.</p>
        ) : (
          <div className="acr-bloques">
            {bloques.map((b) => (
              <div className={`acr-bloque acr-bloque--${b.estado}`} key={`${b.rol}-${b.clave}`}>
                <h3 className="acr-bloque-titulo">{b.titulo} · {NOMBRE_ROL[b.rol]}</h3>
                <ul className="acr-lista">
                  {b.lista.slice(0, VISIBLES).map((f) => (
                    <li className="acr-fila" key={f.id}>
                      <button type="button" className="acr-nombre" onClick={() => onVerOps(b.rol, f)} title="Ver sus operaciones">{f.nombre}</button>
                      <span className="acr-valor">{valorDe(b.estado, f)}</span>
                    </li>
                  ))}
                </ul>
                {b.lista.length > VISIBLES && (
                  <button type="button" className="acr-mas" onClick={() => onVerEstado(b.rol, b.estado)}>y {b.lista.length - VISIBLES} más</button>
                )}
              </div>
            ))}
          </div>
        )}
        <details className="acr-reglas">
          <summary>Cómo se clasifica cada cliente</summary>
          <p>Se cuentan las operaciones del año (del 1 de enero a hoy), sin canceladas ni pruebas. Cada cliente recibe el primer estado que le aplica:</p>
          <ol>
            <li><b>Ocasional:</b> menos de {REGLAS.minOps} operaciones en el año.</li>
            <li><b>Inactivo:</b> ninguna operación en las últimas {REGLAS.diasInactivo / 7} semanas.</li>
            <li><b>Nuevo:</b> su primera operación del año fue en los últimos 6 meses.</li>
            <li><b>Creciendo:</b> sus operaciones por semana de los últimos 3 meses ({REGLAS.semanasUlt3m} semanas) son {Math.round(REGLAS.cambio * 100)}% o más que las de antes (desde su primera operación del año hasta hace 3 meses).</li>
            <li><b>Bajando:</b> son {Math.round(REGLAS.cambio * 100)}% o menos que las de antes.</li>
            <li><b>Estable:</b> el resto.</li>
          </ol>
          <p>
            <b>Día fuerte:</b> el día de la semana con más operaciones. <b>% de días que opera:</b> días con operación entre los días de lunes a sábado desde su primera operación.
            <b> Días hábiles sin operar:</b> días de lunes a viernes, desde su primera operación, sin ninguna. <b>Pausa más larga:</b> días seguidos sin operar entre dos operaciones.
          </p>
        </details>
      </section>
    </div>
  );
}
