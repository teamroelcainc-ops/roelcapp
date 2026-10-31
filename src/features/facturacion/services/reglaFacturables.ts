// src/features/facturacion/services/reglaFacturables.ts
// ✅ V00536 — Qué hace un aviso del bus con la lista de operaciones de Facturación (Clientes y
// Proveedores, la misma regla): la operación entra o sale SOLO cuando el aviso trae su `status`;
// si no lo trae, la que estaba se actualiza y se queda.
import type { ReglaLista } from '../../../utils/operacionesBus';

export const reglaFacturables = (statusFacturables: readonly string[]): ReglaLista => ({
  campos: ['status'],
  pertenece: (op) => statusFacturables.includes(String(op.status ?? '').trim()),
  agregar: () => true,
});
