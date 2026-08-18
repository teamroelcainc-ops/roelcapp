/**
 * Modelos de datos: espejo 1:1 del diagrama entidad-relacion.
 * Los nombres de campos y colecciones son identicos a los del diagrama
 * para que Firestore y la documentacion siempre coincidan.
 */

export type ID = string;

export interface BaseDoc {
  id: ID;
  createdAt?: unknown;
  updatedAt?: unknown;
}

/* ---------- Colecciones (nombres exactos del diagrama) ---------- */
export const COLLECTIONS = {
  PURCHASE_ORDER: 'BD_PURCHASEORDER',
  PURCHASE_DETAILS: 'BD_PURCHASEDETAILS',
  SALES_ORDER: 'BD_SALESORDER',
  SALES_ORDER_DETAIL: 'BD_SALESORDERDETAIL',
  EXPENSES: 'BD_EXPENSES',
  PAYMENT_SALES: 'BD_PAYMENTSALES',
  PAYMENT_BILL: 'BD_PAYMENTBILL',
  CUSTOMER: 'BD_CUSTOMER',
  USERS: 'BD_USERS',
  CATEGORY_BILL: 'BD_CATEGORYBILL',
  GROWER: 'CAT_GROWER',
  CARRIER: 'CAT_CARRIER',
  LOCATIONS: 'CAT_LOCATIONS',
  COMMODITIES: 'CAT_COMMODITIES',
  SUPPLIERS: 'CAT_SUPPLIERS',
  SHIPVIA: 'CAT_SHIPVIA',
  TERMSHIPPING: 'CAT_TERMSHIPPING',
  PAYMENT_METHOD: 'CAT_PAYMENTMETHOD',
  PAYMENTTERM: 'CAT_PAYMENTTERM',
  SYSTEM_USERS: 'system_users',
  ROLES: 'settings_roles',
  APP_SETTINGS: 'settings_app',
  CHECKS: 'BD_CHECKS',
  COMPANY: 'settings_company',
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];

/* ---------- Modulo de compras ---------- */
export interface PurchaseOrder extends BaseDoc {
  /** Consecutivo visible tipo PO00061 (columna "Lot #" en la UI). */
  LOT_NUMBER: string;
  ID_GROWER: ID;
  ID_CUSTOMER: ID;
  SHIPTO: ID;
  ID_USERS: ID;
  ID_CARRIER: ID;
  /** Payment term del documento PO (catalogo CAT_PAYMENTTERM). */
  ID_PAYMENTTERM?: ID;
  NOTE: string;
  COMMISION_PERCENT: number;
  REF_NUMBER: string;
  ARRIVAL_DATE: string; // ISO yyyy-mm-dd
  SUBTOTAL: number;
  COMMISION_AMOUNT: number;
  EXPENSES: number;
  TOTAL_EXPENSES: number;
  TOTAL: number;
  AMOUNT_PAID: number;
  BALANCE: number;
  QUANTITY: number;
}

export interface PurchaseDetail extends BaseDoc {
  ID_PURCHASEORDER: ID;
  ID_COMMODITIES: ID;
  DESCRIPTION: string;
  QUANTITY: number;
  PRICE: number;
  TOTAL: number;
}

/* ---------- Modulo de ventas ---------- */
export const SALES_STATUSES = ['Draft', 'Loaded', 'Delivered', 'Paid', 'Cancelled'] as const;
export type SalesStatus = (typeof SALES_STATUSES)[number];

export interface SalesOrder extends BaseDoc {
  ID_CUSTOMER: ID;
  BUYER: string;
  ID_USERS: ID;
  REF: string;
  REF_PICKUP: string;
  DATE: string;
  DUE_DATE: string;
  STATUS: SalesStatus;
  SALES_ORDER_NUMBER: string;
  PICK_UP_NUMBER: string;
  ADDRESS: string;
  CITY_STATE_ZIP: string;
  ID_SUPPLIERS: ID;
  TEMP_LOG: string;
  DESCRIPTION: string;
  ID_CARRIER: ID;
  /** Almacen de despacho (catalogo CAT_LOCATIONS). */
  ID_WAREHOUSE?: ID;
  /** Payment term de los documentos de venta (catalogo CAT_PAYMENTTERM). */
  ID_PAYMENTTERM?: ID;
  ID_TERMSHIPPING: ID;
  ID_SHIPVIA: ID;
  TOTAL: number;
  INCOMES: number;
  BALANCE: number;
  OD_DAY: number;
  SENT: boolean;
}

export interface SalesOrderDetail extends BaseDoc {
  ID_SALESORDER: ID;
  ID_PURCHASEORDER: ID;
  ID_COMMODITIES: ID;
  DESCRIPTION: string;
  QUANTITY: number;
  PRICE: number;
  TOTAL: number;
}

