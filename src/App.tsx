import { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, updateDoc, getDoc, collection, onSnapshot } from 'firebase/firestore'; 
import { auth, db } from './config/firebase'; 
import { registrarLog } from './utils/logger'; 

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
const OperacionesDashboard = lazy(() => import('./features/operaciones/components/OperacionesDashboard'));
const ServiciosCompletados = lazy(() => import('./features/operaciones/components/ServiciosCompletados'));
const ServiciosCancelados = lazy(() => import('./features/operaciones/components/ServiciosCancelados'));
const ReportesDashboard = lazy(() => import('./features/reportes/components/ReportesDashboard'));
const EmpresasDashboard = lazy(() => import('./features/empresas/components/EmpresasDashboard'));
const ContactosDashboard = lazy(() => import('./features/contactos/components/ContactosDashboard').then(m => ({ default: m.ContactosDashboard })));
const TipoCambioDashboard = lazy(() => import('./features/tipoCambio/components/TipoCambioDashboard').then(m => ({ default: m.TipoCambioDashboard })));
const CatalogosDashboard = lazy(() => import('./features/catalogos/components/CatalogosDashboard'));
const CombustibleDashboard = lazy(() => import('./features/combustible/components/CombustibleDashboard').then(m => ({ default: m.CombustibleDashboard })));
const ProveedoresUnidadDashboard = lazy(() => import('./features/proveedoresUnidad/components/ProveedoresUnidadDashboard'));
const UnidadesProveedorDashboard = lazy(() => import('./features/unidadesProveedor/components/UnidadesProveedorDashboard').then(m => ({ default: m.UnidadesProveedorDashboard })));
const UnidadesDashboard = lazy(() => import('./features/unidades/components/UnidadesDashboard'));
const RemolquesDashboard = lazy(() => import('./features/remolques/components/RemolquesDashboard'));
const ConveniosClientesDashboard = lazy(() => import('./features/conveniosClientes/components/ConveniosClientesDashboard'));
const ConveniosProveedoresDashboard = lazy(() => import('./features/conveniosProveedores/components/ConveniosProveedoresDashboard').then(m => ({ default: m.ConveniosProveedoresDashboard })));
const DireccionesDashboard = lazy(() => import('./features/direcciones/components/DireccionesDashboard').then(m => ({ default: m.DireccionesDashboard })));
const EmpleadosDashboard = lazy(() => import('./features/empleados/components/EmpleadosDashboard').then(m => ({ default: m.EmpleadosDashboard })));
const RolesDashboard = lazy(() => import('./usuarios/components/RolesDashboard').then(m => ({ default: m.RolesDashboard })));
const UsuariosDashboard = lazy(() => import('./usuarios/components/UsuariosDashboard').then(m => ({ default: m.UsuariosDashboard })));
const LogsDashboard = lazy(() => import('./features/configuracion/components/LogsDashboard').then(m => ({ default: m.LogsDashboard })));
const ConfiguradorStatus = lazy(() => import('./features/configuracion/components/ConfiguradorStatus').then(m => ({ default: m.ConfiguradorStatus })));
const HistorialChequeosDashboard = lazy(() => import('./features/relojChecador/components/HistorialChequeosDashboard').then(m => ({ default: m.HistorialChequeosDashboard })));
const MttoDashboard = lazy(() => import('./features/gastos/components/mtto/MttoDashboard'));
const ReferenciasDieselDashboard = lazy(() => import('./features/diesel/components/ReferenciasDieselDashboard').then(m => ({ default: m.ReferenciasDieselDashboard })));
const ReferenciasPuentesDashboard = lazy(() => import('./features/puentes/components/ReferenciasPuentesDashboard').then(m => ({ default: m.ReferenciasPuentesDashboard })));
const ReferenciasNominaDashboard = lazy(() => import('./features/nominas/components/ReferenciasNominaDashboard').then(m => ({ default: m.ReferenciasNominaDashboard })));
const DeduccionesDashboard = lazy(() => import('./features/empleados/components/DeduccionesDashboard').then(m => ({ default: m.DeduccionesDashboard })));
const FacturacionClientesDashboard = lazy(() => import('./features/facturacion/components/FacturacionClientesDashboard').then(m => ({ default: m.FacturacionClientesDashboard })));
const FacturacionProveedoresDashboard = lazy(() => import('./features/facturacion/components/FacturacionProveedoresDashboard').then(m => ({ default: m.FacturacionProveedoresDashboard })));
const CostosAdicionalesDashboard = lazy(() => import('./features/costosAdicionales/CostosAdicionalesDashboard').then(m => ({ default: m.CostosAdicionalesDashboard })));
const ConfiguracionEmpresa = lazy(() => import('./features/configuracion/ConfiguracionEmpresa'));

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
    Cargando módulo…
    <style>{`@keyframes spinRoelca { to { transform: rotate(360deg); } }`}</style>
  </div>
);

