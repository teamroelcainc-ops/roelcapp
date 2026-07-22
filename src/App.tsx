import { useState, useEffect, useMemo, Suspense } from 'react';
import type { CSSProperties } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, updateDoc, getDoc, collection, onSnapshot, query, where, getDocs, orderBy, limit, addDoc } from 'firebase/firestore'; 
import { auth, db } from './config/firebase'; 
import { registrarLog } from './utils/logger'; 
import { lazyWithRetry } from './utils/lazyWithRetry';

// ── Estáticos: críticos o siempre presentes (login, marca y modales). ──
import { Login } from './features/auth/components/Login';
import { MiPerfil } from './usuarios/components/MiPerfil';
import { RelojChecadorModal } from './features/relojChecador/components/RelojChecadorModal';
import { EmpresaBrand } from './features/configuracion/EmpresaBrand';

// ============================================================================
// ✅ CARGA DIFERIDA (code-splitting). Antes los ~30 dashboards se importaban de
// forma estática, así que al iniciar sesión el navegador descargaba y parseaba
// TODO el código antes de mostrar nada. Con React.lazy, el código de cada módulo
// se descarga SOLO cuando el usuario lo abre → la primera pantalla carga mucho
// más rápido.
//   • export default  → lazy(() => import('...'))
//   • export const X  → lazy(() => import('...').then(m => ({ default: m.X })))
// ============================================================================
const OperacionesDashboard = lazyWithRetry(() => import('./features/operaciones/components/OperacionesDashboard'), 'OperacionesDashboard');
const ServiciosCompletados = lazyWithRetry(() => import('./features/operaciones/components/ServiciosCompletados'), 'ServiciosCompletados');
const ServiciosCancelados = lazyWithRetry(() => import('./features/operaciones/components/ServiciosCancelados'), 'ServiciosCancelados');
const ReportesDashboard = lazyWithRetry(() => import('./features/reportes/components/ReportesDashboard'), 'ReportesDashboard');
const EmpresasDashboard = lazyWithRetry(() => import('./features/empresas/components/EmpresasDashboard'), 'EmpresasDashboard');
const ContactosDashboard = lazyWithRetry(() => import('./features/contactos/components/ContactosDashboard').then(m => ({ default: m.ContactosDashboard })), 'ContactosDashboard');
const TipoCambioDashboard = lazyWithRetry(() => import('./features/tipoCambio/components/TipoCambioDashboard').then(m => ({ default: m.TipoCambioDashboard })), 'TipoCambioDashboard');
const CatalogosDashboard = lazyWithRetry(() => import('./features/catalogos/components/CatalogosDashboard'), 'CatalogosDashboard');
const CombustibleDashboard = lazyWithRetry(() => import('./features/combustible/components/CombustibleDashboard').then(m => ({ default: m.CombustibleDashboard })), 'CombustibleDashboard');
const ProveedoresUnidadDashboard = lazyWithRetry(() => import('./features/proveedoresUnidad/components/ProveedoresUnidadDashboard'), 'ProveedoresUnidadDashboard');
const UnidadesProveedorDashboard = lazyWithRetry(() => import('./features/unidadesProveedor/components/UnidadesProveedorDashboard').then(m => ({ default: m.UnidadesProveedorDashboard })), 'UnidadesProveedorDashboard');
const UnidadesDashboard = lazyWithRetry(() => import('./features/unidades/components/UnidadesDashboard'), 'UnidadesDashboard');
const RemolquesDashboard = lazyWithRetry(() => import('./features/remolques/components/RemolquesDashboard'), 'RemolquesDashboard');
const ConveniosClientesDashboard = lazyWithRetry(() => import('./features/conveniosClientes/components/ConveniosClientesDashboard'), 'ConveniosClientesDashboard');
const ConveniosProveedoresDashboard = lazyWithRetry(() => import('./features/conveniosProveedores/components/ConveniosProveedoresDashboard').then(m => ({ default: m.ConveniosProveedoresDashboard })), 'ConveniosProveedoresDashboard');
const DireccionesDashboard = lazyWithRetry(() => import('./features/direcciones/components/DireccionesDashboard').then(m => ({ default: m.DireccionesDashboard })), 'DireccionesDashboard');
const EmpleadosDashboard = lazyWithRetry(() => import('./features/empleados/components/EmpleadosDashboard').then(m => ({ default: m.EmpleadosDashboard })), 'EmpleadosDashboard');
const RolesDashboard = lazyWithRetry(() => import('./usuarios/components/RolesDashboard').then(m => ({ default: m.RolesDashboard })), 'RolesDashboard');
const UsuariosDashboard = lazyWithRetry(() => import('./usuarios/components/UsuariosDashboard').then(m => ({ default: m.UsuariosDashboard })), 'UsuariosDashboard');
const LogsDashboard = lazyWithRetry(() => import('./features/configuracion/components/LogsDashboard').then(m => ({ default: m.LogsDashboard })), 'LogsDashboard');
const ConfiguradorStatus = lazyWithRetry(() => import('./features/configuracion/components/ConfiguradorStatus').then(m => ({ default: m.ConfiguradorStatus })), 'ConfiguradorStatus');
const HistorialChequeosDashboard = lazyWithRetry(() => import('./features/relojChecador/components/HistorialChequeosDashboard').then(m => ({ default: m.HistorialChequeosDashboard })), 'HistorialChequeosDashboard');
const MttoDashboard = lazyWithRetry(() => import('./features/gastos/components/mtto/MttoDashboard'), 'MttoDashboard');
const ReferenciasDieselDashboard = lazyWithRetry(() => import('./features/diesel/components/ReferenciasDieselDashboard').then(m => ({ default: m.ReferenciasDieselDashboard })), 'ReferenciasDieselDashboard');
const ReferenciasPuentesDashboard = lazyWithRetry(() => import('./features/puentes/components/ReferenciasPuentesDashboard').then(m => ({ default: m.ReferenciasPuentesDashboard })), 'ReferenciasPuentesDashboard');
const ReferenciasNominaDashboard = lazyWithRetry(() => import('./features/nominas/components/ReferenciasNominaDashboard').then(m => ({ default: m.ReferenciasNominaDashboard })), 'ReferenciasNominaDashboard');
const DeduccionesDashboard = lazyWithRetry(() => import('./features/empleados/components/DeduccionesDashboard').then(m => ({ default: m.DeduccionesDashboard })), 'DeduccionesDashboard');
const FacturacionClientesDashboard = lazyWithRetry(() => import('./features/facturacion/components/FacturacionClientesDashboard').then(m => ({ default: m.FacturacionClientesDashboard })), 'FacturacionClientesDashboard');
const FacturacionProveedoresDashboard = lazyWithRetry(() => import('./features/facturacion/components/FacturacionProveedoresDashboard').then(m => ({ default: m.FacturacionProveedoresDashboard })), 'FacturacionProveedoresDashboard');
const CostosAdicionalesDashboard = lazyWithRetry(() => import('./features/costosAdicionales/CostosAdicionalesDashboard').then(m => ({ default: m.CostosAdicionalesDashboard })), 'CostosAdicionalesDashboard');
const ConfiguracionEmpresa = lazyWithRetry(() => import('./features/configuracion/ConfiguracionEmpresa'), 'ConfiguracionEmpresa');
const DataImportView = lazyWithRetry(() => import('./features/importacion/components/DataImportView'), 'DataImportView');
// ✅ Módulo de AUTORIZACIONES: SOLO visible para Admin.
const AutorizacionesDashboard = lazyWithRetry(() => import('./features/autorizaciones/components/AutorizacionesDashboard').then(m => ({ default: m.AutorizacionesDashboard })), 'AutorizacionesDashboard');

import './App.css';

// ============================================================================
// Mapa: etiqueta del módulo (como se guarda en el rol) -> clave interna (moduloActivo).
// Debe coincidir con las etiquetas usadas en RolesDashboard (GRUPOS_MODULOS).
// El orden define también la prioridad al elegir el primer módulo permitido.
// ============================================================================
const MODULOS_A_CLAVE: Record<string, string> = {
  'Operaciones Activas': 'operaciones',
  'Servicios Completados': 'serviciosCompletados',
  'Servicios Cancelados': 'serviciosCancelados',
  'Reportes': 'reportes',
  'MTTO': 'mtto',
  'Referencias del Diesel': 'referenciasDiesel',
  'Referencias de Puentes': 'referenciasPuentes',
  'Costos Adicionales': 'costosAdicionales',
  'Convenio de Clientes': 'conveniosClientes',
  'Facturación de Clientes': 'facturacionClientes',
  'Convenio de Proveedores': 'conveniosProveedores',
  'Facturación de Proveedores': 'facturacionProveedores',
  'Colaboradores': 'colaboradores',
  'Historial de Chequeo': 'historialAsistencia',
  'Nómina': 'referenciasNomina',
  'Deducciones': 'deducciones',
  'Empresas': 'empresas',
  'Contactos': 'contactos',
  'Direcciones': 'direcciones',
  'Tipo de Cambio': 'tipoCambio',
  'Combustible': 'combustible',
  'Unidades Propias': 'unidades',
  'Remolques': 'remolques',
  'Proveedores de Unidad': 'proveedoresUnidad',
  'Unidades del Proveedor': 'unidadesProveedor',
  'Catálogos': 'catalogos',
  'Usuarios': 'usuarios',
  'Roles y Permisos': 'roles',
  'Historial de Actividad': 'logs',
  'Reglas de Estatus': 'flujosOperacion',
  'Datos de la Empresa': 'datosEmpresa',
  // ✅ Autorizaciones: visible para quien tenga el módulo asignado en su rol.
  'Autorizaciones': 'autorizaciones',
};

const ORDEN_CLAVES = Object.values(MODULOS_A_CLAVE);

