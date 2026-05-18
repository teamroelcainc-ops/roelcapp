// src/features/configuracion/components/LogsDashboard.tsx
import { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../../../config/firebase';

interface LogRecord {
  id: string;
  usuario: string;
  modulo: string;
  accion: string;
  detalle: string; 
  fecha: string;
}

export const LogsDashboard = () => {
  const [logs, setLogs] = useState<LogRecord[]>([]);
  
  // Estados para los filtros
  const [filtroUsuario, setFiltroUsuario] = useState('');
  const [filtroModulo, setFiltroModulo] = useState('');
  const [filtroFecha, setFiltroFecha] = useState(''); // Formato YYYY-MM-DD

  useEffect(() => {
    // Traemos los logs ordenados por fecha, del más reciente al más antiguo. 
    // Agregamos un límite de seguridad (ej. 500) para no consumir lecturas infinitas de Firebase
    const q = query(collection(db, 'historial_actividad'), orderBy('fecha', 'desc'), limit(500));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as LogRecord));
      setLogs(data);
    });
    return () => unsubscribe();
  }, []);

  // Verificar si hay al menos un filtro activo
  const hayFiltrosActivos = filtroUsuario !== '' || filtroModulo !== '' || filtroFecha !== '';

  // Lógica de Filtrado Múltiple
  const logsFiltrados = useMemo(() => {
    // Si no hay filtros activos, no mostramos NINGÚN registro
    if (!hayFiltrosActivos) return [];

    return logs.filter(log => {
      const coincideUsuario = filtroUsuario ? log.usuario.toLowerCase().includes(filtroUsuario.toLowerCase()) : true;
      const coincideModulo = filtroModulo ? log.modulo.toLowerCase().includes(filtroModulo.toLowerCase()) : true;
      const coincideFecha = filtroFecha ? log.fecha.startsWith(filtroFecha) : true;
      
      return coincideUsuario && coincideModulo && coincideFecha;
    });
  }, [logs, filtroUsuario, filtroModulo, filtroFecha, hayFiltrosActivos]);

  // Formatear la fecha estrictamente en español
  const formatearFechaHora = (fechaIso: string) => {
    if (!fechaIso) return '-';
    const fecha = new Date(fechaIso);
    return fecha.toLocaleString('es-ES', { 
      day: '2-digit', 
      month: 'short', 
      year: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit'
    });
  };

  // Extraer lista de módulos únicos para el selector (basado en los logs recientes)
  const modulosUnicos = Array.from(new Set(logs.map(log => log.modulo))).sort();

  return (
    <div className="module-container" style={{ padding: '24px', animation: 'fadeIn 0.3s ease' }}>
      
      {/* CABECERA */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h2 style={{ fontSize: '1.25rem', color: '#8b949e', margin: 0, fontWeight: '400' }}>
          Configuración {'>'} <span style={{ color: '#f0f6fc', fontWeight: '600' }}>Historial de Actividad {hayFiltrosActivos ? `(${logsFiltrados.length})` : ''}</span>
        </h2>
      </div>

      {/* BARRA DE FILTROS */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '24px', backgroundColor: '#161b22', padding: '16px', borderRadius: '8px', border: '1px solid #30363d' }}>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', fontSize: '0.75rem', color: '#8b949e', textTransform: 'uppercase', marginBottom: '8px' }}>Filtrar por Día</label>
          <input 
            type="date" 
            value={filtroFecha}
            onChange={(e) => setFiltroFecha(e.target.value)}
            style={{ width: '100%', padding: '10px', backgroundColor: '#010409', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9' }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', fontSize: '0.75rem', color: '#8b949e', textTransform: 'uppercase', marginBottom: '8px' }}>Filtrar por Usuario</label>
          <input 
            type="text" 
            placeholder="Buscar correo o nombre..."
            value={filtroUsuario}
            onChange={(e) => setFiltroUsuario(e.target.value)}
            style={{ width: '100%', padding: '10px', backgroundColor: '#010409', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9' }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', fontSize: '0.75rem', color: '#8b949e', textTransform: 'uppercase', marginBottom: '8px' }}>Filtrar por Módulo</label>
          <select 
            value={filtroModulo}
            onChange={(e) => setFiltroModulo(e.target.value)}
            style={{ width: '100%', padding: '10px', backgroundColor: '#010409', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9' }}
          >
            <option value="">Todos los módulos</option>
            {modulosUnicos.map(mod => (
              <option key={mod} value={mod}>{mod}</option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <button 
            onClick={() => { setFiltroFecha(''); setFiltroUsuario(''); setFiltroModulo(''); }}
            style={{ padding: '10px 16px', backgroundColor: '#21262d', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', cursor: 'pointer' }}
          >
            Limpiar
          </button>
        </div>
      </div>

      {/* ÁREA PRINCIPAL (TABLA SOLO LECTURA) */}
      <div 
        className="table-container" 
        style={{ 
          border: '1px solid #30363d', 
          borderRadius: '8px', 
          overflowX: 'auto', 
          overflowY: 'auto', 
          maxHeight: 'calc(100vh - 280px)' 
        }}
      >
        <table className="data-table" style={{ width: '100%', minWidth: '900px', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead style={{ backgroundColor: '#161b22', position: 'sticky', top: 0, zIndex: 10, boxShadow: '0 1px 0 #30363d' }}>
            <tr>
              <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase' }}>Fecha y Hora</th>
              <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase' }}>Usuario</th>
              <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase' }}>Módulo</th>
              <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase' }}>Acción</th>
              <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase' }}>Detalle</th>
            </tr>
          </thead>
          <tbody>
            {!hayFiltrosActivos ? (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: '60px', color: '#8b949e' }}>
                  <div style={{ fontSize: '1.1rem', marginBottom: '8px' }}>🔍</div>
                  Por favor, aplica al menos un filtro en la parte superior para visualizar el historial.
                </td>
              </tr>
            ) : logsFiltrados.length === 0 ? (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>No hay registros que coincidan con los filtros aplicados.</td></tr>
            ) : (
              logsFiltrados.map(log => (
                <tr key={log.id} style={{ borderBottom: '1px solid #21262d' }}>
                  <td style={{ padding: '16px', color: '#8b949e', fontSize: '0.9rem', whiteSpace: 'nowrap' }}>
                    {formatearFechaHora(log.fecha)}
                  </td>
                  <td style={{ padding: '16px', color: '#f0f6fc', fontSize: '0.9rem', fontWeight: '500' }}>
                    {log.usuario}
                  </td>
                  <td style={{ padding: '16px' }}>
                    <span style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)', color: '#58a6ff', padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
                      {log.modulo}
                    </span>
                  </td>
                  <td style={{ padding: '16px' }}>
                    <span style={{ 
                      backgroundColor: log.accion === 'Eliminación' ? 'rgba(239, 68, 68, 0.1)' : log.accion === 'Edición' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(16, 185, 129, 0.1)', 
                      color: log.accion === 'Eliminación' ? '#ef4444' : log.accion === 'Edición' ? '#f59e0b' : '#10b981', 
                      padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem', border: '1px solid transparent' 
                    }}>
                      {log.accion}
                    </span>
                  </td>
                  <td style={{ padding: '16px', color: '#c9d1d9', fontSize: '0.9rem', lineHeight: '1.4' }}>
                    {log.detalle}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};