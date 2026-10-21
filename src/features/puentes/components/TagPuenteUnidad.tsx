// src/features/puentes/components/TagPuenteUnidad.tsx
// ✅ V00465: el TAG de la unidad que corresponde al puente de la operación (TAG AVI,
//   TAG Puente 3 o TAG Puente Colombia), debajo de la unidad en la ficha y junto al
//   puente en el formulario. La unidad sale del catálogo compartido (sin lecturas extra).
import CargandoDatos from '../../../shared/components/CargandoDatos';
import { idReal, useCatalogo } from '../../../shared/data/catalogos';
import { tagDeUnidad, type GrupoTag } from '../services/tagPuente';
import './TagPuenteUnidad.css';

interface Props {
  /** Id de la unidad propia (campo `unidad` de la operación). */
  unidadId: unknown;
  /** Puente de la operación (grupoTagDeOperacion); '' no muestra nada. */
  grupo: GrupoTag | '';
}

export default function TagPuenteUnidad({ unidadId, grupo }: Props) {
  const { datos: unidades, listo } = useCatalogo('unidades');
  const uid = String(unidadId ?? '').trim();
  if (!uid || !grupo) return null;
  const unidad = unidades.find((u) => idReal(u) === uid || String(u.id) === uid);
  const info = tagDeUnidad(unidad, grupo);
  if (!info) return null;
  if (!unidad && !listo) {
    return <span className="tpu">{info.etiqueta}: <CargandoDatos enLinea texto="Buscando el TAG de la unidad…" /></span>;
  }
  return (
    <span className={`tpu${info.tag ? '' : ' tpu--falta'}`} title={info.tag ? undefined : 'Esta unidad no tiene este TAG. Agrégalo en Unidades Propias.'}>
      {info.etiqueta}: {info.tag ? <b className="tpu-valor">{info.tag}</b> : 'sin registrar'}
    </span>
  );
}