// ============================================================================
// Iconos del menú lateral (estilo lucide/feather: trazo, currentColor)
// ============================================================================
const Ico = ({ children }: { children: React.ReactNode }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    {children}
  </svg>
);

const iTruck = (
  <Ico><rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></Ico>
);
const iDroplet = (
  <Ico><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" /></Ico>
);
const iDollar = (
  <Ico><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></Ico>
);
const iUsers = (
  <Ico><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></Ico>
);
const iFileText = (
  <Ico><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></Ico>
);
const iCard = (
  <Ico><rect x="1" y="4" width="22" height="16" rx="2" ry="2" /><line x1="1" y1="10" x2="23" y2="10" /></Ico>
);
const iPackage = (
  <Ico><line x1="16.5" y1="9.4" x2="7.5" y2="4.21" /><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></Ico>
);

const ICON: Record<string, React.ReactNode> = {
  operaciones: iTruck,
  serviciosCompletados: (
    <Ico><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></Ico>
  ),
  serviciosCancelados: (
    <Ico><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></Ico>
  ),
  reportes: (
    <Ico><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></Ico>
  ),
  catalogos: (
    <Ico><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></Ico>
  ),
  gastos: iDollar,
  clientes: iUsers,
  proveedores: iPackage,
  empleados: (
    <Ico><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><polyline points="17 11 19 13 23 9" /></Ico>
  ),
  basesDatos: (
    <Ico><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></Ico>
  ),
  configuracion: (
    <Ico><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></Ico>
  ),
  mtto: (
    <Ico><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></Ico>
  ),
  referenciasDiesel: iDroplet,
  referenciasPuentes: (
    <Ico><path d="M2 18v-3" /><path d="M22 18v-3" /><path d="M2 15c4 0 4-5 10-5s6 5 10 5" /><line x1="1" y1="18" x2="23" y2="18" /><line x1="7" y1="13.5" x2="7" y2="18" /><line x1="17" y1="13.5" x2="17" y2="18" /></Ico>
  ),
  costosAdicionales: (
    <Ico><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" /></Ico>
  ),
  conveniosClientes: iFileText,
  facturacionClientes: iCard,
  conveniosProveedores: iFileText,
  facturacionProveedores: iCard,
  colaboradores: iUsers,
  historialAsistencia: (
    <Ico><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></Ico>
  ),
  referenciasNomina: iDollar,
  deducciones: (
    <Ico><circle cx="12" cy="12" r="10" /><line x1="8" y1="12" x2="16" y2="12" /></Ico>
  ),
  empresas: (
    <Ico><rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></Ico>
  ),
  contactos: (
    <Ico><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></Ico>
  ),
  direcciones: (
    <Ico><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></Ico>
  ),
  tipoCambio: (
    <Ico><polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></Ico>
  ),
  combustible: iDroplet,
  unidades: iTruck,
  remolques: (
    <Ico><rect x="1" y="6" width="17" height="9" rx="1" /><circle cx="6" cy="18" r="1.6" /><circle cx="13" cy="18" r="1.6" /><line x1="18" y1="10.5" x2="22" y2="10.5" /></Ico>
  ),
  proveedoresUnidad: iPackage,
  unidadesProveedor: iTruck,
  usuarios: iUsers,
  roles: (
    <Ico><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></Ico>
  ),
  logs: (
    <Ico><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></Ico>
  ),
  flujosOperacion: (
    <Ico><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" /></Ico>
  ),
  datosEmpresa: (
    <Ico><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></Ico>
  ),
};

// Indicador mientras se descarga el chunk de un módulo (carga diferida).
const CargandoModulo = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', height: 'calc(100vh - 160px)', color: '#8b949e' }}>
    <span style={{ width: 18, height: 18, border: '2px solid #30363d', borderTopColor: '#D84315', borderRadius: '50%', display: 'inline-block', animation: 'spinRoelca 0.7s linear infinite' }} />
    Cargando módulo…<style>{`@keyframes spinRoelca { to { transform: rotate(360deg); } }`}</style>
  </div>
);

// ============================================================================
// ✅ NUEVO — RESUMEN DEL DÍA (vista principal)
// Franja profesional de indicadores sobre Operaciones Activas: operaciones del
// día (total, completadas y canceladas por fecha de servicio de HOY), el tipo
// de cambio del día y el costo del diesel del día. Lecturas mínimas: una
// consulta puntual por indicador, con botón ↻ para refrescar.
// ============================================================================
const RESUMEN_STATUS_COMPLETADOS = ['c2d57403', 'f557b751'];
const RESUMEN_STATUS_CANCELADO = '7607f692';
const RESUMEN_COLECCIONES_TC = [
  'tipo_cambio', 'tipos_cambio', 'catalogo_tipo_cambio', 'catalogo_tipos_cambio',
  'catalogo_tc', 'tipo_cambio_oficial', 'tipoCambio', 'tc', 'tc_dof', 'tipos_de_cambio',
];

