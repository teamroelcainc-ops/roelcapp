// src/features/relojChecador/components/HistorialChequeosDashboard.tsx
import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import * as XLSX from 'xlsx';

interface Props {
  usuarioActual: any;
}

export const HistorialChequeosDashboard: React.FC<Props> = ({ usuarioActual }) => {
  const [registros, setRegistros] = useState<any[]>([]);
  const [busqueda, setBusqueda] = useState('');

  // Identificar si el usuario tiene privilegios totales
  const rolesFullAccess = ['Admin', 'Gerencia', 'Sistemas'];
  const tieneFullAccess = usuarioActual && rolesFullAccess.includes(usuarioActual.rol);

  useEffect(() => {
    if (!usuarioActual) return;

    // Traemos todos los registros ordenados por tiempo (el más reciente primero)
    const q = query(collection(db, 'reloj_checador'), orderBy('timestamp', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      let data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // Si NO es admin/gerencia/sistemas, filtramos para que solo vea los suyos en memoria
      if (!tieneFullAccess) {
        data = data.filter((d: any) => d.userId === usuarioActual.id);
      }

      setRegistros(data);
    });

    return () => unsubscribe();
  }, [usuarioActual, tieneFullAccess]);

  const registrosFiltrados = registros.filter(reg => {
    if (!busqueda.trim()) return true;
    const term = busqueda.toLowerCase();
    return (
      (reg.userName || '').toLowerCase().includes(term) ||
      (reg.tipoRegistro || '').toLowerCase().includes(term) ||
      (reg.fecha || '').toLowerCase().includes(term)
    );
  });

  const exportarExcel = () => {
    if (registrosFiltrados.length === 0) return;

    const datosExcel = registrosFiltrados.map(reg => ({
      'Fecha': reg.fecha,
      'Hora': reg.hora,
      'Colaborador': reg.userName,
      'Tipo de Registro': reg.tipoRegistro,
      'Ubicación (Maps)': reg.ubicacion
    }));

    const worksheet = XLSX.utils.json_to_sheet(datosExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Asistencias');
    XLSX.writeFile(workbook, `Historial_Asistencia_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  return (
    <div className="module-container" style={{ padding: '24px', animation: 'fadeIn 0.3s ease' }}>
      
      <div className="module-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '24px' }}>
        <h1 className="module-title" style={{ fontSize: '1.25rem', color: '#8b949e', margin: 0, fontWeight: '400' }}>
          Empleados {'>'} <span style={{ color: '#f0f6fc', fontWeight: '600' }}>Historial de Chequeo</span>
        </h1>
        <button 
          className="btn btn-outline" 
          title="Exportar a Excel"
          onClick={exportarExcel} 
          disabled={registrosFiltrados.length === 0} 
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 12px', borderRadius: '6px', backgroundColor: 'transparent', border: '1px solid #8b949e', color: '#c9d1d9', cursor: registrosFiltrados.length === 0 ? 'not-allowed' : 'pointer' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        </button>
      </div>

      <div style={{ marginBottom: '24px', maxWidth: '400px' }}>
        <input 
          type="text" 
          placeholder="Buscar por nombre, tipo o fecha..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="form-control"
          style={{ backgroundColor: '#010409', border: '1px solid #30363d', color: '#c9d1d9', padding: '10px 16px', borderRadius: '8px', width: '100%' }} 
        />
      </div>

      <div className="content-body" style={{ display: 'block' }}>
        <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 250px)' }}> 
            <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '800px' }}>
              <thead style={{ backgroundColor: '#161b22', position: 'sticky', top: 0, zIndex: 10 }}>
                <tr>
                  <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', borderBottom: '1px solid #30363d' }}>Fecha</th>
                  <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', borderBottom: '1px solid #30363d' }}>Hora</th>
                  <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', borderBottom: '1px solid #30363d' }}>Colaborador</th>
                  <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', borderBottom: '1px solid #30363d' }}>Registro</th>
                  <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', borderBottom: '1px solid #30363d' }}>Ubicación</th>
                </tr>
              </thead>
              <tbody>
                {registrosFiltrados.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>
                      {busqueda ? 'No se encontraron registros.' : 'Aún no hay registros de asistencia.'}
                    </td>
                  </tr>
                ) : (
                  registrosFiltrados.map((reg) => (
                    <tr key={reg.id} style={{ borderBottom: '1px solid #21262d' }}>
                      <td style={{ padding: '16px', color: '#c9d1d9', fontWeight: 'bold' }}>{reg.fecha}</td>
                      <td className="font-mono" style={{ padding: '16px', color: '#58a6ff' }}>{reg.hora}</td>
                      <td style={{ padding: '16px', color: '#f0f6fc', fontWeight: '500' }}>{reg.userName}</td>
                      <td style={{ padding: '16px', color: '#c9d1d9' }}>
                        <span style={{ 
                          padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 'bold',
                          backgroundColor: reg.tipoRegistro.includes('Llegada') ? 'rgba(46, 160, 67, 0.15)' : 'rgba(218, 54, 51, 0.15)',
                          color: reg.tipoRegistro.includes('Llegada') ? '#2ea043' : '#da3633',
                          border: reg.tipoRegistro.includes('Llegada') ? '1px solid rgba(46, 160, 67, 0.3)' : '1px solid rgba(218, 54, 51, 0.3)'
                        }}>
                          {reg.tipoRegistro}
                        </span>
                      </td>
                      <td style={{ padding: '16px', color: '#c9d1d9' }}>
                        {reg.ubicacion?.startsWith('http') ? (
                          <a href={reg.ubicacion} target="_blank" rel="noopener noreferrer" style={{ color: '#10b981', textDecoration: 'none' }}>📍 Ver Mapa</a>
                        ) : (
                          reg.ubicacion
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};