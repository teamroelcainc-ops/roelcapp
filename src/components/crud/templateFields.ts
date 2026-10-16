import type { TemplateField } from '../../services/excelExport';
import type { RefMaps } from '../../hooks/useRefMaps';
import type { FieldConfig } from '../../types/models';

const ID_FIELD: TemplateField = {
  label: 'ID',
  required: false,
  type: 'text',
  hint:
    'AppSheet ID (optional). When present it becomes the identifier: re-importing with the same ID updates the record instead of duplicating it. Reference columns accept this ID or the name.',
};

/**
 * Columnas de la plantilla Excel de un módulo o de un detalle: la columna ID
 * primero y luego cada campo capturable con su lista de valores permitidos.
 * Los campos calculados y los que llena el sistema quedan fuera.
 */
export function buildTemplateFields(fields: FieldConfig[], refMaps: RefMaps): TemplateField[] {
  const dataFields = fields
    .filter(
      (field) =>
        field.compute === undefined && (field.form !== false || field.importable === true),
    )
    .map((field): TemplateField => {
      let options: string[] | undefined;
      let hint = 'Text';
      switch (field.type) {
        case 'enum':
          options = [...(field.enumValues ?? [])];
          hint = `One of: ${(field.enumValues ?? []).join(', ')}`;
          break;
        case 'bool':
          options = ['YES', 'NO'];
          hint = 'YES or NO';
          break;
        case 'ref': {
          const refData = field.refCollection ? refMaps[field.refCollection] : undefined;
          if (refData) {
            let refRows = refData.rows;
            if (field.refFilter) {
              const target = String(field.refFilter.value).toUpperCase();
              const filterKey = field.refFilter.field;
              refRows = refRows.filter(
                (r) => String(r[filterKey] ?? '').toUpperCase() === target,
              );
            }
            options = refRows
              .map((r) => refData.labels.get(r.id) ?? '')
              .filter((label) => label !== '')
              .sort((a, b) => a.localeCompare(b));
          }
          hint = 'Exact name as shown in the app (use the dropdown)';
          break;
        }
        case 'date':
          hint = 'Date DD/MM/YYYY';
          break;
        case 'number':
        case 'currency':
          hint = 'Number';
          break;
        case 'textarea':
          hint = 'Long text';
          break;
        default:
          hint = 'Text';
      }
      return {
        label: field.label,
        required: field.required === true,
        type: field.type,
        options,
        hint,
      };
    });
  return [ID_FIELD, ...dataFields];
}