const resumenNormalizarISO = (v: any): string => {
  if (v == null) return '';
  if (typeof v === 'object' && typeof v.toDate === 'function') {
    const d = v.toDate();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  const t = String(v).trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
};

const resumenExtraerTC = (row: any): number | null => {
  if (!row || typeof row !== 'object') return null;
  const valKey = Object.keys(row).find((k) => {
    const kk = String(k).toLowerCase();
    return kk.includes('dof') || kk.includes('valor') || kk === 'tc' || kk.includes('cambio') || kk.includes('monto') || kk.includes('t.c');
  });
  if (valKey) {
    const n = Number(String(row[valKey]).replace(/[^0-9.-]+/g, ''));
    if (!isNaN(n) && n > 0) return n;
  }
  const posibles = Object.values(row)
    .map((v: any) => parseFloat(String(v).replace(/[^0-9.-]+/g, '')))
    .filter((n: any) => !isNaN(n) && n > 5 && n < 60);
  return posibles.length > 0 ? posibles[0] : null;
};

const resumenMejorFechaFila = (row: any): string => {
  let mejor = '';
  Object.values(row || {}).forEach((v: any) => {
    const iso = resumenNormalizarISO(v);
    if (iso && iso > mejor) mejor = iso;
  });
  return mejor;
};

function ResumenDelDia() {
  const [cargando, setCargando] = useState(true);
  const [datos, setDatos] = useState<{
    totalHoy: number; completadasHoy: number; canceladasHoy: number;
    tc: number | null; tcFecha: string;
    diesel: number | null; dieselFecha: string; dieselProveedores: number;
  }>({ totalHoy: 0, completadasHoy: 0, canceladasHoy: 0, tc: null, tcFecha: '', diesel: null, dieselFecha: '', dieselProveedores: 0 });

  const hoy = new Date();
  const hoyISO = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;

  // ✅ NUEVO: captura rápida del TC y del diesel del día desde la vista principal
  //   (los botones solo aparecen cuando el dato de HOY aún no existe).
  const [modalTCAbierto, setModalTCAbierto] = useState(false);
  const [nuevoTC, setNuevoTC] = useState('');
  const [modalDieselAbierto, setModalDieselAbierto] = useState(false);
  const [nuevoDieselCosto, setNuevoDieselCosto] = useState('');
  const [provDieselId, setProvDieselId] = useState('');
  const [buscarProvDiesel, setBuscarProvDiesel] = useState('');
  const [empresasDiesel, setEmpresasDiesel] = useState<any[]>([]);
  const [guardandoCaptura, setGuardandoCaptura] = useState(false);

  const abrirModalDiesel = async () => {
    setModalDieselAbierto(true);
    if (empresasDiesel.length === 0) {
      try {
        const snap = await getDocs(collection(db, 'empresas'));
        setEmpresasDiesel(snap.docs.map((d: any) => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => String(a.nombre || '').localeCompare(String(b.nombre || ''))));
      } catch (e) { console.error('[Resumen del día] empresas:', e); }
    }
  };

  const guardarTCDia = async () => {
    const valor = Number(String(nuevoTC).replace(/[^0-9.]/g, ''));
    if (!valor || valor <= 0) { alert('Captura un tipo de cambio válido.'); return; }
    setGuardandoCaptura(true);
    try {
      const previo = datos.tc != null && datos.tcFecha !== hoyISO ? datos.tc : null;
      const tendencia = previo == null ? 'igual' : valor > previo ? 'subio' : valor < previo ? 'bajo' : 'igual';
      const nombreDia = hoy.toLocaleDateString('es-MX', { weekday: 'long' });
      await addDoc(collection(db, 'tipo_cambio'), {
        fecha: hoyISO,
        dia: nombreDia.charAt(0).toUpperCase() + nombreDia.slice(1),
        tcDof: valor,
        tipoTendencia: tendencia,
        createdAt: new Date().toISOString(),
      });
      registrarLog('Tipo de Cambio', 'Creación', `Capturó el tipo de cambio del día ${hoyISO}: $${valor.toFixed(4)} (desde Operaciones)`).catch(() => {});
      setModalTCAbierto(false); setNuevoTC('');
      await cargar();
    } catch (e) {
      console.error('[Resumen del día] guardar TC:', e);
      alert('No se pudo guardar el tipo de cambio. Inténtalo de nuevo.');
    } finally { setGuardandoCaptura(false); }
  };

  const guardarDieselDia = async () => {
    const costo = Number(String(nuevoDieselCosto).replace(/[^0-9.]/g, ''));
    if (!provDieselId) { alert('Selecciona el proveedor del diesel.'); return; }
    if (!costo || costo <= 0) { alert('Captura un costo válido por litro.'); return; }
    setGuardandoCaptura(true);
    try {
      const prov = empresasDiesel.find((e: any) => e.id === provDieselId);
      await addDoc(collection(db, 'combustibles'), {
        fecha: hoyISO,
        proveedorId: provDieselId,
        proveedor: prov?.nombre || '',
        costo,
        createdAt: new Date().toISOString(),
      });
      registrarLog('Combustible', 'Creación', `Capturó el diesel del día ${hoyISO}: $${costo.toFixed(2)} — ${prov?.nombre || provDieselId} (desde Operaciones)`).catch(() => {});
      setModalDieselAbierto(false); setNuevoDieselCosto(''); setProvDieselId(''); setBuscarProvDiesel('');
      await cargar();
    } catch (e) {
      console.error('[Resumen del día] guardar diesel:', e);
      alert('No se pudo guardar el costo del diesel. Inténtalo de nuevo.');
    } finally { setGuardandoCaptura(false); }
  };

  const empresasDieselFiltradas = empresasDiesel.filter((e: any) =>
    !buscarProvDiesel.trim() || String(e.nombre || '').toLowerCase().includes(buscarProvDiesel.toLowerCase()));

  const cargar = async () => {
    setCargando(true);
    const nuevo = { totalHoy: 0, completadasHoy: 0, canceladasHoy: 0, tc: null as number | null, tcFecha: '', diesel: null as number | null, dieselFecha: '', dieselProveedores: 0 };

    // 1) Operaciones con fecha de servicio de HOY, clasificadas por status.
    try {
      const snap = await getDocs(query(collection(db, 'operaciones'), where('fechaServicio', '==', hoyISO)));
      snap.docs.forEach((d: any) => {
        const op = d.data() || {};
        const nombre = String(op.statusNombre || '').toLowerCase();
        nuevo.totalHoy += 1;
        if (op.status === RESUMEN_STATUS_CANCELADO || nombre.includes('cancel')) nuevo.canceladasHoy += 1;
        else if (RESUMEN_STATUS_COMPLETADOS.includes(op.status) || nombre.includes('complet')) nuevo.completadasHoy += 1;
      });
    } catch (e) { console.error('[Resumen del día] operaciones:', e); }

    // 2) Tipo de cambio del día (o el más reciente disponible).
    try {
      let filas: any[] = [];
      for (const nombre of RESUMEN_COLECCIONES_TC) {
        try {
          const snap = await getDocs(collection(db, nombre));
          if (!snap.empty) { filas = snap.docs.map((d: any) => ({ id: d.id, ...d.data() })); break; }
        } catch { /* colección inexistente: probar la siguiente */ }
      }
      const deHoy = filas.find(f => Object.values(f).some((v: any) => resumenNormalizarISO(v) === hoyISO));
      if (deHoy) {
        nuevo.tc = resumenExtraerTC(deHoy);
        nuevo.tcFecha = hoyISO;
      } else if (filas.length > 0) {
        const ordenadas = filas
          .map(f => ({ f, fecha: resumenMejorFechaFila(f), rate: resumenExtraerTC(f) }))
          .filter(x => x.rate != null && x.fecha && x.fecha <= hoyISO)
          .sort((a, b) => b.fecha.localeCompare(a.fecha));
        if (ordenadas.length > 0) { nuevo.tc = ordenadas[0].rate; nuevo.tcFecha = ordenadas[0].fecha; }
      }
    } catch (e) { console.error('[Resumen del día] tipo de cambio:', e); }

    // 3) Costo del diesel del día (promedio si hay varios proveedores) o el más reciente.
    try {
      let docsDiesel: any[] = [];
      const snapHoy = await getDocs(query(collection(db, 'combustibles'), where('fecha', '==', hoyISO)));
      if (!snapHoy.empty) {
        docsDiesel = snapHoy.docs.map((d: any) => d.data());
        nuevo.dieselFecha = hoyISO;
      } else {
        const snapUlt = await getDocs(query(collection(db, 'combustibles'), orderBy('fecha', 'desc'), limit(1)));
        if (!snapUlt.empty) {
          const data = snapUlt.docs[0].data() as any;
          docsDiesel = [data];
          nuevo.dieselFecha = resumenNormalizarISO(data.fecha) || '';
        }
      }
      const costos = docsDiesel.map((d: any) => Number(d.costo) || 0).filter(n => n > 0);
      if (costos.length > 0) {
        nuevo.diesel = costos.reduce((a, b) => a + b, 0) / costos.length;
        nuevo.dieselProveedores = costos.length;
      }
    } catch (e) { console.error('[Resumen del día] diesel:', e); }

    setDatos(nuevo);
    setCargando(false);
  };

  useEffect(() => { cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const fmtDia = (iso: string) => {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  };
  const fechaLegible = hoy.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });

  const tarjeta: CSSProperties = { backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '10px', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 };
  const etiqueta: CSSProperties = { color: '#8b949e', fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' };
  const valorCss = (color: string): CSSProperties => ({ color, fontSize: '1.55rem', fontWeight: 800, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' });
  const sub: CSSProperties = { color: '#6e7681', fontSize: '0.7rem' };

  return (
    <div style={{ padding: '20px 28px 0 28px', boxSizing: 'border-box', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <span style={{ color: '#8b949e', fontSize: '0.82rem' }}>
          Resumen del día · <span style={{ color: '#c9d1d9', fontWeight: 600, textTransform: 'capitalize' }}>{fechaLegible}</span>
        </span>
        <button onClick={cargar} disabled={cargando} title="Actualizar resumen"
          style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', backgroundColor: 'transparent', border: '1px solid #30363d', borderRadius: '6px', color: '#8b949e', cursor: cargando ? 'wait' : 'pointer', fontSize: '0.78rem', opacity: cargando ? 0.6 : 1 }}>
          <span style={{ fontSize: '0.9rem', lineHeight: 1 }}>↻</span>{cargando ? 'Actualizando…' : 'Actualizar'}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
        <div style={tarjeta}>
          <span style={etiqueta}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" strokeWidth="2.2"><rect x="1" y="3" width="15" height="13" rx="1"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg>
            Operaciones del día
          </span>
          <span style={valorCss('#58a6ff')}>{cargando ? '…' : datos.totalHoy}</span>
          <span style={sub}>{cargando ? ' ' : `${Math.max(0, datos.totalHoy - datos.completadasHoy - datos.canceladasHoy)} en proceso`}</span>
        </div>

        <div style={tarjeta}>
          <span style={etiqueta}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#3fb950" strokeWidth="2.2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
            Completadas hoy
          </span>
          <span style={valorCss('#3fb950')}>{cargando ? '…' : datos.completadasHoy}</span>
          <span style={sub}>{cargando || datos.totalHoy === 0 ? ' ' : `${Math.round((datos.completadasHoy / datos.totalHoy) * 100)}% del día`}</span>
        </div>

        <div style={tarjeta}>
          <span style={etiqueta}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f85149" strokeWidth="2.2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
            Canceladas hoy
          </span>
          <span style={valorCss('#f85149')}>{cargando ? '…' : datos.canceladasHoy}</span>
          <span style={sub}>{cargando || datos.totalHoy === 0 ? ' ' : `${Math.round((datos.canceladasHoy / datos.totalHoy) * 100)}% del día`}</span>
        </div>

        <div style={tarjeta} title={datos.tcFecha && datos.tcFecha !== hoyISO ? `Último registro: ${fmtDia(datos.tcFecha)}` : 'Tipo de cambio del día'}>
          <span style={etiqueta}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.2"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
            Tipo de cambio
          </span>
          <span style={valorCss('#f59e0b')}>{cargando ? '…' : (datos.tc != null ? `$${datos.tc.toFixed(4)}` : '—')}</span>
          <span style={sub}>
            {cargando ? ' ' : datos.tc == null ? 'Sin registro' : (datos.tcFecha === hoyISO ? 'DOF de hoy' : `al ${fmtDia(datos.tcFecha)}`)}
          </span>
          {!cargando && datos.tcFecha !== hoyISO && (
            <button onClick={() => setModalTCAbierto(true)} title="Capturar el tipo de cambio de hoy"
              style={{ marginTop: '2px', padding: '5px 10px', backgroundColor: 'rgba(245,158,11,0.12)', color: '#f59e0b', border: '1px solid #f59e0b', borderRadius: '6px', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 'bold', alignSelf: 'flex-start' }}>
              + Capturar el de hoy
            </button>
          )}
        </div>

        <div style={tarjeta} title={datos.dieselProveedores > 1 ? `Promedio de ${datos.dieselProveedores} proveedores` : 'Costo del diesel'}>
          <span style={etiqueta}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fb923c" strokeWidth="2.2"><path d="M3 22V8a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v14"></path><line x1="3" y1="22" x2="15" y2="22"></line><path d="M13 10h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V9l-3-3"></path></svg>
            Diesel del día
          </span>
          <span style={valorCss('#fb923c')}>{cargando ? '…' : (datos.diesel != null ? `$${datos.diesel.toFixed(2)}` : '—')}</span>
          <span style={sub}>
            {cargando ? ' ' : datos.diesel == null ? 'Sin captura' : `${datos.dieselProveedores > 1 ? `Prom. ${datos.dieselProveedores} proveedores` : 'Por litro'}${datos.dieselFecha && datos.dieselFecha !== hoyISO ? ` · al ${fmtDia(datos.dieselFecha)}` : ''}`}
          </span>
          {!cargando && datos.dieselFecha !== hoyISO && (
            <button onClick={abrirModalDiesel} title="Capturar el costo del diesel de hoy"
              style={{ marginTop: '2px', padding: '5px 10px', backgroundColor: 'rgba(251,146,60,0.12)', color: '#fb923c', border: '1px solid #fb923c', borderRadius: '6px', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 'bold', alignSelf: 'flex-start' }}>
              + Capturar el de hoy
            </button>
          )}
        </div>
      </div>

      {/* ✅ Modal: capturar TIPO DE CAMBIO de hoy */}
      {modalTCAbierto && (
        <div onClick={() => !guardandoCaptura && setModalTCAbierto(false)} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 1500, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(2px)' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '380px', maxWidth: '92%', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '10px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.02rem' }}>💱 Tipo de cambio de hoy</h3>
              <button onClick={() => setModalTCAbierto(false)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.1rem' }}>✕</button>
            </div>
            <span style={{ color: '#8b949e', fontSize: '0.82rem' }}>Se registrará para el <b style={{ color: '#c9d1d9' }}>{fmtDia(hoyISO)}</b> en el catálogo de Tipo de Cambio.</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ color: '#f59e0b', fontSize: '0.75rem', fontWeight: 'bold' }}>TIPO DE CAMBIO DOF $</label>
              <input type="number" step="0.0001" min="0" autoFocus placeholder="Ej. 17.5993" value={nuevoTC}
                onChange={(e) => setNuevoTC(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') guardarTCDia(); }}
                style={{ width: '100%', padding: '10px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#f0f6fc', fontSize: '1.05rem', fontWeight: 'bold', boxSizing: 'border-box' }} />
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => setModalTCAbierto(false)} disabled={guardandoCaptura} style={{ flex: 1, padding: '10px', background: 'none', color: '#8b949e', border: '1px solid #30363d', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Cancelar</button>
              <button onClick={guardarTCDia} disabled={guardandoCaptura} style={{ flex: 1, padding: '10px', backgroundColor: '#f59e0b', color: '#0d1117', border: 'none', borderRadius: '6px', cursor: guardandoCaptura ? 'wait' : 'pointer', fontWeight: 'bold' }}>{guardandoCaptura ? 'Guardando…' : '💾 Guardar'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ✅ Modal: capturar DIESEL de hoy */}
      {modalDieselAbierto && (
        <div onClick={() => !guardandoCaptura && setModalDieselAbierto(false)} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 1500, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(2px)' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '420px', maxWidth: '92%', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '10px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.02rem' }}>⛽ Diesel de hoy</h3>
              <button onClick={() => setModalDieselAbierto(false)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.1rem' }}>✕</button>
            </div>
            <span style={{ color: '#8b949e', fontSize: '0.82rem' }}>Se registrará para el <b style={{ color: '#c9d1d9' }}>{fmtDia(hoyISO)}</b> en el catálogo de Combustible.</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ color: '#8b949e', fontSize: '0.75rem', fontWeight: 'bold' }}>PROVEEDOR</label>
              <input type="text" placeholder="Buscar proveedor..." value={buscarProvDiesel} onChange={(e) => setBuscarProvDiesel(e.target.value)}
                style={{ width: '100%', padding: '8px 10px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', fontSize: '0.88rem', boxSizing: 'border-box' }} />
              <select value={provDieselId} onChange={(e) => setProvDieselId(e.target.value)} size={5}
                style={{ width: '100%', padding: '6px', backgroundColor: '#0d1117', border: `1px solid ${provDieselId ? '#fb923c' : '#30363d'}`, borderRadius: '6px', color: '#c9d1d9', fontSize: '0.88rem', boxSizing: 'border-box' }}>
                {empresasDiesel.length === 0 && <option value="" disabled>Cargando proveedores…</option>}
                {empresasDieselFiltradas.slice(0, 60).map((e: any) => (
                  <option key={e.id} value={e.id}>{e.nombre}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ color: '#fb923c', fontSize: '0.75rem', fontWeight: 'bold' }}>COSTO POR LITRO $</label>
              <input type="number" step="0.01" min="0" placeholder="Ej. 26.50" value={nuevoDieselCosto}
                onChange={(e) => setNuevoDieselCosto(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') guardarDieselDia(); }}
                style={{ width: '100%', padding: '10px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#f0f6fc', fontSize: '1.05rem', fontWeight: 'bold', boxSizing: 'border-box' }} />
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => setModalDieselAbierto(false)} disabled={guardandoCaptura} style={{ flex: 1, padding: '10px', background: 'none', color: '#8b949e', border: '1px solid #30363d', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Cancelar</button>
              <button onClick={guardarDieselDia} disabled={guardandoCaptura} style={{ flex: 1, padding: '10px', backgroundColor: '#fb923c', color: '#0d1117', border: 'none', borderRadius: '6px', cursor: guardandoCaptura ? 'wait' : 'pointer', fontWeight: 'bold' }}>{guardandoCaptura ? 'Guardando…' : '💾 Guardar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


function App() {
  const [estaAutenticado, setEstaAutenticado] = useState(false);
  const [cargandoAuth, setCargandoAuth] = useState(true); 
  const [usuarioActualDB, setUsuarioActualDB] = useState<any>(null); 
  const [rolesCatalogo, setRolesCatalogo] = useState<any[]>([]); // catálogo de roles (para permisos)
  
  const [moduloActivo, setModuloActivo] = useState<'operaciones' | 'serviciosCompletados' | 'serviciosCancelados' | 'empresas' | 'contactos' | 'tipoCambio' | 'catalogos' | 'combustible' | 'proveedoresUnidad' | 'unidadesProveedor' | 'unidades' | 'remolques' | 'conveniosClientes' | 'conveniosProveedores' | 'direcciones' | 'colaboradores' | 'historialAsistencia' | 'roles' | 'usuarios' | 'logs' | 'flujosOperacion' | 'mtto' | 'facturacionClientes' | 'facturacionProveedores' | 'referenciasDiesel' | 'referenciasPuentes' | 'referenciasNomina' | 'deducciones' | 'reportes' | 'costosAdicionales' | 'datosEmpresa' | 'importacion' | 'autorizaciones'>('operaciones');
  
  const [perfilAbierto, setPerfilAbierto] = useState(false);
  const [miPerfilAbierto, setMiPerfilAbierto] = useState(false); // modal "Mi Perfil"
  const [menuAbierto, setMenuAbierto] = useState(true);
  
  const [menuBasesDatosAbierto, setMenuBasesDatosAbierto] = useState(false);
  const [menuClientesAbierto, setMenuClientesAbierto] = useState(false);
  const [menuProveedoresAbierto, setMenuProveedoresAbierto] = useState(false);
  const [menuEmpleadosAbierto, setMenuEmpleadosAbierto] = useState(false);
  const [menuConfiguracionAbierto, setMenuConfiguracionAbierto] = useState(false);
  const [menuGastosAbierto, setMenuGastosAbierto] = useState(false);

  const [modalChecadorAbierto, setModalChecadorAbierto] = useState(false);

  // ══════════════════════════════════════════════════════════════════════════
  // ✅ VISTA PREVIA "VER COMO": permite a un administrador ver la app con los
  //    permisos de otro ROL o de otro USUARIO (por correo), para verificar que
  //    todo esté en orden. Es SOLO visual y por pestaña (sessionStorage): la
  //    sesión de Firebase Auth sigue siendo la del admin, así que las security
  //    rules del servidor no cambian y la simulación no otorga permisos reales.
  // ══════════════════════════════════════════════════════════════════════════
  type VistaComo = { tipo: 'rol' | 'usuario'; etiqueta: string; roles: string[] };
  const CLAVE_VISTA_COMO = 'roelca_vista_como';
  const [vistaComo, setVistaComo] = useState<VistaComo | null>(() => {
    try { const g = sessionStorage.getItem(CLAVE_VISTA_COMO); return g ? JSON.parse(g) : null; } catch { return null; }
  });
  const [modalVerComo, setModalVerComo] = useState(false);
  const [verComoModo, setVerComoModo] = useState<'rol' | 'usuario'>('rol');
  const [verComoRol, setVerComoRol] = useState('');
  const [verComoCorreo, setVerComoCorreo] = useState('');
  const [verComoBuscando, setVerComoBuscando] = useState(false);
  const [verComoError, setVerComoError] = useState('');

  const activarVistaComo = (v: VistaComo) => {
    setVistaComo(v);
    try { sessionStorage.setItem(CLAVE_VISTA_COMO, JSON.stringify(v)); } catch { /* sin storage */ }
    setModalVerComo(false);
    setPerfilAbierto(false);
    setVerComoError('');
    registrarLog('Seguridad', 'Vista Previa', `Activó la vista previa como ${v.tipo === 'rol' ? 'rol' : 'usuario'}: ${v.etiqueta}`).catch(() => {});
  };

  const salirVistaComo = () => {
    setVistaComo(null);
    try { sessionStorage.removeItem(CLAVE_VISTA_COMO); } catch { /* sin storage */ }
    registrarLog('Seguridad', 'Vista Previa', 'Salió de la vista previa y regresó a sus permisos.').catch(() => {});
  };

  const aplicarVerComoRol = () => {
    if (!verComoRol) { setVerComoError('Selecciona un rol.'); return; }
    activarVistaComo({ tipo: 'rol', etiqueta: `Rol: ${verComoRol}`, roles: [verComoRol] });
  };

  const aplicarVerComoUsuario = async () => {
    const correo = verComoCorreo.trim().toLowerCase();
    if (!correo) { setVerComoError('Escribe el correo del usuario.'); return; }
    setVerComoBuscando(true);
    setVerComoError('');
    try {
      const snap = await getDocs(query(collection(db, 'usuarios'), where('email', '==', correo)));
      if (snap.empty) {
        setVerComoError('No se encontró ningún usuario con ese correo.');
        return;
      }
      const u: any = { id: snap.docs[0].id, ...snap.docs[0].data() };
      activarVistaComo({
        tipo: 'usuario',
        etiqueta: `${u.nombre || correo} (${(u.roles || []).join(', ') || 'sin roles'})`,
        roles: u.roles || []
      });
    } catch (e) {
      console.error('Error buscando usuario para vista previa:', e);
      setVerComoError('No se pudo buscar el usuario. Revisa tu conexión o permisos.');
    } finally {
      setVerComoBuscando(false);
    }
  };

  const toggleGrupo = (setter: React.Dispatch<React.SetStateAction<boolean>>) => {
    if (!menuAbierto) setMenuAbierto(true);
    setter(prev => !prev);
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setEstaAutenticado(true);
        const userDoc = await getDoc(doc(db, 'usuarios', user.uid));
        if (userDoc.exists()) {
          setUsuarioActualDB({ id: userDoc.id, ...userDoc.data() });
        }
      } else {
        setEstaAutenticado(false);
        setUsuarioActualDB(null);
      }
      setCargandoAuth(false);
    });
    return () => unsubscribe();
  }, []);

  // Catálogo de roles (para saber qué módulos puede ver el usuario)
  useEffect(() => {
    if (!estaAutenticado) return;
    const unsub = onSnapshot(collection(db, 'roles'), (snap) => {
      setRolesCatalogo(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });
    return () => unsub();
  }, [estaAutenticado]);

  const handleCerrarSesion = async (motivo: 'manual' | 'inactividad' = 'manual') => {
    if (auth.currentUser) {
      try {
        const detalle = motivo === 'inactividad' ? 'Cierre de sesión automático por inactividad (1 hora)' : 'Cierre de sesión manual voluntario';
        await registrarLog('Sesión', 'Cierre de Sesión', detalle);
        await updateDoc(doc(db, 'usuarios', auth.currentUser.uid), { isOnline: false });
      } catch (error) {
        console.warn(error);
      }
      await signOut(auth);
    }
    setEstaAutenticado(false);
    if (motivo === 'inactividad') {
      alert("Tu sesión se ha cerrado automáticamente por seguridad tras 1 hora de inactividad.");
    }
  };

  // ✅ CIERRE POR INACTIVIDAD (1 hora), COMPARTIDO ENTRE PESTAÑAS.
  //   La sesión de Firebase es una sola para todas las pestañas: si una pestaña
  //   olvidada en segundo plano llegaba a su hora de inactividad y hacía
  //   signOut, tumbaba la sesión de la pestaña que SÍ se estaba usando
  //   ("me saca de repente"). Por eso la última actividad ahora se guarda en
  //   localStorage (compartido entre pestañas): mientras CUALQUIER pestaña
  //   tenga actividad, ninguna cierra la sesión. Solo se cierra cuando pasa
  //   1 hora sin actividad en TODAS.
  useEffect(() => {
    if (!estaAutenticado) return;
    const LIMITE_INACTIVIDAD_MS = 60 * 60 * 1000; // 1 hora
    const CLAVE_ACTIVIDAD = 'roelca_ultima_actividad';
    let cerrando = false;
    let ultimoRegistroLocal = 0;

    const ahora = () => Date.now();
    const leerActividadGlobal = (): number => {
      try { return Number(localStorage.getItem(CLAVE_ACTIVIDAD)) || 0; } catch { return 0; }
    };
    const escribirActividadGlobal = (t: number) => {
      try { localStorage.setItem(CLAVE_ACTIVIDAD, String(t)); } catch { /* sin storage: no pasa nada */ }
    };

    // Al entrar, se marca actividad para no heredar una marca vieja.
    escribirActividadGlobal(ahora());

    // Registra actividad como máximo una vez cada 5 s (para no saturar storage).
    const registrarActividad = () => {
      const t = ahora();
      if (t - ultimoRegistroLocal < 5000) return;
      ultimoRegistroLocal = t;
      escribirActividadGlobal(t);
    };

    const verificar = () => {
      if (cerrando) return;
      const ultima = Math.max(leerActividadGlobal(), ultimoRegistroLocal);
      if (ultima > 0 && ahora() - ultima >= LIMITE_INACTIVIDAD_MS) {
        cerrando = true;
        handleCerrarSesion('inactividad');
      }
    };
    const alVolverVisible = () => { if (document.visibilityState === 'visible') verificar(); };

    const intervalo = setInterval(verificar, 30000);
    window.addEventListener('mousemove', registrarActividad);
    window.addEventListener('keydown', registrarActividad);
    window.addEventListener('mousedown', registrarActividad);
    window.addEventListener('touchstart', registrarActividad);
    window.addEventListener('wheel', registrarActividad, { passive: true });
    window.addEventListener('scroll', registrarActividad, true);
    document.addEventListener('visibilitychange', alVolverVisible);
    window.addEventListener('focus', verificar);

    return () => {
      clearInterval(intervalo);
      window.removeEventListener('mousemove', registrarActividad);
      window.removeEventListener('keydown', registrarActividad);
      window.removeEventListener('mousedown', registrarActividad);
      window.removeEventListener('touchstart', registrarActividad);
      window.removeEventListener('wheel', registrarActividad);
      window.removeEventListener('scroll', registrarActividad, true);
      document.removeEventListener('visibilitychange', alVolverVisible);
      window.removeEventListener('focus', verificar);
    };
  }, [estaAutenticado]);

  useEffect(() => {
    const handleTabClose = () => {
      if (auth.currentUser) {
        updateDoc(doc(db, 'usuarios', auth.currentUser.uid), { isOnline: false }).catch(() => console.log("Cerró rápido"));
      }
    };
    window.addEventListener('beforeunload', handleTabClose);
    return () => window.removeEventListener('beforeunload', handleTabClose);
  }, []);

  const rolesExentosChequeo = ['Admin', 'Gerencia', 'Sistemas'];
  const debeChecar = usuarioActualDB && !rolesExentosChequeo.includes(usuarioActualDB.rol);

  // ── PERMISOS: claves de módulos que el usuario puede ver ──
  // Acceso total REAL si: entró por Bypass (sin doc) o tiene un rol llamado ADMIN.
  const accesoTotalReal = !usuarioActualDB || (usuarioActualDB.roles || []).some((r: string) => String(r).toUpperCase() === 'ADMIN');

  // ✅ La vista previa solo se aplica si el usuario REAL es administrador
  //    (evita que una entrada manual en sessionStorage eleve permisos de UI).
  const vistaComoAplicada = accesoTotalReal ? vistaComo : null;

  // Roles EFECTIVOS: los simulados si hay vista previa activa; si no, los reales.
  const rolesEfectivos: string[] = vistaComoAplicada ? (vistaComoAplicada.roles || []) : (usuarioActualDB?.roles || []);
  const accesoTotal = vistaComoAplicada
    ? rolesEfectivos.some((r: string) => String(r).toUpperCase() === 'ADMIN')
    : accesoTotalReal;

  const clavesPermitidas = useMemo(() => {
    if (accesoTotal) return new Set<string>(ORDEN_CLAVES);
    const etiquetas = new Set<string>();
    rolesCatalogo.forEach((rol: any) => {
      if (rolesEfectivos.includes(rol.nombre)) {
        (rol.modulosPermitidos || []).forEach((m: string) => etiquetas.add(m));
      }
    });
    const claves = new Set<string>();
    etiquetas.forEach((et) => { const k = MODULOS_A_CLAVE[et]; if (k) claves.add(k); });
    return claves;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accesoTotal, usuarioActualDB, rolesCatalogo, vistaComoAplicada]);

  const puede = (clave: string) => clavesPermitidas.has(clave);

  // Si el módulo activo no está permitido, saltar al primer módulo permitido.
  // ⭐ 'importacion' es un módulo libre (visible para todos, sin permiso de rol),
  //    por eso se excluye aquí: si no, al abrirlo el guard rebotaba a Operaciones.
  useEffect(() => {
    if (accesoTotal) return;
    if (clavesPermitidas.size === 0) return;
    if (moduloActivo === 'importacion') return;
    if (!clavesPermitidas.has(moduloActivo)) {
      const primera = ORDEN_CLAVES.find(k => clavesPermitidas.has(k));
      if (primera) setModuloActivo(primera as any);
    }
  }, [clavesPermitidas, accesoTotal, moduloActivo]);

  if (cargandoAuth) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: '#010409', color: '#8b949e' }}>Cargando Roelca Inc...</div>;
  }

  if (!estaAutenticado) {
    return <Login onLoginSuccess={() => setEstaAutenticado(true)} />;
  }

  const esBaseDeDatosActiva = moduloActivo === 'empresas' || moduloActivo === 'contactos' || moduloActivo === 'tipoCambio' || moduloActivo === 'combustible' || moduloActivo === 'proveedoresUnidad' || moduloActivo === 'unidadesProveedor' || moduloActivo === 'unidades' || moduloActivo === 'remolques' || moduloActivo === 'direcciones';
  const esClientesActivo = moduloActivo === 'conveniosClientes' || moduloActivo === 'facturacionClientes';
  const esProveedoresActivo = moduloActivo === 'conveniosProveedores' || moduloActivo === 'facturacionProveedores';
  const esEmpleadosActivo = moduloActivo === 'colaboradores' || moduloActivo === 'historialAsistencia' || moduloActivo === 'referenciasNomina' || moduloActivo === 'deducciones';
  const esConfiguracionActivo = moduloActivo === 'roles' || moduloActivo === 'usuarios' || moduloActivo === 'logs' || moduloActivo === 'flujosOperacion' || moduloActivo === 'datosEmpresa' || moduloActivo === 'autorizaciones';
  const esGastosActivo = moduloActivo === 'mtto' || moduloActivo === 'referenciasDiesel' || moduloActivo === 'referenciasPuentes' || moduloActivo === 'costosAdicionales';

  // Visibilidad de cada grupo: se muestra si al menos un hijo está permitido.
  const verGastos = puede('mtto') || puede('referenciasDiesel') || puede('referenciasPuentes') || puede('costosAdicionales');
  const verClientes = puede('conveniosClientes') || puede('facturacionClientes');
  const verProveedores = puede('conveniosProveedores') || puede('facturacionProveedores');
  const verEmpleados = puede('colaboradores') || puede('historialAsistencia') || puede('referenciasNomina') || puede('deducciones');
  const verBasesDatos = puede('empresas') || puede('contactos') || puede('direcciones') || puede('tipoCambio') || puede('combustible') || puede('unidades') || puede('remolques') || puede('proveedoresUnidad') || puede('unidadesProveedor');
  const verConfiguracion = puede('usuarios') || puede('roles') || puede('logs') || puede('flujosOperacion') || puede('datosEmpresa') || puede('autorizaciones');

  const sinModulos = !accesoTotal && clavesPermitidas.size === 0;

  // Avatar (foto si existe; si no, iniciales)
  const inicialesUsuario = usuarioActualDB?.nombre ? usuarioActualDB.nombre.substring(0, 2).toUpperCase() : 'JM';
  const fotoUsuario = usuarioActualDB?.fotoPerfil || '';

  return (
    <div className="app-wrapper">
      
      <RelojChecadorModal isOpen={modalChecadorAbierto} onClose={() => setModalChecadorAbierto(false)} usuario={usuarioActualDB} />

      {/* ✅ BANNER DE VISTA PREVIA: siempre visible mientras se está "viendo como" */}
      {vistaComoAplicada && (
        <div style={{ position: 'fixed', top: '10px', left: '50%', transform: 'translateX(-50%)', zIndex: 3000, display: 'flex', alignItems: 'center', gap: '14px', backgroundColor: '#3b0764', border: '1px solid #a855f7', borderRadius: '999px', padding: '8px 10px 8px 18px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)', maxWidth: '92vw' }}>
          <span style={{ color: '#e9d5ff', fontSize: '0.85rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            👁 Vista previa — {vistaComoAplicada.etiqueta}
          </span>
          <button onClick={salirVistaComo} style={{ backgroundColor: '#a855f7', color: '#fff', border: 'none', borderRadius: '999px', padding: '6px 16px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
            Salir de la vista
          </button>
        </div>
      )}

      {/* ✅ MODAL "VER COMO": elegir un rol del catálogo o buscar un usuario por correo */}
      {modalVerComo && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2500, padding: '20px', backdropFilter: 'blur(6px)' }}>
          <div className="form-card" style={{ maxWidth: '480px', width: '100%', backgroundColor: '#0d1117', border: '1px solid #444', borderRadius: '12px' }}>
            <div className="form-header" style={{ padding: '20px 24px', borderBottom: '1px solid #30363d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '1.1rem', color: '#f0f6fc', margin: 0, fontWeight: 500 }}>👁 Ver la app como...</h2>
              <button onClick={() => setModalVerComo(false)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>

            <div style={{ padding: '24px' }}>
              <p style={{ color: '#8b949e', fontSize: '0.82rem', margin: '0 0 16px 0' }}>
                Verás el menú y los módulos exactamente como los ve ese rol o usuario. Tu sesión no cambia y puedes salir de la vista en cualquier momento.
              </p>

              <div style={{ display: 'flex', gap: '8px', marginBottom: '18px' }}>
                <button onClick={() => { setVerComoModo('rol'); setVerComoError(''); }} style={{ flex: 1, padding: '9px', borderRadius: '6px', cursor: 'pointer', border: '1px solid ' + (verComoModo === 'rol' ? '#a855f7' : '#30363d'), backgroundColor: verComoModo === 'rol' ? 'rgba(168,85,247,0.15)' : 'transparent', color: verComoModo === 'rol' ? '#e9d5ff' : '#8b949e', fontWeight: 'bold', fontSize: '0.85rem' }}>Por Rol</button>
                <button onClick={() => { setVerComoModo('usuario'); setVerComoError(''); }} style={{ flex: 1, padding: '9px', borderRadius: '6px', cursor: 'pointer', border: '1px solid ' + (verComoModo === 'usuario' ? '#a855f7' : '#30363d'), backgroundColor: verComoModo === 'usuario' ? 'rgba(168,85,247,0.15)' : 'transparent', color: verComoModo === 'usuario' ? '#e9d5ff' : '#8b949e', fontWeight: 'bold', fontSize: '0.85rem' }}>Por Usuario (correo)</button>
              </div>

              {verComoError && (
                <div style={{ backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)', color: '#ef4444', padding: '10px 12px', borderRadius: '6px', marginBottom: '14px', fontSize: '0.82rem' }}>{verComoError}</div>
              )}

              {verComoModo === 'rol' ? (
                <>
                  <label style={{ color: '#8b949e', fontSize: '0.8rem', display: 'block', marginBottom: '6px' }}>Rol a simular</label>
                  <select value={verComoRol} onChange={(e) => setVerComoRol(e.target.value)} style={{ width: '100%', padding: '10px', backgroundColor: '#010409', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: '6px', boxSizing: 'border-box', marginBottom: '18px' }}>
                    <option value="">-- Seleccionar rol --</option>
                    {rolesCatalogo.map((r: any) => (
                      <option key={r.id} value={r.nombre}>{r.nombre}</option>
                    ))}
                  </select>
                  <button onClick={aplicarVerComoRol} style={{ width: '100%', padding: '11px', backgroundColor: '#a855f7', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.9rem' }}>Activar vista previa</button>
                </>
              ) : (
                <>
                  <label style={{ color: '#8b949e', fontSize: '0.8rem', display: 'block', marginBottom: '6px' }}>Correo del usuario</label>
                  <input
                    type="email"
                    value={verComoCorreo}
                    onChange={(e) => setVerComoCorreo(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') aplicarVerComoUsuario(); }}
                    placeholder="usuario@roelca.com"
                    style={{ width: '100%', padding: '10px', backgroundColor: '#010409', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: '6px', boxSizing: 'border-box', marginBottom: '18px' }}
                  />
                  <button onClick={aplicarVerComoUsuario} disabled={verComoBuscando} style={{ width: '100%', padding: '11px', backgroundColor: '#a855f7', color: '#fff', border: 'none', borderRadius: '6px', cursor: verComoBuscando ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '0.9rem', opacity: verComoBuscando ? 0.6 : 1 }}>
                    {verComoBuscando ? 'Buscando usuario...' : 'Buscar y activar vista previa'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {miPerfilAbierto && usuarioActualDB && (
        <MiPerfil
          usuario={usuarioActualDB}
          onClose={() => setMiPerfilAbierto(false)}
          onActualizado={(u) => setUsuarioActualDB(u)}
        />
      )}

      <div className={`sidebar ${!menuAbierto ? 'collapsed' : ''}`}>
        <div className="sidebar-brand">
          <EmpresaBrand />
        </div>

        {puede('operaciones') && (
          <div className={`sidebar-item ${moduloActivo === 'operaciones' ? 'active' : ''}`} title="Operaciones Activas" onClick={() => setModuloActivo('operaciones')}>
            <span className="sidebar-icon">{ICON.operaciones}</span>
            <span className="sidebar-label">Operaciones Activas</span>
          </div>
        )}

        {puede('serviciosCompletados') && (
          <div className={`sidebar-item ${moduloActivo === 'serviciosCompletados' ? 'active' : ''}`} title="Servicios Completados" onClick={() => setModuloActivo('serviciosCompletados')}>
            <span className="sidebar-icon">{ICON.serviciosCompletados}</span>
            <span className="sidebar-label">Servicios Completados</span>
          </div>
        )}

        {puede('serviciosCancelados') && (
          <div className={`sidebar-item ${moduloActivo === 'serviciosCancelados' ? 'active' : ''}`} title="Servicios Cancelados" onClick={() => setModuloActivo('serviciosCancelados')}>
            <span className="sidebar-icon">{ICON.serviciosCancelados}</span>
            <span className="sidebar-label">Servicios Cancelados</span>
          </div>
        )}

        {puede('reportes') && (
          <div className={`sidebar-item ${moduloActivo === 'reportes' ? 'active' : ''}`} title="Reportes" onClick={() => setModuloActivo('reportes')}>
            <span className="sidebar-icon">{ICON.reportes}</span>
            <span className="sidebar-label">Reportes</span>
          </div>
        )}

        {verGastos && (
          <>
            <div className={`sidebar-item sidebar-item-with-icon ${esGastosActivo && !menuGastosAbierto ? 'active' : ''}`} title="Gastos" onClick={() => toggleGrupo(setMenuGastosAbierto)}>
              <span className="sidebar-icon">{ICON.gastos}</span><span className="sidebar-label">Gastos</span>
              <span className="sidebar-chevron" style={{ fontSize: '0.7rem' }}>{menuGastosAbierto ? '▼' : '▶'}</span>
            </div>
            {menuGastosAbierto && (
              <div className="sidebar-submenu">
                {puede('mtto') && <div className={`sidebar-subitem ${moduloActivo === 'mtto' ? 'active' : ''}`} onClick={() => setModuloActivo('mtto')}><span className="sidebar-icon">{ICON.mtto}</span><span className="sidebar-label">MTTO</span></div>}
                {puede('referenciasDiesel') && <div className={`sidebar-subitem ${moduloActivo === 'referenciasDiesel' ? 'active' : ''}`} onClick={() => setModuloActivo('referenciasDiesel')}><span className="sidebar-icon">{ICON.referenciasDiesel}</span><span className="sidebar-label">Referencias del Diesel</span></div>}
                {puede('referenciasPuentes') && <div className={`sidebar-subitem ${moduloActivo === 'referenciasPuentes' ? 'active' : ''}`} onClick={() => setModuloActivo('referenciasPuentes')}><span className="sidebar-icon">{ICON.referenciasPuentes}</span><span className="sidebar-label">Referencias de Puentes</span></div>}
                {puede('costosAdicionales') && <div className={`sidebar-subitem ${moduloActivo === 'costosAdicionales' ? 'active' : ''}`} onClick={() => setModuloActivo('costosAdicionales')}><span className="sidebar-icon">{ICON.costosAdicionales}</span><span className="sidebar-label">Costos Adicionales</span></div>}
              </div>
            )}
          </>
        )}

        {verClientes && (
          <>
            <div className={`sidebar-item sidebar-item-with-icon ${esClientesActivo && !menuClientesAbierto ? 'active' : ''}`} title="Clientes" onClick={() => toggleGrupo(setMenuClientesAbierto)}>
              <span className="sidebar-icon">{ICON.clientes}</span>
              <span className="sidebar-label">Clientes</span>
              <span className="sidebar-chevron" style={{ fontSize: '0.7rem' }}>{menuClientesAbierto ? '▼' : '▶'}</span>
            </div>
            {menuClientesAbierto && (
              <div className="sidebar-submenu">
                {puede('conveniosClientes') && <div className={`sidebar-subitem ${moduloActivo === 'conveniosClientes' ? 'active' : ''}`} onClick={() => setModuloActivo('conveniosClientes')}><span className="sidebar-icon">{ICON.conveniosClientes}</span><span className="sidebar-label">Convenio de Clientes</span></div>}
                {puede('facturacionClientes') && <div className={`sidebar-subitem ${moduloActivo === 'facturacionClientes' ? 'active' : ''}`} onClick={() => setModuloActivo('facturacionClientes')}><span className="sidebar-icon">{ICON.facturacionClientes}</span><span className="sidebar-label">Facturación</span></div>}
              </div>
            )}
          </>
        )}

        {verProveedores && (
          <>
            <div className={`sidebar-item sidebar-item-with-icon ${esProveedoresActivo && !menuProveedoresAbierto ? 'active' : ''}`} title="Proveedores" onClick={() => toggleGrupo(setMenuProveedoresAbierto)}>
              <span className="sidebar-icon">{ICON.proveedores}</span>
              <span className="sidebar-label">Proveedores</span>
              <span className="sidebar-chevron" style={{ fontSize: '0.7rem' }}>{menuProveedoresAbierto ? '▼' : '▶'}</span>
            </div>
            {menuProveedoresAbierto && (
              <div className="sidebar-submenu">
                {puede('conveniosProveedores') && <div className={`sidebar-subitem ${moduloActivo === 'conveniosProveedores' ? 'active' : ''}`} onClick={() => setModuloActivo('conveniosProveedores')}><span className="sidebar-icon">{ICON.conveniosProveedores}</span><span className="sidebar-label">Convenio de Proveedores</span></div>}
                {puede('facturacionProveedores') && <div className={`sidebar-subitem ${moduloActivo === 'facturacionProveedores' ? 'active' : ''}`} onClick={() => setModuloActivo('facturacionProveedores')}><span className="sidebar-icon">{ICON.facturacionProveedores}</span><span className="sidebar-label">Facturación</span></div>}
              </div>
            )}
          </>
        )}

        {verEmpleados && (
          <>
            <div className={`sidebar-item sidebar-item-with-icon ${esEmpleadosActivo && !menuEmpleadosAbierto ? 'active' : ''}`} title="Empleados" onClick={() => toggleGrupo(setMenuEmpleadosAbierto)}>
              <span className="sidebar-icon">{ICON.empleados}</span>
              <span className="sidebar-label">Empleados</span>
              <span className="sidebar-chevron" style={{ fontSize: '0.7rem' }}>{menuEmpleadosAbierto ? '▼' : '▶'}</span>
            </div>
            {menuEmpleadosAbierto && (
              <div className="sidebar-submenu">
                {puede('colaboradores') && <div className={`sidebar-subitem ${moduloActivo === 'colaboradores' ? 'active' : ''}`} onClick={() => setModuloActivo('colaboradores')}><span className="sidebar-icon">{ICON.colaboradores}</span><span className="sidebar-label">Colaboradores</span></div>}
                {puede('historialAsistencia') && <div className={`sidebar-subitem ${moduloActivo === 'historialAsistencia' ? 'active' : ''}`} onClick={() => setModuloActivo('historialAsistencia')}><span className="sidebar-icon">{ICON.historialAsistencia}</span><span className="sidebar-label">Historial de Chequeo</span></div>}
                {puede('referenciasNomina') && <div className={`sidebar-subitem ${moduloActivo === 'referenciasNomina' ? 'active' : ''}`} onClick={() => setModuloActivo('referenciasNomina')}><span className="sidebar-icon">{ICON.referenciasNomina}</span><span className="sidebar-label">Nómina</span></div>}
                {puede('deducciones') && <div className={`sidebar-subitem ${moduloActivo === 'deducciones' ? 'active' : ''}`} onClick={() => setModuloActivo('deducciones')}><span className="sidebar-icon">{ICON.deducciones}</span><span className="sidebar-label">Deducciones</span></div>}
              </div>
            )}
          </>
        )}

        {verBasesDatos && (
          <>
            <div className={`sidebar-item sidebar-item-with-icon ${esBaseDeDatosActiva && !menuBasesDatosAbierto ? 'active' : ''}`} title="Bases de Datos" onClick={() => toggleGrupo(setMenuBasesDatosAbierto)}>
              <span className="sidebar-icon">{ICON.basesDatos}</span>
              <span className="sidebar-label">Bases de Datos</span>
              <span className="sidebar-chevron" style={{ fontSize: '0.7rem' }}>{menuBasesDatosAbierto ? '▼' : '▶'}</span>
            </div>
            {menuBasesDatosAbierto && (
              <div className="sidebar-submenu">
                {puede('empresas') && <div className={`sidebar-subitem ${moduloActivo === 'empresas' ? 'active' : ''}`} onClick={() => setModuloActivo('empresas')}><span className="sidebar-icon">{ICON.empresas}</span><span className="sidebar-label">Empresas</span></div>}
                {puede('contactos') && <div className={`sidebar-subitem ${moduloActivo === 'contactos' ? 'active' : ''}`} onClick={() => setModuloActivo('contactos')}><span className="sidebar-icon">{ICON.contactos}</span><span className="sidebar-label">Contactos</span></div>}
                {puede('direcciones') && <div className={`sidebar-subitem ${moduloActivo === 'direcciones' ? 'active' : ''}`} onClick={() => setModuloActivo('direcciones')}><span className="sidebar-icon">{ICON.direcciones}</span><span className="sidebar-label">Direcciones</span></div>}
                {puede('tipoCambio') && <div className={`sidebar-subitem ${moduloActivo === 'tipoCambio' ? 'active' : ''}`} onClick={() => setModuloActivo('tipoCambio')}><span className="sidebar-icon">{ICON.tipoCambio}</span><span className="sidebar-label">Tipo de Cambio</span></div>}
                {puede('combustible') && <div className={`sidebar-subitem ${moduloActivo === 'combustible' ? 'active' : ''}`} onClick={() => setModuloActivo('combustible')}><span className="sidebar-icon">{ICON.combustible}</span><span className="sidebar-label">Combustible</span></div>}
                {puede('unidades') && <div className={`sidebar-subitem ${moduloActivo === 'unidades' ? 'active' : ''}`} onClick={() => setModuloActivo('unidades')}><span className="sidebar-icon">{ICON.unidades}</span><span className="sidebar-label">Unidades Propias</span></div>}
                {puede('remolques') && <div className={`sidebar-subitem ${moduloActivo === 'remolques' ? 'active' : ''}`} onClick={() => setModuloActivo('remolques')}><span className="sidebar-icon">{ICON.remolques}</span><span className="sidebar-label">Remolques</span></div>}
                {puede('proveedoresUnidad') && <div className={`sidebar-subitem ${moduloActivo === 'proveedoresUnidad' ? 'active' : ''}`} onClick={() => setModuloActivo('proveedoresUnidad')}><span className="sidebar-icon">{ICON.proveedoresUnidad}</span><span className="sidebar-label">Proveedores de Unidad</span></div>}
                {puede('unidadesProveedor') && <div className={`sidebar-subitem ${moduloActivo === 'unidadesProveedor' ? 'active' : ''}`} onClick={() => setModuloActivo('unidadesProveedor')}><span className="sidebar-icon">{ICON.unidadesProveedor}</span><span className="sidebar-label">Unidades del Proveedor</span></div>}
              </div>
            )}
          </>
        )}

        {puede('catalogos') && (
          <div className={`sidebar-item ${moduloActivo === 'catalogos' ? 'active' : ''}`} title="Catálogos" onClick={() => setModuloActivo('catalogos')}>
            <span className="sidebar-icon">{ICON.catalogos}</span>
            <span className="sidebar-label">Catálogos</span>
          </div>
        )}

        {verConfiguracion && (
          <>
            <div className={`sidebar-item sidebar-item-with-icon ${esConfiguracionActivo && !menuConfiguracionAbierto ? 'active' : ''}`} title="Configuración" onClick={() => toggleGrupo(setMenuConfiguracionAbierto)}>
              <span className="sidebar-icon">{ICON.configuracion}</span>
              <span className="sidebar-label">Configuración</span>
              <span className="sidebar-chevron" style={{ fontSize: '0.7rem' }}>{menuConfiguracionAbierto ? '▼' : '▶'}</span>
            </div>
            {menuConfiguracionAbierto && (
              <div className="sidebar-submenu">
                {puede('usuarios') && <div className={`sidebar-subitem ${moduloActivo === 'usuarios' ? 'active' : ''}`} onClick={() => setModuloActivo('usuarios')}><span className="sidebar-icon">{ICON.usuarios}</span><span className="sidebar-label">Usuarios</span></div>}
                {puede('roles') && <div className={`sidebar-subitem ${moduloActivo === 'roles' ? 'active' : ''}`} onClick={() => setModuloActivo('roles')}><span className="sidebar-icon">{ICON.roles}</span><span className="sidebar-label">Roles y Permisos</span></div>}
                {puede('logs') && <div className={`sidebar-subitem ${moduloActivo === 'logs' ? 'active' : ''}`} onClick={() => setModuloActivo('logs')}><span className="sidebar-icon">{ICON.logs}</span><span className="sidebar-label">Historial de Actividad</span></div>}
                {puede('flujosOperacion') && <div className={`sidebar-subitem ${moduloActivo === 'flujosOperacion' ? 'active' : ''}`} onClick={() => setModuloActivo('flujosOperacion')}><span className="sidebar-icon">{ICON.flujosOperacion}</span><span className="sidebar-label">Reglas de Estatus</span></div>}
                {puede('datosEmpresa') && <div className={`sidebar-subitem ${moduloActivo === 'datosEmpresa' ? 'active' : ''}`} onClick={() => setModuloActivo('datosEmpresa')}><span className="sidebar-icon">{ICON.datosEmpresa}</span><span className="sidebar-label">Datos de la Empresa</span></div>}
                {/* ✅ AUTORIZACIONES: lo ve quien tenga el módulo asignado en su rol (Admin siempre). */}
                {puede('autorizaciones') && <div className={`sidebar-subitem ${moduloActivo === 'autorizaciones' ? 'active' : ''}`} title="Autorizaciones" onClick={() => setModuloActivo('autorizaciones')}><span className="sidebar-icon"><Ico><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></Ico></span><span className="sidebar-label">Autorizaciones</span></div>}
                <div className={`sidebar-subitem ${moduloActivo === 'importacion' ? 'active' : ''}`} title="Importar datos desde CSV" onClick={() => setModuloActivo('importacion')}><span className="sidebar-icon"><Ico><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></Ico></span><span className="sidebar-label">Importar Datos</span></div>
              </div>
            )}
          </>
        )}

        <div className="sidebar-footer">
          <button className="btn-logout-sidebar" onClick={() => handleCerrarSesion('manual')}>Cerrar Sesión</button>
        </div>
      </div>

      <div className="main-area">
        <div className="topbar" style={{ justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <button className="menu-toggle-btn" onClick={() => setMenuAbierto(!menuAbierto)} title="Ocultar/Mostrar Menú">☰</button>
          </div>
          
          <div className="topbar-right" style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '20px' }}>
            {accesoTotalReal && !vistaComoAplicada && (
              <button
                onClick={() => setModalVerComo(true)}
                title="Ver la app como otro rol o usuario"
                style={{
                  backgroundColor: 'rgba(168, 85, 247, 0.15)', border: '1px solid #a855f7', color: '#e9d5ff',
                  padding: '8px 16px', borderRadius: '20px', cursor: 'pointer', fontWeight: 'bold',
                  display: 'flex', alignItems: 'center', gap: '8px', transition: 'all 0.2s ease', whiteSpace: 'nowrap'
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(168, 85, 247, 0.35)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(168, 85, 247, 0.15)'}
              >
                👁 Ver como
              </button>
            )}
            {debeChecar && (
              <button 
                onClick={() => setModalChecadorAbierto(true)}
                style={{ 
                  backgroundColor: 'rgba(59, 130, 246, 0.15)', border: '1px solid #3b82f6', color: '#58a6ff',
                  padding: '8px 16px', borderRadius: '20px', cursor: 'pointer', fontWeight: 'bold',
                  display: 'flex', alignItems: 'center', gap: '8px', transition: 'all 0.2s ease', whiteSpace: 'nowrap'
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#3b82f6'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.15)'}
              >
                ⏱️ Checar Turno
              </button>
            )}
            
            <div className="avatar" style={{ cursor: 'pointer', backgroundColor: '#D84315', color: 'white', border: 'none', overflow: 'hidden' }} onClick={() => setPerfilAbierto(!perfilAbierto)}>
              {fotoUsuario
                ? <img src={fotoUsuario} alt="Perfil" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                : inicialesUsuario}
            </div>

            {perfilAbierto && (
              <div className="profile-dropdown">
                <div className="profile-header-info">
                  <div className="profile-avatar-large" style={{ backgroundColor: '#D84315', color: 'white', overflow: 'hidden' }}>
                    {fotoUsuario
                      ? <img src={fotoUsuario} alt="Perfil" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                      : inicialesUsuario}
                  </div>
                  <div className="profile-text">
                    <span className="profile-name">{usuarioActualDB?.nombre || 'Usuario'}</span>
                    <span className="profile-role">{(usuarioActualDB?.roles && usuarioActualDB.roles.join(', ')) || usuarioActualDB?.rol || 'Rol'}</span>
                  </div>
                </div>
                <div className="profile-actions">
                  <button className="btn-profile" onClick={() => { setPerfilAbierto(false); setMiPerfilAbierto(true); }}>Mi Perfil (Foto y Contraseña)</button>
                  {accesoTotalReal && !vistaComoAplicada && (
                    <button className="btn-profile" onClick={() => { setPerfilAbierto(false); setModalVerComo(true); }}>👁 Ver como (rol o usuario)</button>
                  )}
                  {vistaComoAplicada && (
                    <button className="btn-profile" onClick={() => { setPerfilAbierto(false); salirVistaComo(); }}>👁 Salir de la vista previa</button>
                  )}
                  <button className="btn-profile logout" onClick={() => handleCerrarSesion('manual')}>Cerrar Sesión</button>
                </div>
              </div>
            )}
          </div>
        </div>

        {sinModulos ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 120px)', color: '#8b949e', textAlign: 'center', padding: '24px' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>🔒</div>
            <h2 style={{ color: '#f0f6fc', margin: '0 0 8px 0' }}>Sin módulos asignados</h2>
            <p style={{ maxWidth: '420px' }}>Tu usuario no tiene módulos habilitados todavía. Contacta al administrador para que te asigne un rol con acceso.</p>
          </div>
        ) : (
          <Suspense fallback={<CargandoModulo />}>
            {moduloActivo === 'operaciones' && puede('operaciones') && (
              <>
                <ResumenDelDia />
                <OperacionesDashboard />
              </>
            )}
            {moduloActivo === 'serviciosCompletados' && puede('serviciosCompletados') && <ServiciosCompletados />}
            {moduloActivo === 'serviciosCancelados' && puede('serviciosCancelados') && <ServiciosCancelados />}
            {moduloActivo === 'reportes' && puede('reportes') && <ReportesDashboard />}
            {moduloActivo === 'autorizaciones' && puede('autorizaciones') && <AutorizacionesDashboard />}
            {moduloActivo === 'mtto' && puede('mtto') && <MttoDashboard />} 
            {moduloActivo === 'referenciasDiesel' && puede('referenciasDiesel') && <ReferenciasDieselDashboard />} 
            {moduloActivo === 'referenciasPuentes' && puede('referenciasPuentes') && <ReferenciasPuentesDashboard />} 
            {moduloActivo === 'costosAdicionales' && puede('costosAdicionales') && <CostosAdicionalesDashboard />} 
            {moduloActivo === 'referenciasNomina' && puede('referenciasNomina') && <ReferenciasNominaDashboard />}
            {moduloActivo === 'importacion' && <DataImportView onOpenMenu={() => setMenuAbierto(true)} />} 
            {moduloActivo === 'deducciones' && puede('deducciones') && <DeduccionesDashboard />} 
            {moduloActivo === 'empresas' && puede('empresas') && <EmpresasDashboard />}
            {moduloActivo === 'contactos' && puede('contactos') && <ContactosDashboard />}
            {moduloActivo === 'direcciones' && puede('direcciones') && <DireccionesDashboard />}
            {moduloActivo === 'tipoCambio' && puede('tipoCambio') && <TipoCambioDashboard />}
            {moduloActivo === 'combustible' && puede('combustible') && <CombustibleDashboard />}
            {moduloActivo === 'unidades' && puede('unidades') && <UnidadesDashboard />} 
            {moduloActivo === 'remolques' && puede('remolques') && <RemolquesDashboard />} 
            {moduloActivo === 'proveedoresUnidad' && puede('proveedoresUnidad') && <ProveedoresUnidadDashboard />}
            {moduloActivo === 'unidadesProveedor' && puede('unidadesProveedor') && <UnidadesProveedorDashboard />}
            {moduloActivo === 'conveniosClientes' && puede('conveniosClientes') && <ConveniosClientesDashboard />}
            {moduloActivo === 'conveniosProveedores' && puede('conveniosProveedores') && <ConveniosProveedoresDashboard />}
            {moduloActivo === 'catalogos' && puede('catalogos') && <CatalogosDashboard />}
            {moduloActivo === 'colaboradores' && puede('colaboradores') && <EmpleadosDashboard />}
            {moduloActivo === 'historialAsistencia' && puede('historialAsistencia') && <HistorialChequeosDashboard usuarioActual={usuarioActualDB} />}
            {moduloActivo === 'roles' && puede('roles') && <RolesDashboard />}
            {moduloActivo === 'usuarios' && puede('usuarios') && <UsuariosDashboard />}
            {moduloActivo === 'logs' && puede('logs') && <LogsDashboard />}
            {moduloActivo === 'flujosOperacion' && puede('flujosOperacion') && <ConfiguradorStatus />}
            {moduloActivo === 'datosEmpresa' && puede('datosEmpresa') && <ConfiguracionEmpresa />}
            {moduloActivo === 'facturacionClientes' && puede('facturacionClientes') && <FacturacionClientesDashboard />}
            {moduloActivo === 'facturacionProveedores' && puede('facturacionProveedores') && <FacturacionProveedoresDashboard />}
          </Suspense>
        )}
        
      </div>
    </div>
  );
}

export default App;