function App() {
  const [estaAutenticado, setEstaAutenticado] = useState(false);
  const [cargandoAuth, setCargandoAuth] = useState(true); 
  const [usuarioActualDB, setUsuarioActualDB] = useState<any>(null); 
  const [rolesCatalogo, setRolesCatalogo] = useState<any[]>([]); // catálogo de roles (para permisos)
  
  const [moduloActivo, setModuloActivo] = useState<'operaciones' | 'serviciosCompletados' | 'serviciosCancelados' | 'empresas' | 'contactos' | 'tipoCambio' | 'catalogos' | 'combustible' | 'proveedoresUnidad' | 'unidadesProveedor' | 'unidades' | 'remolques' | 'conveniosClientes' | 'conveniosProveedores' | 'direcciones' | 'colaboradores' | 'historialAsistencia' | 'roles' | 'usuarios' | 'logs' | 'flujosOperacion' | 'mtto' | 'facturacionClientes' | 'facturacionProveedores' | 'referenciasDiesel' | 'referenciasPuentes' | 'referenciasNomina' | 'deducciones' | 'reportes' | 'costosAdicionales' | 'datosEmpresa'>('operaciones');
  
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
        const detalle = motivo === 'inactividad' ? 'Cierre de sesión automático por inactividad (10 min)' : 'Cierre de sesión manual voluntario';
        await registrarLog('Sesión', 'Cierre de Sesión', detalle);
        await updateDoc(doc(db, 'usuarios', auth.currentUser.uid), { isOnline: false });
      } catch (error) {
        console.warn(error);
      }
      await signOut(auth);
    }
    setEstaAutenticado(false);
    if (motivo === 'inactividad') {
      alert("Tu sesión se ha cerrado automáticamente por seguridad tras 10 minutos de inactividad.");
    }
  };

  useEffect(() => {
    if (!estaAutenticado) return;
    let timeoutId: ReturnType<typeof setTimeout>;
    const resetTimer = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => { handleCerrarSesion('inactividad'); }, 600000); 
    };
    window.addEventListener('mousemove', resetTimer);
    window.addEventListener('keydown', resetTimer);
    window.addEventListener('mousedown', resetTimer);
    window.addEventListener('touchstart', resetTimer);
    resetTimer(); 
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('mousemove', resetTimer);
      window.removeEventListener('keydown', resetTimer);
      window.removeEventListener('mousedown', resetTimer);
      window.removeEventListener('touchstart', resetTimer);
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
  // Acceso total si: entró por Bypass (sin doc) o tiene un rol llamado ADMIN.
  const accesoTotal = !usuarioActualDB || (usuarioActualDB.roles || []).some((r: string) => String(r).toUpperCase() === 'ADMIN');

  const clavesPermitidas = useMemo(() => {
    if (accesoTotal) return new Set<string>(ORDEN_CLAVES);
    const rolesUsuario: string[] = usuarioActualDB?.roles || [];
    const etiquetas = new Set<string>();
    rolesCatalogo.forEach((rol: any) => {
      if (rolesUsuario.includes(rol.nombre)) {
        (rol.modulosPermitidos || []).forEach((m: string) => etiquetas.add(m));
      }
    });
    const claves = new Set<string>();
    etiquetas.forEach((et) => { const k = MODULOS_A_CLAVE[et]; if (k) claves.add(k); });
    return claves;
  }, [accesoTotal, usuarioActualDB, rolesCatalogo]);

  const puede = (clave: string) => clavesPermitidas.has(clave);

  // Si el módulo activo no está permitido, saltar al primer módulo permitido.
  useEffect(() => {
    if (accesoTotal) return;
    if (clavesPermitidas.size === 0) return;
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
  const esConfiguracionActivo = moduloActivo === 'roles' || moduloActivo === 'usuarios' || moduloActivo === 'logs' || moduloActivo === 'flujosOperacion' || moduloActivo === 'datosEmpresa';
  const esGastosActivo = moduloActivo === 'mtto' || moduloActivo === 'referenciasDiesel' || moduloActivo === 'referenciasPuentes' || moduloActivo === 'costosAdicionales';

  // Visibilidad de cada grupo: se muestra si al menos un hijo está permitido.
  const verGastos = puede('mtto') || puede('referenciasDiesel') || puede('referenciasPuentes') || puede('costosAdicionales');
  const verClientes = puede('conveniosClientes') || puede('facturacionClientes');
  const verProveedores = puede('conveniosProveedores') || puede('facturacionProveedores');
  const verEmpleados = puede('colaboradores') || puede('historialAsistencia') || puede('referenciasNomina') || puede('deducciones');
  const verBasesDatos = puede('empresas') || puede('contactos') || puede('direcciones') || puede('tipoCambio') || puede('combustible') || puede('unidades') || puede('remolques') || puede('proveedoresUnidad') || puede('unidadesProveedor');
  const verConfiguracion = puede('usuarios') || puede('roles') || puede('logs') || puede('flujosOperacion') || puede('datosEmpresa');

  const sinModulos = !accesoTotal && clavesPermitidas.size === 0;

  // Avatar (foto si existe; si no, iniciales)
  const inicialesUsuario = usuarioActualDB?.nombre ? usuarioActualDB.nombre.substring(0, 2).toUpperCase() : 'JM';
  const fotoUsuario = usuarioActualDB?.fotoPerfil || '';

  return (
    <div className="app-wrapper">
      
      <RelojChecadorModal isOpen={modalChecadorAbierto} onClose={() => setModalChecadorAbierto(false)} usuario={usuarioActualDB} />

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
              <span className="sidebar-icon">{ICON.gastos}</span>
              <span className="sidebar-label">Gastos</span>
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
            {moduloActivo === 'operaciones' && puede('operaciones') && <OperacionesDashboard />}
            {moduloActivo === 'serviciosCompletados' && puede('serviciosCompletados') && <ServiciosCompletados />}
            {moduloActivo === 'serviciosCancelados' && puede('serviciosCancelados') && <ServiciosCancelados />}
            {moduloActivo === 'reportes' && puede('reportes') && <ReportesDashboard />}
            {moduloActivo === 'mtto' && puede('mtto') && <MttoDashboard />} 
            {moduloActivo === 'referenciasDiesel' && puede('referenciasDiesel') && <ReferenciasDieselDashboard />} 
            {moduloActivo === 'referenciasPuentes' && puede('referenciasPuentes') && <ReferenciasPuentesDashboard />} 
            {moduloActivo === 'costosAdicionales' && puede('costosAdicionales') && <CostosAdicionalesDashboard />} 
            {moduloActivo === 'referenciasNomina' && puede('referenciasNomina') && <ReferenciasNominaDashboard />} 
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