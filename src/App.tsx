import { useState, useEffect } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, updateDoc, getDoc } from 'firebase/firestore'; 
import { auth, db } from './config/firebase'; 
import { registrarLog } from './utils/logger'; 

import { Login } from './features/auth/components/Login';
import OperacionesDashboard from './features/operaciones/components/OperacionesDashboard';
import ServiciosCompletados from './features/operaciones/components/ServiciosCompletados';
import ServiciosCancelados from './features/operaciones/components/ServiciosCancelados';
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
import { ReferenciasNominaDashboard } from './features/nominas/components/ReferenciasNominaDashboard';
import { DeduccionesDashboard } from './features/empleados/components/DeduccionesDashboard';
import { FacturacionClientesDashboard } from './features/facturacion/components/FacturacionClientesDashboard';

import './App.css';

function App() {
  const [estaAutenticado, setEstaAutenticado] = useState(false);
  const [cargandoAuth, setCargandoAuth] = useState(true); 
  const [usuarioActualDB, setUsuarioActualDB] = useState<any>(null); 
  
  const [moduloActivo, setModuloActivo] = useState<'operaciones' | 'serviciosCompletados' | 'serviciosCancelados' | 'empresas' | 'contactos' | 'tipoCambio' | 'catalogos' | 'combustible' | 'proveedoresUnidad' | 'unidadesProveedor' | 'unidades' | 'remolques' | 'conveniosClientes' | 'conveniosProveedores' | 'direcciones' | 'colaboradores' | 'historialAsistencia' | 'roles' | 'usuarios' | 'logs' | 'flujosOperacion' | 'mtto' | 'facturacionClientes' | 'referenciasDiesel' | 'referenciasNomina' | 'deducciones'>('operaciones');
  
  const [perfilAbierto, setPerfilAbierto] = useState(false);
  const [menuAbierto, setMenuAbierto] = useState(true);
  
  const [menuBasesDatosAbierto, setMenuBasesDatosAbierto] = useState(false);
  const [menuClientesAbierto, setMenuClientesAbierto] = useState(false);
  const [menuProveedoresAbierto, setMenuProveedoresAbierto] = useState(false);
  const [menuEmpleadosAbierto, setMenuEmpleadosAbierto] = useState(false);
  const [menuConfiguracionAbierto, setMenuConfiguracionAbierto] = useState(false);
  const [menuGastosAbierto, setMenuGastosAbierto] = useState(false);

  const [modalChecadorAbierto, setModalChecadorAbierto] = useState(false);

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
  const esProveedoresActivo = moduloActivo === 'conveniosProveedores';
  const esEmpleadosActivo = moduloActivo === 'colaboradores' || moduloActivo === 'historialAsistencia' || moduloActivo === 'referenciasNomina' || moduloActivo === 'deducciones';
  const esConfiguracionActivo = moduloActivo === 'roles' || moduloActivo === 'usuarios' || moduloActivo === 'logs' || moduloActivo === 'flujosOperacion';
  const esGastosActivo = moduloActivo === 'mtto' || moduloActivo === 'referenciasDiesel';

  return (
    <div className="app-wrapper">
      
      <RelojChecadorModal isOpen={modalChecadorAbierto} onClose={() => setModalChecadorAbierto(false)} usuario={usuarioActualDB} />

      <div className={`sidebar ${!menuAbierto ? 'collapsed' : ''}`}>
        <div className="sidebar-brand">
          <span style={{ color: '#D84315', marginRight: '8px' }}>■</span> Roelca Inc.
        </div>

        <div className={`sidebar-item ${moduloActivo === 'operaciones' ? 'active' : ''}`} onClick={() => setModuloActivo('operaciones')}>
          Operaciones Activas
        </div>
        
        <div className={`sidebar-item ${moduloActivo === 'serviciosCompletados' ? 'active' : ''}`} onClick={() => setModuloActivo('serviciosCompletados')}>
          Servicios Completados
        </div>

        <div className={`sidebar-item ${moduloActivo === 'serviciosCancelados' ? 'active' : ''}`} onClick={() => setModuloActivo('serviciosCancelados')}>
          Servicios Cancelados
        </div>

        <div className={`sidebar-item sidebar-item-with-icon ${esGastosActivo && !menuGastosAbierto ? 'active' : ''}`} onClick={() => setMenuGastosAbierto(!menuGastosAbierto)}>
          <span>Gastos</span>
          <span style={{ fontSize: '0.7rem' }}>{menuGastosAbierto ? '▼' : '▶'}</span>
        </div>
        {menuGastosAbierto && (
          <div className="sidebar-submenu">
            <div className={`sidebar-subitem ${moduloActivo === 'mtto' ? 'active' : ''}`} onClick={() => setModuloActivo('mtto')}>MTTO</div>
            <div className={`sidebar-subitem ${moduloActivo === 'referenciasDiesel' ? 'active' : ''}`} onClick={() => setModuloActivo('referenciasDiesel')}>Referencias del Diesel</div>
          </div>
        )}

        <div className={`sidebar-item sidebar-item-with-icon ${esClientesActivo && !menuClientesAbierto ? 'active' : ''}`} onClick={() => setMenuClientesAbierto(!menuClientesAbierto)}>
          <span>Clientes</span>
          <span style={{ fontSize: '0.7rem' }}>{menuClientesAbierto ? '▼' : '▶'}</span>
        </div>
        {menuClientesAbierto && (
          <div className="sidebar-submenu">
            <div className={`sidebar-subitem ${moduloActivo === 'conveniosClientes' ? 'active' : ''}`} onClick={() => setModuloActivo('conveniosClientes')}>Convenio de Clientes</div>
            <div className={`sidebar-subitem ${moduloActivo === 'facturacionClientes' ? 'active' : ''}`} onClick={() => setModuloActivo('facturacionClientes')}>Facturación</div>
          </div>
        )}

        <div className={`sidebar-item sidebar-item-with-icon ${esProveedoresActivo && !menuProveedoresAbierto ? 'active' : ''}`} onClick={() => setMenuProveedoresAbierto(!menuProveedoresAbierto)}>
          <span>Proveedores</span>
          <span style={{ fontSize: '0.7rem' }}>{menuProveedoresAbierto ? '▼' : '▶'}</span>
        </div>
        {menuProveedoresAbierto && (
          <div className="sidebar-submenu">
            <div className={`sidebar-subitem ${moduloActivo === 'conveniosProveedores' ? 'active' : ''}`} onClick={() => setModuloActivo('conveniosProveedores')}>Convenio de Proveedores</div>
          </div>
        )}

        <div className={`sidebar-item sidebar-item-with-icon ${esEmpleadosActivo && !menuEmpleadosAbierto ? 'active' : ''}`} onClick={() => setMenuEmpleadosAbierto(!menuEmpleadosAbierto)}>
          <span>Empleados</span>
          <span style={{ fontSize: '0.7rem' }}>{menuEmpleadosAbierto ? '▼' : '▶'}</span>
        </div>
        {menuEmpleadosAbierto && (
          <div className="sidebar-submenu">
            <div className={`sidebar-subitem ${moduloActivo === 'colaboradores' ? 'active' : ''}`} onClick={() => setModuloActivo('colaboradores')}>Colaboradores</div>
            <div className={`sidebar-subitem ${moduloActivo === 'historialAsistencia' ? 'active' : ''}`} onClick={() => setModuloActivo('historialAsistencia')}>Historial de Chequeo</div>
            <div className={`sidebar-subitem ${moduloActivo === 'referenciasNomina' ? 'active' : ''}`} onClick={() => setModuloActivo('referenciasNomina')}>Nómina</div>
            <div className={`sidebar-subitem ${moduloActivo === 'deducciones' ? 'active' : ''}`} onClick={() => setModuloActivo('deducciones')}>Deducciones</div>
          </div>
        )}

        <div className={`sidebar-item sidebar-item-with-icon ${esBaseDeDatosActiva && !menuBasesDatosAbierto ? 'active' : ''}`} onClick={() => setMenuBasesDatosAbierto(!menuBasesDatosAbierto)}>
          <span>Bases de Datos</span>
          <span style={{ fontSize: '0.7rem' }}>{menuBasesDatosAbierto ? '▼' : '▶'}</span>
        </div>
        {menuBasesDatosAbierto && (
          <div className="sidebar-submenu">
            <div className={`sidebar-subitem ${moduloActivo === 'empresas' ? 'active' : ''}`} onClick={() => setModuloActivo('empresas')}>Empresas</div>
            <div className={`sidebar-subitem ${moduloActivo === 'contactos' ? 'active' : ''}`} onClick={() => setModuloActivo('contactos')}>Contactos</div>
            <div className={`sidebar-subitem ${moduloActivo === 'direcciones' ? 'active' : ''}`} onClick={() => setModuloActivo('direcciones')}>Direcciones</div>
            <div className={`sidebar-subitem ${moduloActivo === 'tipoCambio' ? 'active' : ''}`} onClick={() => setModuloActivo('tipoCambio')}>Tipo de Cambio</div>
            <div className={`sidebar-subitem ${moduloActivo === 'combustible' ? 'active' : ''}`} onClick={() => setModuloActivo('combustible')}>Combustible</div>
            <div className={`sidebar-subitem ${moduloActivo === 'unidades' ? 'active' : ''}`} onClick={() => setModuloActivo('unidades')}>Unidades Propias</div> 
            <div className={`sidebar-subitem ${moduloActivo === 'remolques' ? 'active' : ''}`} onClick={() => setModuloActivo('remolques')}>Remolques</div> 
            <div className={`sidebar-subitem ${moduloActivo === 'proveedoresUnidad' ? 'active' : ''}`} onClick={() => setModuloActivo('proveedoresUnidad')}>Proveedores de Unidad</div>
            <div className={`sidebar-subitem ${moduloActivo === 'unidadesProveedor' ? 'active' : ''}`} onClick={() => setModuloActivo('unidadesProveedor')}>Unidades del Proveedor</div>
          </div>
        )}

        <div className={`sidebar-item ${moduloActivo === 'catalogos' ? 'active' : ''}`} onClick={() => setModuloActivo('catalogos')}>
          Catálogos
        </div>

        <div className={`sidebar-item sidebar-item-with-icon ${esConfiguracionActivo && !menuConfiguracionAbierto ? 'active' : ''}`} onClick={() => setMenuConfiguracionAbierto(!menuConfiguracionAbierto)}>
          <span>Configuración</span>
          <span style={{ fontSize: '0.7rem' }}>{menuConfiguracionAbierto ? '▼' : '▶'}</span>
        </div>
        {menuConfiguracionAbierto && (
          <div className="sidebar-submenu">
            <div className={`sidebar-subitem ${moduloActivo === 'usuarios' ? 'active' : ''}`} onClick={() => setModuloActivo('usuarios')}>Usuarios</div>
            <div className={`sidebar-subitem ${moduloActivo === 'roles' ? 'active' : ''}`} onClick={() => setModuloActivo('roles')}>Roles y Permisos</div>
            <div className={`sidebar-subitem ${moduloActivo === 'logs' ? 'active' : ''}`} onClick={() => setModuloActivo('logs')}>Historial de Actividad</div>
            <div className={`sidebar-subitem ${moduloActivo === 'flujosOperacion' ? 'active' : ''}`} onClick={() => setModuloActivo('flujosOperacion')}>Reglas de Estatus</div>
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

            <div className="notification-wrapper" title="Notificaciones" style={{ marginRight: '16px' }}>
              <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24" style={{ color: '#8b949e' }}>
                <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2zm-2 1H8v-6c0-2.48 1.51-4.5 4-4.5s4 2.02 4 4.5v6z"/>
              </svg>
              <span className="notification-badge">3</span>
            </div>
            
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
        {moduloActivo === 'mtto' && <MttoDashboard />} 
        {moduloActivo === 'referenciasDiesel' && <ReferenciasDieselDashboard />} 
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
        {moduloActivo === 'facturacionClientes' && <FacturacionClientesDashboard />}
        
      </div>
    </div>
  );
}

export default App;