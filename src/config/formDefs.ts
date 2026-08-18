/** Formularios configurables y sus campos por defecto (clave = etiqueta en codigo). */
export interface FormDef {
  id: string;
  label: string;
  fields: string[];
}

export const FORM_DEFS: FormDef[] = [
  {
    id: 'purchases',
    label: 'Purchase order form',
    fields: ['Lot #', 'Grower / Origin', 'Vendor', 'Ship to', 'Buyer', 'Note', 'Commission %', '# Ref', 'Carrier', 'Arrival date', 'Payment term'],
  },
  {
    id: 'sales',
    label: 'Sales order form',
    fields: ['# Sales order', 'Status', 'Date', 'Due date', 'Customer', 'Buyer', 'Salesperson', 'Ref', 'Ref pickup', 'Carrier', 'Warehouse', 'Temp log', 'Description'],
  },
  {
    id: 'expenses',
    label: 'Expense form',
    fields: ['# Lot (purchase order)', 'Supplier', 'Category', 'Invoice #', 'Date', 'Amount', 'Check #', 'Photo check (URL)', 'Deduct', 'Note'],
  },
];
