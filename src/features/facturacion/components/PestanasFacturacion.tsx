// src/features/facturacion/components/PestanasFacturacion.tsx
// ---------------------------------------------------------------------------
// ✅ V00480 — FACTURACIÓN EN UN SOLO LUGAR: el menú tiene un solo "Facturación" y estas pestañas
// cambian entre Facturación de Clientes y Facturación de Proveedores (los módulos de siempre, con
// su permiso; MantenerVivo conserva cada uno al cambiar).
// ---------------------------------------------------------------------------
import { FileText, Receipt } from 'lucide-react';
import PestanasModulo from '../../../shared/components/PestanasModulo';
import type { PestanaModulo } from '../../../shared/components/PestanasModulo';
import type { ModuloFacturacion } from '../services/modulosFacturacion';

const PESTANAS: readonly PestanaModulo<ModuloFacturacion>[] = [
  { modulo: 'facturacionClientes', texto: 'Clientes', Icono: Receipt, color: '#3fb950' },
  { modulo: 'facturacionProveedores', texto: 'Proveedores', Icono: FileText, color: '#58a6ff' },
];

interface Props {
  activo: ModuloFacturacion;
  puede: (modulo: ModuloFacturacion) => boolean;
  onCambiar: (modulo: ModuloFacturacion) => void;
}

export default function PestanasFacturacion({ activo, puede, onCambiar }: Props) {
  return <PestanasModulo etiqueta="Facturación" pestanas={PESTANAS} activo={activo} puede={puede} onCambiar={onCambiar} />;
}
