import { COLLECTIONS } from '../../types/models';

export interface CatalogFieldDef {
  key: string;
  label: string;
  /** Campo obligatorio al guardar en el catalogo. */
  required?: boolean;
}

export interface CatalogDef {
  collection: string;
  label: string;
  /** Llave primaria tal como viene de AppSheet (usada por el template y la importacion). */
  idField: string;
  nameField: string;
  nameLabel: string;
  extraFields: CatalogFieldDef[];
  /** Limite de registros permitidos (ej. Payment Terms = 1). */
  maxRecords?: number;
}

/**
 * Configuracion declarativa de catalogos y maestras:
 * una sola vista generica (CatalogsView) administra todas estas colecciones.
 */
export const CATALOG_DEFS: CatalogDef[] = [
  { collection: COLLECTIONS.GROWER, label: 'Growers', idField: 'ID_GROWER', nameField: 'NAME_GROWER', nameLabel: 'Name', extraFields: [{ key: 'PREFIX_GROWER', label: 'Prefix', required: true }] },
  {
    collection: COLLECTIONS.CUSTOMER,
    label: 'Customers',
    idField: 'ID_CUSTOMER',
    nameField: 'NAME_CUSTOMER',
    nameLabel: 'Name',
    extraFields: [
      { key: 'ADDRESS_CUSTOMER', label: 'Address' },
      { key: 'CITY_CUSTOMER', label: 'City' },
      { key: 'ACCOUNTING_EMAIL_CUSTOMER', label: 'Accounting email' },
      { key: 'ACCOUNTING_EMAIL_TWO_CUSTOMER', label: 'Accounting email 2' },
      { key: 'PHONE_ONE_CUSTOMER', label: 'Phone 1' },
      { key: 'PHONE_TWO_CUSTOMER', label: 'Phone 2' },
    ],
  },
  { collection: COLLECTIONS.SUPPLIERS, label: 'Suppliers', idField: 'ID_SUPPLIERS', nameField: 'NAME_SUPPLIERS', nameLabel: 'Name', extraFields: [{ key: 'ADDRESS_SUPPLIERS', label: 'Address' }, { key: 'PHONE_SUPPLIERS', label: 'Phone' }] },
  { collection: COLLECTIONS.CARRIER, label: 'Carriers', idField: 'ID_CARRIER', nameField: 'NAME_CARRIER', nameLabel: 'Name', extraFields: [] },
  { collection: COLLECTIONS.PAYMENTTERM, label: 'Payment Terms', idField: 'ID_PAYMENTTERM', nameField: 'NAME_PAYMENTTERM', nameLabel: 'Name (e.g. 21 Days)', extraFields: [], maxRecords: 1 },
  {
    collection: COLLECTIONS.LOCATIONS,
    label: 'Locations',
    idField: 'ID_LOCATIONS',
    nameField: 'NAME_LOCATIONS',
    nameLabel: 'Name',
    extraFields: [
      { key: 'ADDRESS_LOCATIONS', label: 'Address' },
      { key: 'EMAIL_LOCATIONS', label: 'Email' },
      { key: 'PHONE_LOCATIONS', label: 'Phone' },
    ],
  },
  {
    collection: COLLECTIONS.COMMODITIES,
    label: 'Commodities',
    idField: 'ID_COMMODITIES',
    nameField: 'NAME_COMMODITIES',
    nameLabel: 'Name',
    extraFields: [{ key: 'DESCRIPTION_COMMODITIES', label: 'Description', required: true }],
  },
  { collection: COLLECTIONS.SHIPVIA, label: 'Ship via', idField: 'ID_SHIPVIA', nameField: 'NAME_SHIPVIA', nameLabel: 'Name', extraFields: [] },
  { collection: COLLECTIONS.TERMSHIPPING, label: 'Shipping terms', idField: 'ID_TERMSHIPPING', nameField: 'NAME_TERMSHIPPING', nameLabel: 'Name', extraFields: [] },
  { collection: COLLECTIONS.PAYMENT_METHOD, label: 'Payment methods', idField: 'ID_PAYMENTMETHOD', nameField: 'NAME', nameLabel: 'Name', extraFields: [] },
  { collection: COLLECTIONS.CATEGORY_BILL, label: 'Bill categories', idField: 'ID_CATEGORYBILL', nameField: 'NAME', nameLabel: 'Name', extraFields: [] },
  {
    collection: COLLECTIONS.USERS,
    label: 'Users',
    idField: 'ID_USERS',
    nameField: 'EMAIL_USERS',
    nameLabel: 'Email',
    extraFields: [
      { key: 'USER_LEVEL_USERS', label: 'User level' },
      { key: 'STATUS_USERS', label: 'Status' },
    ],
  },
];
