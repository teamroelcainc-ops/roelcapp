// src/utils/nombreEmpleado.ts
// Los documentos de `empleados` (herencia de AppSheet) NO tienen un campo
// `nombre`: guardan firstName / lastNamePaternal / lastNameMaternal / alias.
// Este helper compone el nombre completo de forma consistente en toda la app.
export interface EmpleadoNombreCampos {
  nombre?: string;
  firstName?: string;
  lastNamePaternal?: string;
  lastNameMaternal?: string;
  alias?: string;
}

export const nombreDeEmpleado = (e: EmpleadoNombreCampos | undefined | null): string => {
  if (!e) return '';
  const compuesto = [e.firstName, e.lastNamePaternal, e.lastNameMaternal]
    .map((p) => String(p || '').trim())
    .filter(Boolean)
    .join(' ');
  return (compuesto || String(e.nombre || '').trim() || String(e.alias || '').trim());
};
