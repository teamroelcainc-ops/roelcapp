import { COLLECTIONS } from '../types/models';

export type FieldType = 'text' | 'number' | 'boolean' | 'date';

export interface EntityField {
  key: string;
  type: FieldType;
  width?: number;
  /** Coleccion a la que apunta el campo cuando es una llave foranea. */
  ref?: string;
}

export interface EntitySchema {
  collection: string;
  /** Etiqueta legible; tambien es el nombre de la hoja en el Excel. */
  label: string;
  /** Nombre de la llave primaria tal como viene de AppSheet. */
  idField: string;
  fields: EntityField[];
}

/**
 * Esquemas usados por el template de Excel y por la importacion de CSV.
 * El orden de los campos define el orden de las columnas del template.
 */
export const PURCHASE_ORDER_SCHEMA: EntitySchema = {
  collection: COLLECTIONS.PURCHASE_ORDER,
  label: 'Purchase Orders',
  idField: 'ID_PURCHASEORDER',
  fields: [
    { key: 'LOT_NUMBER', type: 'text', width: 14 },
    { key: 'REF_NUMBER', type: 'text', width: 16 },
    { key: 'ARRIVAL_DATE', type: 'date', width: 14 },
    { key: 'ID_GROWER', type: 'text', width: 24, ref: COLLECTIONS.GROWER },
    { key: 'ID_CUSTOMER', type: 'text', width: 24, ref: COLLECTIONS.CUSTOMER },
    { key: 'ID_USERS', type: 'text', width: 24, ref: COLLECTIONS.USERS },
    { key: 'ID_CARRIER', type: 'text', width: 24, ref: COLLECTIONS.CARRIER },
    { key: 'SHIPTO', type: 'text', width: 24, ref: COLLECTIONS.LOCATIONS },
    { key: 'QUANTITY', type: 'number', width: 12 },
    { key: 'SUBTOTAL', type: 'number', width: 14 },
    { key: 'COMMISION_PERCENT', type: 'number', width: 16 },
    { key: 'COMMISION_AMOUNT', type: 'number', width: 16 },
    { key: 'EXPENSES', type: 'number', width: 14 },
    { key: 'TOTAL_EXPENSES', type: 'number', width: 16 },
    { key: 'TOTAL', type: 'number', width: 14 },
    { key: 'AMOUNT_PAID', type: 'number', width: 14 },
    { key: 'BALANCE', type: 'number', width: 14 },
    { key: 'NOTE', type: 'text', width: 34 },
  ],
};

export const PURCHASE_DETAIL_SCHEMA: EntitySchema = {
  collection: COLLECTIONS.PURCHASE_DETAILS,
  label: 'Purchase Details',
  idField: 'ID_PURCHASEDETAILS',
  fields: [
    { key: 'ID_PURCHASEORDER', type: 'text', width: 26, ref: COLLECTIONS.PURCHASE_ORDER },
    { key: 'ID_COMMODITIES', type: 'text', width: 26, ref: COLLECTIONS.COMMODITIES },
    { key: 'QUANTITY', type: 'number', width: 12 },
    { key: 'PRICE', type: 'number', width: 12 },
    { key: 'TOTAL', type: 'number', width: 14 },
  ],
};

export const SALES_ORDER_SCHEMA: EntitySchema = {
  collection: COLLECTIONS.SALES_ORDER,
  label: 'Sales Orders',
  idField: 'ID_SALESORDER',
  fields: [
    { key: 'SALES_ORDER_NUMBER', type: 'text', width: 18 },
    { key: 'DATE', type: 'date', width: 14 },
    { key: 'DUE_DATE', type: 'date', width: 14 },
    { key: 'STATUS', type: 'text', width: 14 },
    { key: 'ID_CUSTOMER', type: 'text', width: 24, ref: COLLECTIONS.CUSTOMER },
    { key: 'BUYER', type: 'text', width: 18 },
    { key: 'ID_USERS', type: 'text', width: 24, ref: COLLECTIONS.USERS },
    { key: 'REF', type: 'text', width: 14 },
    { key: 'REF_PICKUP', type: 'text', width: 14 },
    { key: 'ID_CARRIER', type: 'text', width: 24, ref: COLLECTIONS.CARRIER },
    { key: 'ID_WAREHOUSE', type: 'text', width: 24, ref: COLLECTIONS.LOCATIONS },
    { key: 'TEMP_LOG', type: 'text', width: 14 },
    { key: 'DESCRIPTION', type: 'text', width: 30 },
    { key: 'TOTAL', type: 'number', width: 14 },
    { key: 'INCOMES', type: 'number', width: 14 },
    { key: 'BALANCE', type: 'number', width: 14 },
  ],
};

