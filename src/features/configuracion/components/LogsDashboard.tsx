// src/features/configuracion/components/LogsDashboard.tsx
import { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import './LogsDashboard.css';

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
  const [filtroAccion, setFiltroAccion] = useState(''); // ✅ NUEVO: Creación / Edición / Eliminación / Búsqueda / etc.
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
  const hayFiltrosActivos = filtroUsuario !== '' || filtroModulo !== '' || filtroFecha !== '' || filtroAccion !== '';

  // Lógica de Filtrado Múltiple
  const logsFiltrados = useMemo(() => {
    // Si no hay filtros activos, no mostramos NINGÚN registro
    if (!hayFiltrosActivos) return [];

    return logs.filter(log => {
      const coincideUsuario = filtroUsuario ? log.usuario.toLowerCase().includes(filtroUsuario.toLowerCase()) : true;
      const coincideModulo = filtroModulo ? log.modulo.toLowerCase().includes(filtroModulo.toLowerCase()) : true;
      const coincideAccion = filtroAccion ? log.accion === filtroAccion : true;
      const coincideFecha = filtroFecha ? log.fecha.startsWith(filtroFecha) : true;

      return coincideUsuario && coincideModulo && coincideAccion && coincideFecha;
    });
  }, [logs, filtroUsuario, filtroModulo, filtroAccion, filtroFecha, hayFiltrosActivos]);

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
  const accionesUnicas = Array.from(new Set(logs.map(log => log.accion))).sort();

  // ✅ NUEVO: color por tipo de acción (rojo destructivo, ámbar ediciones,
  //   azul búsquedas, verde creaciones/aprobaciones).
  const colorAccion = (accion: string): { bg: string; fg: string } => {
    if (accion === 'Eliminación' || accion === 'Rechazo') return { bg: 'rgba(239, 68, 68, 0.1)', fg: '#ef4444' };
    if (accion === 'Edición' || accion === 'Configuración') return { bg: 'rgba(245, 158, 11, 0.1)', fg: '#f59e0b' };
    if (accion === 'Búsqueda') return { bg: 'rgba(59, 130, 246, 0.1)', fg: '#58a6ff' };
    return { bg: 'rgba(16, 185, 129, 0.1)', fg: '#10b981' };
  };

  return (
    <div className="module-container ld-x1">
      
      {/* CABECERA */}
      <div className="ld-x2">
        <h2 className="ld-x3">
          Configuración {'>'} <span className="ld-x4">Historial de Actividad {hayFiltrosActivos ? `(${logsFiltrados.length})` : ''}</span>
        </h2>
      </div>

      {/* BARRA DE FILTROS */}
      <div className="ld-x5">
        <div className="ld-x6">
          <label className="ld-x7">Filtrar por Día</label>
          <input className="ld-x8" 
            type="date" 
            value={filtroFecha}
            onChange={(e) => setFiltroFecha(e.target.value)}
          />
        </div>
        <div className="ld-x6">
          <label className="ld-x7">Filtrar por Usuario</label>
          <input className="ld-x8" 
            type="text" 
            placeholder="Buscar correo o nombre..."
            value={filtroUsuario}
            onChange={(e) => setFiltroUsuario(e.target.value)}
          />
        </div>
        <div className="ld-x6">
          <label className="ld-x7">Filtrar por Módulo</label>
          <select className="ld-x8" 
            value={filtroModulo}
            onChange={(e) => setFiltroModulo(e.target.value)}
          >
            <option value="">Todos los módulos</option>
            {modulosUnicos.map(mod => (
              <option key={mod} value={mod}>{mod}</option>
            ))}
          </select>
        </div>
        <div className="ld-x6">
          <label className="ld-x7">Filtrar por Acción</label>
          <select className="ld-x8"
            value={filtroAccion}
            onChange={(e) => setFiltroAccion(e.target.value)}
          >
            <option value="">Todas las acciones</option>
            {accionesUnicas.map(a => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
        <div className="ld-x9">
          <button className="ld-x10" 
            onClick={() => { setFiltroFecha(''); setFiltroUsuario(''); setFiltroModulo(''); setFiltroAccion(''); }}
          >
            Limpiar
          </button>
        </div>
      </div>

      {/* ÁREA PRINCIPAL (TABLA SOLO LECTURA) */}
      <div 
        className="table-container ld-x11"
      >
        <table className="data-table ld-x12">
          <thead className="ld-x13">
            <tr>
              <th className="ld-x14">Fecha y Hora</th>
              <th className="ld-x14">Usuario</th>
              <th className="ld-x14">Módulo</th>
              <th className="ld-x14">Acción</th>
              <th className="ld-x14">Detalle</th>
            </tr>
          </thead>
          <tbody>
            {!hayFiltrosActivos ? (
              <tr>
                <td className="ld-x15" colSpan={5}>
                  <div className="ld-x16"></div>
                  Por favor, aplica al menos un filtro en la parte superior para visualizar el historial.
                </td>
              </tr>
            ) : logsFiltrados.length === 0 ? (
              <tr><td className="ld-x17" colSpan={5}>No hay registros que coincidan con los filtros aplicados.</td></tr>
            ) : (
              logsFiltrados.map(log => (
                <tr className="ld-x18" key={log.id}>
                  <td className="ld-x19">
                    {formatearFechaHora(log.fecha)}
                  </td>
                  <td className="ld-x20">
                    {log.usuario}
                  </td>
                  <td className="ld-x21">
                    <span className="ld-x22">
                      {log.modulo}
                    </span>
                  </td>
                  <td className="ld-x21">
                    <span style={{
                      backgroundColor: colorAccion(log.accion).bg,
                      color: colorAccion(log.accion).fg,
                      padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem', border: '1px solid transparent', whiteSpace: 'nowrap'
                    }}>
                      {log.accion}
                    </span>
                  </td>
                  <td className="ld-x23">
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