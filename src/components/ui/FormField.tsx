import { Pencil, Plus } from 'lucide-react';
import { SearchableSelect, type SelectOption } from './SearchableSelect';
import type { FieldConfig, FieldValue } from '../../types/models';
import './FormField.css';

interface FormFieldProps {
  field: FieldConfig;
  value: FieldValue;
  invalid: boolean;
  refOptions: SelectOption[];
  /**
   * Si se define, el campo de referencia muestra un botón "+" para dar de alta
   * el registro del catálogo sin salir del formulario.
   */
  onQuickAdd?: () => void;
  /** Edición rápida del registro referenciado seleccionado (lápiz). */
  onQuickEdit?: () => void;
  onChange: (key: string, value: FieldValue) => void;
}

/**
 * Renderiza el control correcto según el tipo del campo.
 * Un solo componente para todos los formularios del app.
 */
export function FormField({
  field,
  value,
  invalid,
  refOptions,
  onQuickAdd,
  onQuickEdit,
  onChange,
}: FormFieldProps) {
  const inputClass = `field-input ${invalid ? 'field-invalid' : ''}`;

  /**
   * ¿El campo tiene contenido? En móvil la etiqueta va DENTRO del campo y
   * sube cuando hay valor o foco (patrón de etiqueta flotante). Con esto se
   * consigue la vista limpia de una sola caja por renglón sin perder la
   * etiqueta al escribir, que es el problema de usar solo placeholder.
   */
  const filled =
    value !== null && value !== undefined && value !== '' && value !== false;

  const renderControl = () => {
    switch (field.type) {
      case 'textarea':
        return (
          <textarea
            className={inputClass}
            rows={3}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(field.key, e.target.value)}
          />
        );
      case 'number':
      case 'currency':
        return (
          <input
            className={inputClass}
            type="number"
            step={field.type === 'currency' ? '0.01' : '1'}
            value={typeof value === 'number' ? value : value === null ? '' : String(value)}
            onChange={(e) =>
              onChange(field.key, e.target.value === '' ? null : Number(e.target.value))
            }
          />
        );
      case 'date':
        return (
          <input
            className={inputClass}
            type="date"
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(field.key, e.target.value)}
          />
        );
      case 'time':
        return (
          <input
            className={inputClass}
            type="time"
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(field.key, e.target.value)}
          />
        );
      case 'bool':
        return (
          <label className="field-check">
            <input
              type="checkbox"
              checked={value === true}
              onChange={(e) => onChange(field.key, e.target.checked)}
            />
            <span>Yes</span>
          </label>
        );
      case 'enum':
        return (
          <SearchableSelect
            value={typeof value === 'string' ? value : ''}
            invalid={invalid}
            options={(field.enumValues ?? []).map((v) => ({ value: v, label: v }))}
            onChange={(v) => onChange(field.key, v)}
          />
        );
      case 'ref': {
        // El lápiz solo aparece con un registro elegido: edita ESE registro.
        const showEdit = onQuickEdit !== undefined && typeof value === 'string' && value !== '';
        if (onQuickAdd || showEdit) {
          return (
            <div className="field-with-add">
              <SearchableSelect
                value={typeof value === 'string' ? value : ''}
                invalid={invalid}
                options={refOptions}
                onChange={(v) => onChange(field.key, v)}
              />
              {showEdit ? (
                <button
                  type="button"
                  className="field-add"
                  title={`Edit the selected ${field.label.toLowerCase()} (name and details) without leaving this form`}
                  aria-label={`Edit ${field.label}`}
                  onClick={onQuickEdit}
                >
                  <Pencil size={15} />
                </button>
              ) : null}
              {onQuickAdd ? (
                <button
                  type="button"
                  className="field-add"
                  title={`Add a new ${field.label.toLowerCase()} without leaving this form`}
                  aria-label={`Add ${field.label}`}
                  onClick={onQuickAdd}
                >
                  <Plus size={16} />
                </button>
              ) : null}
            </div>
          );
        }
        return (
          <SearchableSelect
            value={typeof value === 'string' ? value : ''}
            invalid={invalid}
            options={refOptions}
            onChange={(v) => onChange(field.key, v)}
          />
        );
      }
      default:
        return (
          <input
            className={inputClass}
            type="text"
            value={typeof value === 'string' ? value : value === null ? '' : String(value)}
            onChange={(e) => onChange(field.key, e.target.value)}
          />
        );
    }
  };

  // Las casillas Sí/No traen su propia etiqueta al lado: no flotan.
  const floats = field.type !== 'bool';

  return (
    <div
      className={[
        'field',
        field.type === 'textarea' ? 'field-full' : '',
        floats ? 'field-floats' : '',
        filled ? 'is-filled' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <label className="field-label">
        {field.label}
        {field.required ? <span className="field-required">*</span> : null}
      </label>
      {renderControl()}
      {invalid ? <span className="field-error">This field is required</span> : null}
    </div>
  );
}
