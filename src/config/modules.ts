import type { ModulePermission } from '../types/models';

/**
 * Modulos del sistema para la matriz de permisos.
 * Los ids DEBEN coincidir con los ViewKey usados por AppLayout/App.
 */
export interface ModuleDef {
  id: string;
  label: string;
  /** Si el modulo maneja documentos (Excel/CSV/plantillas). */
  hasDocuments: boolean;
}

export const MODULE_DEFS: ModuleDef[] = [
  { id: 'dashboard', label: 'Dashboard', hasDocuments: false },
  { id: 'purchases', label: 'Purchase Orders', hasDocuments: true },
  { id: 'sales', label: 'Sales Desk', hasDocuments: true },
  { id: 'expenses', label: 'Expenses', hasDocuments: true },
  { id: 'catalogs', label: 'Catalogs', hasDocuments: true },
  { id: 'lots', label: 'Lot Activity', hasDocuments: false },
  { id: 'inventory', label: 'Inventory', hasDocuments: true },
  { id: 'reports', label: 'Reports', hasDocuments: true },
  { id: 'checks', label: 'Checkbook', hasDocuments: true },
  { id: 'company', label: 'Company Info', hasDocuments: false },
  { id: 'users', label: 'System Users', hasDocuments: false },
  { id: 'roles', label: 'Roles & Permissions', hasDocuments: false },
  { id: 'config', label: 'Configurator', hasDocuments: false },
];

export const buildEmptyPermissions = (): ModulePermission[] =>
  MODULE_DEFS.map((mod) => ({
    module: mod.id,
    canView: false,
    canAdd: false,
    canEdit: false,
    canDelete: false,
    canDocuments: false,
  }));

/** Mergea permisos guardados con la lista actual de modulos (por si se agregaron modulos nuevos). */
export const mergePermissions = (saved: ModulePermission[] | undefined): ModulePermission[] =>
  MODULE_DEFS.map((mod) => {
    const existing = (saved ?? []).find((p) => p.module === mod.id);
    return existing
      ? {
          module: mod.id,
          canView: !!existing.canView,
          canAdd: !!existing.canAdd,
          canEdit: !!existing.canEdit,
          canDelete: !!existing.canDelete,
          canDocuments: !!existing.canDocuments,
        }
      : {
          module: mod.id,
          canView: false,
          canAdd: false,
          canEdit: false,
          canDelete: false,
          canDocuments: false,
        };
  });
