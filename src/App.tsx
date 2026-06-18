import { useState, useEffect } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, updateDoc, getDoc } from 'firebase/firestore'; 
import { auth, db } from './config/firebase'; 
import { registrarLog } from './utils/logger'; 

import { Login } from './features/auth/components/Login';
import OperacionesDashboard from './features/operaciones/components/OperacionesDashboard';
import ServiciosCompletados from './features/operaciones/components/ServiciosCompletados';
import ServiciosCancelados from './features/operaciones/components/ServiciosCancelados';
import ReportesDashboard from './features/reportes/components/ReportesDashboard';
import EmpresasDashboard from './features/empresas/components/EmpresasDashboard';
import { ContactosDashboard } from './features/contactos/components/ContactosDashboard';
import { TipoCambioDashboard } from './features/tipoCambio/components/TipoCambioDashboard';
import CatalogosDashboard from './features/catalogos/components/CatalogosDashboard';
import { CombustibleDashboard } from './features/combustible/components/CombustibleDashboard';
import ProveedoresUnidadDashboard from './features/proveedoresUnidad/components/ProveedoresUnidadDashboard';
import { UnidadesProveedorDashboard } from './features/unidadesProveedor/components/UnidadesProveedorDashboard';
import UnidadesDashboard from './features/unidades/components/UnidadesDashboard'; 
import RemolquesDashboard from './features/remolques/components/RemolquesDashboard'; 
import ConveniosClientesDashboard from './features/conveniosClientes/components/ConveniosClientesDashboard';
import { ConveniosProveedoresDashboard } from './features/conveniosProveedores/components/ConveniosProveedoresDashboard';
import { DireccionesDashboard } from './features/direcciones/components/DireccionesDashboard';
import { EmpleadosDashboard } from './features/empleados/components/EmpleadosDashboard';
import { RolesDashboard } from './usuarios/components/RolesDashboard';
import { UsuariosDashboard } from './usuarios/components/UsuariosDashboard';
import { LogsDashboard } from './features/configuracion/components/LogsDashboard';
import { ConfiguradorStatus } from './features/configuracion/components/ConfiguradorStatus';
import { RelojChecadorModal } from './features/relojChecador/components/RelojChecadorModal';
import { HistorialChequeosDashboard } from './features/relojChecador/components/HistorialChequeosDashboard';
import MttoDashboard from './features/gastos/components/mtto/MttoDashboard';
import { ReferenciasDieselDashboard } from './features/diesel/components/ReferenciasDieselDashboard';
import { ReferenciasPuentesDashboard } from './features/puentes/components/ReferenciasPuentesDashboard';
import { ReferenciasNominaDashboard } from './features/nominas/components/ReferenciasNominaDashboard';
import { DeduccionesDashboard } from './features/empleados/components/DeduccionesDashboard';
import { FacturacionClientesDashboard } from './features/facturacion/components/FacturacionClientesDashboard';
import { FacturacionProveedoresDashboard } from './features/facturacion/components/FacturacionProveedoresDashboard';
import { CostosAdicionalesDashboard } from './features/costosAdicionales/CostosAdicionalesDashboard';
import ConfiguracionEmpresa from './features/configuracion/ConfiguracionEmpresa';
import { EmpresaBrand } from './features/configuracion/EmpresaBrand';

import './App.css';

// ============================================================================
// Iconos del menú lateral (estilo lucide/feather: trazo, currentColor)
// Se reutilizan referencias para iconos repetidos (truck, droplet, etc.).
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
  // Items principales
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

  // Grupos
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

  // Subitems Gastos
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

  // Subitems Clientes / Proveedores
  conveniosClientes: iFileText,
  facturacionClientes: iCard,
  conveniosProveedores: iFileText,
  facturacionProveedores: iCard,

  // Subitems Empleados
  colaboradores: iUsers,
  historialAsistencia: (
    <Ico><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></Ico>
  ),
  referenciasNomina: iDollar,
  deducciones: (
    <Ico><circle cx="12" cy="12" r="10" /><line x1="8" y1="12" x2="16" y2="12" /></Ico>
  ),

  // Subitems Bases de Datos
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

  // Subitems Configuración
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