/* ---------- Modulo de gastos ---------- */
export interface Expense extends BaseDoc {
  ID_PURCHASEORDER: ID;
  DEDUCT: boolean;
  ID_SUPPLIERS: ID;
  ID_CATEGORYBILL: ID;
  INVOICE_NUMBER: string;
  DATE: string;
  AMOUNT: number;
  PAY_AMOUNT: number;
  BALANCE: number;
  PHOTO_CHECK: string;
  CHECK_NUMBER: string;
  NOTE: string;
}

/* ---------- Pagos ---------- */
export interface PaymentBase extends BaseDoc {
  DATE: string;
  ID_PAYMENTMETHOD: ID;
  AMOUNT: number;
  CHECK_NUMBER: string;
  REF_NUMBER: string;
  PHOTO: string;
  NOTE: string;
}

export interface PaymentSales extends PaymentBase {
  ID_SALESORDER: ID;
}

export interface PaymentBill extends PaymentBase {
  ID_EXPENSES: ID;
}

/* ---------- Maestras ---------- */
export interface AppUser extends BaseDoc {
  EMAIL_USERS: string;
  USER_LEVEL_USERS: string;
  STATUS_USERS: string;
}

/* ---------- Seguridad: usuarios del sistema y roles ---------- */
export type SystemUserStatus = 'Pending Invite' | 'Active' | 'Inactive';

export interface SystemUser extends BaseDoc {
  firstName: string;
  lastName: string;
  email: string;
  roleId: ID;
  status: SystemUserStatus;
  inviteSent?: boolean;
  inviteSentAt?: string;
}

export type PermissionAction = 'view' | 'add' | 'edit' | 'delete' | 'documents';

export interface ModulePermission {
  module: string;
  canView: boolean;
  canAdd: boolean;
  canEdit: boolean;
  canDelete: boolean;
  /** Acceso a documentos: exportar Excel, plantillas e importar CSV. */
  canDocuments: boolean;
}

export interface AppRole extends BaseDoc {
  name: string;
  description: string;
  permissions: ModulePermission[];
  /** Capacidades del configurador (nav, formularios, ver como). */
  adminPerms?: AdminPerms;
}

/* ---------- Configurador de la app ---------- */
/** Config de un campo de formulario. `key` es la etiqueta por defecto (estable). */
export interface FormFieldConfig {
  key: string;
  label: string;
  required: boolean;
}

export interface AppConfigDoc extends BaseDoc {
  /** Orden del menu de navegacion (ViewKeys). */
  navOrder?: string[];
  /** Nombres personalizados de los items del menu (key -> etiqueta). */
  navLabels?: Record<string, string>;
  /** Config de campos por formulario (orden del arreglo = orden visual). */
  forms?: Record<string, FormFieldConfig[]>;
  /** Personalizacion de cheques. */
  checks?: CheckSettings;
}

/** Capacidades administrativas granulares (punto 7: gobernadas desde Roles). */
export const ADMIN_CAPABILITIES = [
  { id: 'navOrder', label: 'Reorder navigation menu' },
  { id: 'formLabels', label: 'Rename form fields' },
  { id: 'formOrder', label: 'Reorder form fields' },
  { id: 'requiredFields', label: 'Set required fields' },
  { id: 'viewAs', label: 'View as other users' },
  { id: 'checkDesign', label: 'Customize checks' },
] as const;

export type AdminCapability = (typeof ADMIN_CAPABILITIES)[number]['id'];

export type AdminPerms = Partial<Record<AdminCapability, boolean>>;

/* ---------- Empresa (logo, datos y bancos) ---------- */
export interface CompanyBank {
  id: string;
  bankName: string;
  address: string;
  routing: string;
  account: string;
}

export interface CompanyInfo extends BaseDoc {
  name: string;
  address: string;
  cityStateZip: string;
  phone: string;
  email: string;
  /** Logo en data URL base64 (png/jpg pequeño). */
  logo: string;
  banks: CompanyBank[];
}

/* ---------- Cheques ---------- */
export interface Check extends BaseDoc {
  CHECK_NUMBER: number;
  DATE: string;
  /** Cuenta emisora (nombre de la empresa). */
  ACCOUNT: string;
  ID_BANK: string;
  ID_CUSTOMER: ID;
  MEMO: string;
  REF: string;
  AMOUNT: number;
}

/** Personalizacion de la impresion de cheques (Configurator). */
export interface CheckSettings {
  startNumber?: number;
  showLogo?: boolean;
  showAddress?: boolean;
  showBankInfo?: boolean;
  signatureText?: string;
}
