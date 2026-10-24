// src/features/facturacion/components/CamposCancelacion.tsx
// ✅ V00481 — los dos datos que exige cancelar una factura: la nota (por qué) y el número de la
// factura que la reemplaza. Se usan en la ventana de cancelar (ficha) y en Editar Factura.
import type { DatosCancelacion } from '../services/reglasFactura';
import './CamposCancelacion.css';

interface Props {
  /** Prefijo de los id de los campos (dos instancias en pantalla no chocan). */
  idBase: string;
  valor: DatosCancelacion;
  onCambiar: (valor: DatosCancelacion) => void;
  /** Números de factura que se sugieren para el reemplazo (las de la misma empresa). */
  sugerencias?: readonly string[];
  deshabilitado?: boolean;
}

export default function CamposCancelacion({ idBase, valor, onCambiar, sugerencias = [], deshabilitado = false }: Props) {
  const idLista = `${idBase}-facturas`;
  return (
    <fieldset className="ccf-campos" disabled={deshabilitado}>
      <legend className="ccf-titulo">Cancelación</legend>
      <label className="ccf-campo" htmlFor={`${idBase}-reemplazo`}>
        <span className="ccf-etiqueta">Factura que la reemplaza <b aria-hidden="true">*</b></span>
        <input id={`${idBase}-reemplazo`} className="ccf-entrada" type="text" required list={sugerencias.length ? idLista : undefined}
          placeholder="Número de la factura nueva" value={valor.reemplazo}
          onChange={(e) => onCambiar({ ...valor, reemplazo: e.target.value })} />
      </label>
      {sugerencias.length > 0 && (
        <datalist id={idLista}>{sugerencias.map((s) => <option key={s} value={s} />)}</datalist>
      )}
      <label className="ccf-campo" htmlFor={`${idBase}-nota`}>
        <span className="ccf-etiqueta">Nota: por qué se cancela <b aria-hidden="true">*</b></span>
        <textarea id={`${idBase}-nota`} className="ccf-entrada ccf-nota" required rows={3}
          placeholder="Ej. Se facturó con el RFC equivocado" value={valor.nota}
          onChange={(e) => onCambiar({ ...valor, nota: e.target.value })} />
      </label>
    </fieldset>
  );
}