function App() {
  const [estaAutenticado, setEstaAutenticado] = useState(false);
  const [cargandoAuth, setCargandoAuth] = useState(true); 
  const [usuarioActualDB, setUsuarioActualDB] = useState<any>(null); 
  
  const [moduloActivo, setModuloActivo] = useState<'operaciones' | 'serviciosCompletados' | 'serviciosCancelados' | 'empresas' | 'contactos' | 'tipoCambio' | 'catalogos' | 'combustible' | 'proveedoresUnidad' | 'unidadesProveedor' | 'unidades' | 'remolques' | 'conveniosClientes' | 'conveniosProveedores' | 'direcciones' | 'colaboradores' | 'historialAsistencia' | 'roles' | 'usuarios' | 'logs' | 'flujosOperacion' | 'mtto' | 'facturacionClientes' | 'facturacionProveedores' | 'referenciasDiesel' | 'referenciasPuentes' | 'referenciasNomina' | 'deducciones' | 'reportes' | 'costosAdicionales' | 'datosEmpresa'>('operaciones');
  
  const [perfilAbierto, setPerfilAbierto] = useState(false);
  const [menuAbierto, setMenuAbierto] = useState(true);
  
  const [menuBasesDatosAbierto, setMenuBasesDatosAbierto] = useState(false);
  const [menuClientesAbierto, setMenuClientesAbierto] = useState(false);
  const [menuProveedoresAbierto, setMenuProveedoresAbierto] = useState(false);
  const [menuEmpleadosAbierto, setMenuEmpleadosAbierto] = useState(false);
  const [menuConfiguracionAbierto, setMenuConfiguracionAbierto] = useState(false);
  const [menuGastosAbierto, setMenuGastosAbierto] = useState(false);

  const [modalChecadorAbierto, setModalChecadorAbierto] = useState(false);

  // ✅ NUEVO: si el menú está colapsado y se hace clic en un grupo, lo abrimos
  // primero para que el submenú quede visible (mejor UX en modo iconos).
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

  return (
    <div className="app-wrapper">
      
      <RelojChecadorModal isOpen={modalChecadorAbierto} onClose={() => setModalChecadorAbierto(false)} usuario={usuarioActualDB} />

      <div className={`sidebar ${!menuAbierto ? 'collapsed' : ''}`}>
        <div className="sidebar-brand">
          <EmpresaBrand />
        </div>

        <div className={`sidebar-item ${moduloActivo === 'operaciones' ? 'active' : ''}`} title="Operaciones Activas" onClick={() => setModuloActivo('operaciones')}>
          <span className="sidebar-icon">{ICON.operaciones}</span>
          <span className="sidebar-label">Operaciones Activas</span>
        </div>
        
        <div className={`sidebar-item ${moduloActivo === 'serviciosCompletados' ? 'active' : ''}`} title="Servicios Completados" onClick={() => setModuloActivo('serviciosCompletados')}>
          <span className="sidebar-icon">{ICON.serviciosCompletados}</span>
          <span className="sidebar-label">Servicios Completados</span>
        </div>

        <div className={`sidebar-item ${moduloActivo === 'serviciosCancelados' ? 'active' : ''}`} title="Servicios Cancelados" onClick={() => setModuloActivo('serviciosCancelados')}>
          <span className="sidebar-icon">{ICON.serviciosCancelados}</span>
          <span className="sidebar-label">Servicios Cancelados</span>
        </div>

        <div className={`sidebar-item ${moduloActivo === 'reportes' ? 'active' : ''}`} title="Reportes" onClick={() => setModuloActivo('reportes')}>
          <span className="sidebar-icon">{ICON.reportes}</span>
          <span className="sidebar-label">Reportes</span>
        </div>

        <div className={`sidebar-item sidebar-item-with-icon ${esGastosActivo && !menuGastosAbierto ? 'active' : ''}`} title="Gastos" onClick={() => toggleGrupo(setMenuGastosAbierto)}>
          <span className="sidebar-icon">{ICON.gastos}</span>
          <span className="sidebar-label">Gastos</span>
          <span className="sidebar-chevron" style={{ fontSize: '0.7rem' }}>{menuGastosAbierto ? '▼' : '▶'}</span>
        </div>
        {menuGastosAbierto && (
          <div className="sidebar-submenu">
            <div className={`sidebar-subitem ${moduloActivo === 'mtto' ? 'active' : ''}`} onClick={() => setModuloActivo('mtto')}><span className="sidebar-icon">{ICON.mtto}</span><span className="sidebar-label">MTTO</span></div>
            <div className={`sidebar-subitem ${moduloActivo === 'referenciasDiesel' ? 'active' : ''}`} onClick={() => setModuloActivo('referenciasDiesel')}><span className="sidebar-icon">{ICON.referenciasDiesel}</span><span className="sidebar-label">Referencias del Diesel</span></div>
            <div className={`sidebar-subitem ${moduloActivo === 'referenciasPuentes' ? 'active' : ''}`} onClick={() => setModuloActivo('referenciasPuentes')}><span className="sidebar-icon">{ICON.referenciasPuentes}</span><span className="sidebar-label">Referencias de Puentes</span></div>
            <div className={`sidebar-subitem ${moduloActivo === 'costosAdicionales' ? 'active' : ''}`} onClick={() => setModuloActivo('costosAdicionales')}><span className="sidebar-icon">{ICON.costosAdicionales}</span><span className="sidebar-label">Costos Adicionales</span></div>
          </div>
        )}

        <div className={`sidebar-item sidebar-item-with-icon ${esClientesActivo && !menuClientesAbierto ? 'active' : ''}`} title="Clientes" onClick={() => toggleGrupo(setMenuClientesAbierto)}>
          <span className="sidebar-icon">{ICON.clientes}</span>
          <span className="sidebar-label">Clientes</span>
          <span className="sidebar-chevron" style={{ fontSize: '0.7rem' }}>{menuClientesAbierto ? '▼' : '▶'}</span>
        </div>
        {menuClientesAbierto && (
          <div className="sidebar-submenu">
            <div className={`sidebar-subitem ${moduloActivo === 'conveniosClientes' ? 'active' : ''}`} onClick={() => setModuloActivo('conveniosClientes')}><span className="sidebar-icon">{ICON.conveniosClientes}</span><span className="sidebar-label">Convenio de Clientes</span></div>
            <div className={`sidebar-subitem ${moduloActivo === 'facturacionClientes' ? 'active' : ''}`} onClick={() => setModuloActivo('facturacionClientes')}><span className="sidebar-icon">{ICON.facturacionClientes}</span><span className="sidebar-label">Facturación</span></div>
          </div>
        )}

        <div className={`sidebar-item sidebar-item-with-icon ${esProveedoresActivo && !menuProveedoresAbierto ? 'active' : ''}`} title="Proveedores" onClick={() => toggleGrupo(setMenuProveedoresAbierto)}>
          <span className="sidebar-icon">{ICON.proveedores}</span>
          <span className="sidebar-label">Proveedores</span>
          <span className="sidebar-chevron" style={{ fontSize: '0.7rem' }}>{menuProveedoresAbierto ? '▼' : '▶'}</span>
        </div>
        {menuProveedoresAbierto && (
          <div className="sidebar-submenu">
            <div className={`sidebar-subitem ${moduloActivo === 'conveniosProveedores' ? 'active' : ''}`} onClick={() => setModuloActivo('conveniosProveedores')}><span className="sidebar-icon">{ICON.conveniosProveedores}</span><span className="sidebar-label">Convenio de Proveedores</span></div>
            <div className={`sidebar-subitem ${moduloActivo === 'facturacionProveedores' ? 'active' : ''}`} onClick={() => setModuloActivo('facturacionProveedores')}><span className="sidebar-icon">{ICON.facturacionProveedores}</span><span className="sidebar-label">Facturación</span></div>
          </div>
        )}

        <div className={`sidebar-item sidebar-item-with-icon ${esEmpleadosActivo && !menuEmpleadosAbierto ? 'active' : ''}`} title="Empleados" onClick={() => toggleGrupo(setMenuEmpleadosAbierto)}>
          <span className="sidebar-icon">{ICON.empleados}</span>
          <span className="sidebar-label">Empleados</span>
          <span className="sidebar-chevron" style={{ fontSize: '0.7rem' }}>{menuEmpleadosAbierto ? '▼' : '▶'}</span>
        </div>
        {menuEmpleadosAbierto && (
          <div className="sidebar-submenu">
            <div className={`sidebar-subitem ${moduloActivo === 'colaboradores' ? 'active' : ''}`} onClick={() => setModuloActivo('colaboradores')}><span className="sidebar-icon">{ICON.colaboradores}</span><span className="sidebar-label">Colaboradores</span></div>
            <div className={`sidebar-subitem ${moduloActivo === 'historialAsistencia' ? 'active' : ''}`} onClick={() => setModuloActivo('historialAsistencia')}><span className="sidebar-icon">{ICON.historialAsistencia}</span><span className="sidebar-label">Historial de Chequeo</span></div>
            <div className={`sidebar-subitem ${moduloActivo === 'referenciasNomina' ? 'active' : ''}`} onClick={() => setModuloActivo('referenciasNomina')}><span className="sidebar-icon">{ICON.referenciasNomina}</span><span className="sidebar-label">Nómina</span></div>
            <div className={`sidebar-subitem ${moduloActivo === 'deducciones' ? 'active' : ''}`} onClick={() => setModuloActivo('deducciones')}><span className="sidebar-icon">{ICON.deducciones}</span><span className="sidebar-label">Deducciones</span></div>
          </div>
        )}

        <div className={`sidebar-item sidebar-item-with-icon ${esBaseDeDatosActiva && !menuBasesDatosAbierto ? 'active' : ''}`} title="Bases de Datos" onClick={() => toggleGrupo(setMenuBasesDatosAbierto)}>
          <span className="sidebar-icon">{ICON.basesDatos}</span>
          <span className="sidebar-label">Bases de Datos</span>
          <span className="sidebar-chevron" style={{ fontSize: '0.7rem' }}>{menuBasesDatosAbierto ? '▼' : '▶'}</span>
        </div>
        {menuBasesDatosAbierto && (
          <div className="sidebar-submenu">
            <div className={`sidebar-subitem ${moduloActivo === 'empresas' ? 'active' : ''}`} onClick={() => setModuloActivo('empresas')}><span className="sidebar-icon">{ICON.empresas}</span><span className="sidebar-label">Empresas</span></div>
            <div className={`sidebar-subitem ${moduloActivo === 'contactos' ? 'active' : ''}`} onClick={() => setModuloActivo('contactos')}><span className="sidebar-icon">{ICON.contactos}</span><span className="sidebar-label">Contactos</span></div>
            <div className={`sidebar-subitem ${moduloActivo === 'direcciones' ? 'active' : ''}`} onClick={() => setModuloActivo('direcciones')}><span className="sidebar-icon">{ICON.direcciones}</span><span className="sidebar-label">Direcciones</span></div>
            <div className={`sidebar-subitem ${moduloActivo === 'tipoCambio' ? 'active' : ''}`} onClick={() => setModuloActivo('tipoCambio')}><span className="sidebar-icon">{ICON.tipoCambio}</span><span className="sidebar-label">Tipo de Cambio</span></div>
            <div className={`sidebar-subitem ${moduloActivo === 'combustible' ? 'active' : ''}`} onClick={() => setModuloActivo('combustible')}><span className="sidebar-icon">{ICON.combustible}</span><span className="sidebar-label">Combustible</span></div>
            <div className={`sidebar-subitem ${moduloActivo === 'unidades' ? 'active' : ''}`} onClick={() => setModuloActivo('unidades')}><span className="sidebar-icon">{ICON.unidades}</span><span className="sidebar-label">Unidades Propias</span></div> 
            <div className={`sidebar-subitem ${moduloActivo === 'remolques' ? 'active' : ''}`} onClick={() => setModuloActivo('remolques')}><span className="sidebar-icon">{ICON.remolques}</span><span className="sidebar-label">Remolques</span></div> 
            <div className={`sidebar-subitem ${moduloActivo === 'proveedoresUnidad' ? 'active' : ''}`} onClick={() => setModuloActivo('proveedoresUnidad')}><span className="sidebar-icon">{ICON.proveedoresUnidad}</span><span className="sidebar-label">Proveedores de Unidad</span></div>
            <div className={`sidebar-subitem ${moduloActivo === 'unidadesProveedor' ? 'active' : ''}`} onClick={() => setModuloActivo('unidadesProveedor')}><span className="sidebar-icon">{ICON.unidadesProveedor}</span><span className="sidebar-label">Unidades del Proveedor</span></div>
          </div>
        )}

        <div className={`sidebar-item ${moduloActivo === 'catalogos' ? 'active' : ''}`} title="Catálogos" onClick={() => setModuloActivo('catalogos')}>
          <span className="sidebar-icon">{ICON.catalogos}</span>
          <span className="sidebar-label">Catálogos</span>
        </div>

        <div className={`sidebar-item sidebar-item-with-icon ${esConfiguracionActivo && !menuConfiguracionAbierto ? 'active' : ''}`} title="Configuración" onClick={() => toggleGrupo(setMenuConfiguracionAbierto)}>
          <span className="sidebar-icon">{ICON.configuracion}</span>
          <span className="sidebar-label">Configuración</span>
          <span className="sidebar-chevron" style={{ fontSize: '0.7rem' }}>{menuConfiguracionAbierto ? '▼' : '▶'}</span>
        </div>
        {menuConfiguracionAbierto && (
          <div className="sidebar-submenu">
            <div className={`sidebar-subitem ${moduloActivo === 'usuarios' ? 'active' : ''}`} onClick={() => setModuloActivo('usuarios')}><span className="sidebar-icon">{ICON.usuarios}</span><span className="sidebar-label">Usuarios</span></div>
            <div className={`sidebar-subitem ${moduloActivo === 'roles' ? 'active' : ''}`} onClick={() => setModuloActivo('roles')}><span className="sidebar-icon">{ICON.roles}</span><span className="sidebar-label">Roles y Permisos</span></div>
            <div className={`sidebar-subitem ${moduloActivo === 'logs' ? 'active' : ''}`} onClick={() => setModuloActivo('logs')}><span className="sidebar-icon">{ICON.logs}</span><span className="sidebar-label">Historial de Actividad</span></div>
            <div className={`sidebar-subitem ${moduloActivo === 'flujosOperacion' ? 'active' : ''}`} onClick={() => setModuloActivo('flujosOperacion')}><span className="sidebar-icon">{ICON.flujosOperacion}</span><span className="sidebar-label">Reglas de Estatus</span></div>
            <div className={`sidebar-subitem ${moduloActivo === 'datosEmpresa' ? 'active' : ''}`} onClick={() => setModuloActivo('datosEmpresa')}><span className="sidebar-icon">{ICON.datosEmpresa}</span><span className="sidebar-label">Datos de la Empresa</span></div>
          </div>
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
            
            <div className="avatar" style={{ cursor: 'pointer', backgroundColor: '#D84315', color: 'white', border: 'none' }} onClick={() => setPerfilAbierto(!perfilAbierto)}>
              {usuarioActualDB?.nombre ? usuarioActualDB.nombre.substring(0,2).toUpperCase() : 'JM'}
            </div>

            {perfilAbierto && (
              <div className="profile-dropdown">
                <div className="profile-header-info">
                  <div className="profile-avatar-large" style={{ backgroundColor: '#D84315', color: 'white' }}>
                    {usuarioActualDB?.nombre ? usuarioActualDB.nombre.substring(0,2).toUpperCase() : 'JM'}
                  </div>
                  <div className="profile-text">
                    <span className="profile-name">{usuarioActualDB?.nombre || 'Usuario'}</span>
                    <span className="profile-role">{usuarioActualDB?.rol || 'Rol'}</span>
                  </div>
                </div>
                <div className="profile-actions">
                  <button className="btn-profile">Actualizar Foto de Perfil</button>
                  <button className="btn-profile">Configuración</button>
                  <button className="btn-profile logout" onClick={() => handleCerrarSesion('manual')}>Cerrar Sesión</button>
                </div>
              </div>
            )}
          </div>
        </div>

        {moduloActivo === 'operaciones' && <OperacionesDashboard />}
        {moduloActivo === 'serviciosCompletados' && <ServiciosCompletados />}
        {moduloActivo === 'serviciosCancelados' && <ServiciosCancelados />}
        {moduloActivo === 'reportes' && <ReportesDashboard />}
        {moduloActivo === 'mtto' && <MttoDashboard />} 
        {moduloActivo === 'referenciasDiesel' && <ReferenciasDieselDashboard />} 
        {moduloActivo === 'referenciasPuentes' && <ReferenciasPuentesDashboard />} 
        {moduloActivo === 'costosAdicionales' && <CostosAdicionalesDashboard />} 
        {moduloActivo === 'referenciasNomina' && <ReferenciasNominaDashboard />} 
        {moduloActivo === 'deducciones' && <DeduccionesDashboard />} 
        {moduloActivo === 'empresas' && <EmpresasDashboard />}
        {moduloActivo === 'contactos' && <ContactosDashboard />}
        {moduloActivo === 'direcciones' && <DireccionesDashboard />}
        {moduloActivo === 'tipoCambio' && <TipoCambioDashboard />}
        {moduloActivo === 'combustible' && <CombustibleDashboard />}
        {moduloActivo === 'unidades' && <UnidadesDashboard />} 
        {moduloActivo === 'remolques' && <RemolquesDashboard />} 
        {moduloActivo === 'proveedoresUnidad' && <ProveedoresUnidadDashboard />}
        {moduloActivo === 'unidadesProveedor' && <UnidadesProveedorDashboard />}
        {moduloActivo === 'conveniosClientes' && <ConveniosClientesDashboard />}
        {moduloActivo === 'conveniosProveedores' && <ConveniosProveedoresDashboard />}
        {moduloActivo === 'catalogos' && <CatalogosDashboard />}
        {moduloActivo === 'colaboradores' && <EmpleadosDashboard />}
        {moduloActivo === 'historialAsistencia' && <HistorialChequeosDashboard usuarioActual={usuarioActualDB} />}
        {moduloActivo === 'roles' && <RolesDashboard />}
        {moduloActivo === 'usuarios' && <UsuariosDashboard />}
        {moduloActivo === 'logs' && <LogsDashboard />}
        {moduloActivo === 'flujosOperacion' && <ConfiguradorStatus />}
        {moduloActivo === 'datosEmpresa' && <ConfiguracionEmpresa />}
        {moduloActivo === 'facturacionClientes' && <FacturacionClientesDashboard />}
        {moduloActivo === 'facturacionProveedores' && <FacturacionProveedoresDashboard />}
        
      </div>
    </div>
  );
}

export default App;