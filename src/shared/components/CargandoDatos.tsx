// src/shared/components/CargandoDatos.tsx
// ✅ V00449: animación de espera mientras llega la información de un filtro o una
//   búsqueda. Sustituye los textos sueltos ("Cargando…") y los huecos en blanco: la
//   pantalla siempre muestra que está trabajando. Va dentro de la tabla (en una celda
//   con colSpan) o en lugar de ella.
import './CargandoDatos.css';

interface Props {
  /** Qué se está cargando ("Cargando facturas…"). */
  texto?: string;
  /** Sin las barras de relleno: para espacios chicos (tarjetas, modales). */
  compacto?: boolean;
  /** Solo el círculo que gira, dentro de una línea de texto (el número de una tarjeta). */
  enLinea?: boolean;
}

export default function CargandoDatos({ texto = 'Cargando…', compacto = false, enLinea = false }: Props) {
  if (enLinea) return <span className="cgd-giro cgd-giro--en-linea" role="status" aria-label={texto} />;
  return (
    <div className={`cgd-caja${compacto ? ' cgd-caja--compacta' : ''}`} role="status" aria-live="polite">
      <div className="cgd-encabezado">
        <span className="cgd-giro" aria-hidden="true" />
        <span className="cgd-texto">{texto}</span>
      </div>
      {!compacto && (
        <div className="cgd-filas" aria-hidden="true">
          <span className="cgd-fila" />
          <span className="cgd-fila" />
          <span className="cgd-fila" />
          <span className="cgd-fila" />
        </div>
      )}
    </div>
  );
}
