// src/components/modulosNavMovil.ts
// Catálogo de módulos que pueden ocupar un lugar en la barra inferior móvil.
// La clave debe coincidir con moduloActivo de App.tsx y con las claves de
// permisos de puede().
import type { LucideIcon } from 'lucide-react';
import {
  Home, CheckCircle2, XCircle, BarChart3, Wrench, Fuel, Landmark, Wallet,
  Receipt, FileText, Building2, Users, DollarSign, BookOpen, Truck, Container, Navigation,
} from 'lucide-react';

export interface ModuloNavDef {
  clave: string;
  etiqueta: string;
  Icono: LucideIcon;
}

export const MODULOS_NAV: ModuloNavDef[] = [
  { clave: 'misOperaciones', etiqueta: 'Mis Ops', Icono: Navigation },
  { clave: 'operaciones', etiqueta: 'Inicio', Icono: Home },
  { clave: 'serviciosCompletados', etiqueta: 'Completados', Icono: CheckCircle2 },
  { clave: 'serviciosCancelados', etiqueta: 'Cancelados', Icono: XCircle },
  { clave: 'reportes', etiqueta: 'Reportes', Icono: BarChart3 },
  { clave: 'mtto', etiqueta: 'MTTO', Icono: Wrench },
  { clave: 'referenciasDiesel', etiqueta: 'Diesel', Icono: Fuel },
  { clave: 'referenciasPuentes', etiqueta: 'Puentes', Icono: Landmark },
  { clave: 'referenciasNomina', etiqueta: 'Nómina', Icono: Wallet },
  { clave: 'facturacionClientes', etiqueta: 'Fact. Clientes', Icono: Receipt },
  { clave: 'facturacionProveedores', etiqueta: 'Fact. Prov.', Icono: FileText },
  { clave: 'empresas', etiqueta: 'Empresas', Icono: Building2 },
  { clave: 'colaboradores', etiqueta: 'Empleados', Icono: Users },
  { clave: 'tipoCambio', etiqueta: 'Tipo Cambio', Icono: DollarSign },
  { clave: 'catalogos', etiqueta: 'Catálogos', Icono: BookOpen },
  { clave: 'unidades', etiqueta: 'Unidades', Icono: Truck },
  { clave: 'remolques', etiqueta: 'Remolques', Icono: Container },
];