export const SALES_ORDER_DETAIL_SCHEMA: EntitySchema = {
  collection: COLLECTIONS.SALES_ORDER_DETAIL,
  label: 'Sales Details',
  idField: 'ID_SALESORDERDETAIL',
  fields: [
    { key: 'ID_SALESORDER', type: 'text', width: 26, ref: COLLECTIONS.SALES_ORDER },
    { key: 'ID_PURCHASEORDER', type: 'text', width: 26, ref: COLLECTIONS.PURCHASE_ORDER },
    { key: 'ID_COMMODITIES', type: 'text', width: 26, ref: COLLECTIONS.COMMODITIES },
    { key: 'DESCRIPTION', type: 'text', width: 30 },
    { key: 'QUANTITY', type: 'number', width: 12 },
    { key: 'PRICE', type: 'number', width: 12 },
    { key: 'TOTAL', type: 'number', width: 14 },
  ],
};

export const EXPENSE_SCHEMA: EntitySchema = {
  collection: COLLECTIONS.EXPENSES,
  label: 'Expenses',
  idField: 'ID_EXPENSES',
  fields: [
    { key: 'ID_PURCHASEORDER', type: 'text', width: 26, ref: COLLECTIONS.PURCHASE_ORDER },
    { key: 'INVOICE_NUMBER', type: 'text', width: 16 },
    { key: 'DATE', type: 'date', width: 14 },
    { key: 'ID_SUPPLIERS', type: 'text', width: 24, ref: COLLECTIONS.SUPPLIERS },
    { key: 'ID_CATEGORYBILL', type: 'text', width: 24, ref: COLLECTIONS.CATEGORY_BILL },
    { key: 'AMOUNT', type: 'number', width: 14 },
    { key: 'PAY_AMOUNT', type: 'number', width: 14 },
    { key: 'BALANCE', type: 'number', width: 14 },
    { key: 'DEDUCT', type: 'boolean', width: 10 },
    { key: 'CHECK_NUMBER', type: 'text', width: 16 },
    { key: 'PHOTO_CHECK', type: 'text', width: 30 },
    { key: 'NOTE', type: 'text', width: 34 },
  ],
};

export const PAYMENT_SALES_SCHEMA: EntitySchema = {
  collection: COLLECTIONS.PAYMENT_SALES,
  label: 'Sales Payments',
  idField: 'ID_PAYMENTSALES',
  fields: [
    { key: 'ID_SALESORDER', type: 'text', width: 26, ref: COLLECTIONS.SALES_ORDER },
    { key: 'DATE', type: 'date', width: 14 },
    { key: 'ID_PAYMENTMETHOD', type: 'text', width: 24, ref: COLLECTIONS.PAYMENT_METHOD },
    { key: 'AMOUNT', type: 'number', width: 14 },
    { key: 'CHECK_NUMBER', type: 'text', width: 16 },
    { key: 'REF_NUMBER', type: 'text', width: 16 },
    { key: 'PHOTO', type: 'text', width: 30 },
    { key: 'NOTE', type: 'text', width: 34 },
  ],
};

export const PAYMENT_BILL_SCHEMA: EntitySchema = {
  collection: COLLECTIONS.PAYMENT_BILL,
  label: 'Bill Payments',
  idField: 'ID_PAYMENTBILL',
  fields: [
    { key: 'ID_EXPENSES', type: 'text', width: 26, ref: COLLECTIONS.EXPENSES },
    { key: 'DATE', type: 'date', width: 14 },
    { key: 'ID_PAYMENTMETHOD', type: 'text', width: 24, ref: COLLECTIONS.PAYMENT_METHOD },
    { key: 'AMOUNT', type: 'number', width: 14 },
    { key: 'CHECK_NUMBER', type: 'text', width: 16 },
    { key: 'REF_NUMBER', type: 'text', width: 16 },
    { key: 'PHOTO', type: 'text', width: 30 },
    { key: 'NOTE', type: 'text', width: 34 },
  ],
};

/** Esquemas agrupados por modulo: el template descarga una hoja por esquema. */
export const PURCHASES_SCHEMAS = [PURCHASE_ORDER_SCHEMA, PURCHASE_DETAIL_SCHEMA];
export const SALES_SCHEMAS = [SALES_ORDER_SCHEMA, SALES_ORDER_DETAIL_SCHEMA, PAYMENT_SALES_SCHEMA];
export const EXPENSES_SCHEMAS = [EXPENSE_SCHEMA, PAYMENT_BILL_SCHEMA];
