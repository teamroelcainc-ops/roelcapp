// src/features/relojChecador/components/HistorialChequeosDashboard.tsx
//
// ✅ Refactor CLAUDE.md (archivo ejemplar de la convención):
//   · Estilos fijos → clases en el CSS hermano (0 style={{...}}).
//   · Sin `any`: registros y usuario con tipos con nombre.
//   · Ícono con lucide-react en lugar de SVG a mano.
//   · Sin React.FC (convención de componentes del proyecto).
import { useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import * as XLSX from 'xlsx';
import { Download } from 'lucide-react';
import './HistorialChequeosDashboard.css';

// ⭐ Tipo local: la colección reloj_checador solo se lee aquí y se escribe en
//    RelojChecadorModal; estos campos aún no viven en src/types.
export interface ChequeoRegistro {
  id: string;
  userId?: string;
  userName?: string;
  tipoRegistro?: string;
  fecha?: string;
  hora?: string;
  ubicacion?: string;
  timestamp?: unknown;
}

// ⭐ Solo los campos del usuario que esta vista usa (el doc completo de
//    `usuarios` no tiene tipo canónico todavía).
interface UsuarioSesion {
  id: string;
  rol?: string;
}

interface Props {
  usuarioActual: UsuarioSesion | null;
  /** ✅ Permiso de rol "Ver todos los chequeos": true = ve el historial de
   *  TODOS los colaboradores; false = solo sus propios registros. Lo resuelve
   *  App.tsx (ADMIN siempre lo tiene; los demás según su rol). */
  puedeVerTodos?: boolean;
}

export function HistorialChequeosDashboard({ usuarioActual, puedeVerTodos }: Props) {
  const [registros, setRegistros] = useState<ChequeoRegistro[]>([]);
  const [busqueda, setBusqueda] = useState('');

  // ✅ El acceso total ya NO depende de roles quemados en el código: lo decide
  //   el permiso configurable en Roles y Permisos (grupo Permisos Especiales).
  const tieneFullAccess = !!usuarioActual && puedeVerTodos === true;

  useEffect(() => {
    if (!usuarioActual) return;

    // Todos los registros ordenados por tiempo (el más reciente primero).
    // onSnapshot + caché persistente de Firestore: pinta al instante desde
    // IndexedDB y solo factura lecturas por documentos nuevos/cambiados.
    const q = query(collection(db, 'reloj_checador'), orderBy('timestamp', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      let data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }) as ChequeoRegistro);

      // Si NO es admin/gerencia/sistemas, solo ve los suyos (filtro en memoria)
      if (!tieneFullAccess) {
        data = data.filter(d => d.userId === usuarioActual.id);
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
      'Ubicación (Maps)': reg.ubicacion,
    }));

    const worksheet = XLSX.utils.json_to_sheet(datosExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Asistencias');
    XLSX.writeFile(workbook, `Historial_Asistencia_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  return (
    <div className="module-container hcheq-container">

      <div className="module-header hcheq-header">
        <h1 className="module-title hcheq-title">
          Empleados {'>'} <strong>Historial de Chequeo</strong>
        </h1>
        <button
          className="hcheq-btn-export"
          title="Exportar a Excel"
          onClick={exportarExcel}
          disabled={registrosFiltrados.length === 0}
        >
          <Download size={16} />
        </button>
      </div>

      <div className="hcheq-busqueda">
        <input
          type="text"
          placeholder="Buscar por nombre, tipo o fecha..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="form-control"
        />
      </div>

      <div className="content-body hcheq-body">
        <div className="table-container hcheq-tabla-marco">
          <div className="hcheq-tabla-scroll">
            <table className="data-table hcheq-tabla">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Hora</th>
                  <th>Colaborador</th>
                  <th>Registro</th>
                  <th>Ubicación</th>
                </tr>
              </thead>
              <tbody>
                {registrosFiltrados.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="hcheq-vacio">
                      {busqueda ? 'No se encontraron registros.' : 'Aún no hay registros de asistencia.'}
                    </td>
                  </tr>
                ) : (
                  registrosFiltrados.map((reg) => (
                    <tr key={reg.id}>
                      <td className="hcheq-fecha">{reg.fecha}</td>
                      <td className="font-mono hcheq-hora">{reg.hora}</td>
                      <td className="hcheq-nombre">{reg.userName}</td>
                      <td>
                        <span className={`hcheq-badge${(reg.tipoRegistro || '').includes('Llegada') ? ' llegada' : ''}`}>
                          {reg.tipoRegistro}
                        </span>
                      </td>
                      <td>
                        {reg.ubicacion?.startsWith('http') ? (
                          <a href={reg.ubicacion} target="_blank" rel="noopener noreferrer" className="hcheq-mapa-link">Ver Mapa</a>
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
}
