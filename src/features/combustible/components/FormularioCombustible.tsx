// src/features/combustible/components/FormularioCombustible.tsx

import React, { useState, useEffect } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db, actualizarRegistro } from '../../../config/firebase'; 
import type { Moneda, CombustibleRecord } from '../../../types/combustible';
import { getMonedasCatalogo, getTipoCambioPorFecha, saveCombustible } from '../services/combustibleService';

// =========================================
// SUB-COMPONENTE: SELECTOR CON BUSCADOR
// =========================================
const SearchableSelect: React.FC<{
  options: { id: string, label: string }[];
  value: string;
  onChange: (id: string, label: string) => void;
  placeholder?: string;
  required?: boolean;
}> = ({ options, value, onChange, placeholder = "Buscar...", required = false }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  
  const selectedLabel = options.find(o => o.id === value)?.label || '';

  useEffect(() => {
    setSearchTerm(selectedLabel);
  }, [value, selectedLabel]);

  const filteredOptions = options.filter(opt => 
    opt.label.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <input
        type="text"
        className="form-control"
        placeholder={placeholder}
        value={isOpen ? searchTerm : selectedLabel}
        onChange={(e) => {
          setSearchTerm(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => {
          setSearchTerm(''); 
          setIsOpen(true);
        }}
        onBlur={() => {
          setTimeout(() => setIsOpen(false), 200);
          setSearchTerm(selectedLabel); 
        }}
        required={required && !value} 
        style={{ cursor: 'text', border: isOpen ? '1px solid #3b82f6' : '', backgroundColor: '#0d1117', color: '#c9d1d9' }}
      />
      
      {isOpen && (
        <ul style={{
          position: 'absolute', top: '100%', left: 0, right: 0, maxHeight: '200px', overflowY: 'auto',
          backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '4px', marginTop: '4px', padding: '0', margin: '4px 0 0 0', listStyle: 'none', zIndex: 1000, boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.5)'
        }}>
          {filteredOptions.length > 0 ? (
            filteredOptions.map(opt => (
              <li
                key={opt.id}
                onClick={() => {
                  onChange(opt.id, opt.label);
                  setSearchTerm(opt.label);
                  setIsOpen(false);
                }}
                style={{ padding: '8px 12px', cursor: 'pointer', color: '#c9d1d9', borderBottom: '1px solid #21262d', fontSize: '0.85rem' }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#21262d'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                {opt.label}
              </li>
            ))
          ) : (
            <li style={{ padding: '8px 12px', color: '#8b949e', fontSize: '0.85rem', textAlign: 'center' }}>
              No se encontraron coincidencias
            </li>
          )}
        </ul>
      )}
    </div>
  );
};

// =========================================
// COMPONENTE PRINCIPAL
// =========================================

interface FormProps {
  estado?: 'abierto' | 'minimizado';
  initialData?: CombustibleRecord | null; // ✅ PROPIEDAD AGREGADA PARA LA EDICIÓN
  onClose: () => void;
  onSuccess: () => void;
  onMinimize?: () => void; 
  onRestore?: () => void;
}

export const FormularioCombustible: React.FC<FormProps> = ({ 
  estado = 'abierto', 
  initialData, // ✅ RECIBIMOS LOS DATOS
  onClose, 
  onSuccess,
  onMinimize = () => {},
  onRestore = () => {}
}) => {
  const [monedas, setMonedas] = useState<Moneda[]>([]);
  const todayISO = new Date().toISOString().split('T')[0];

  const [fecha, setFecha] = useState<string>(todayISO);
  const [tipoCombustible, setTipoCombustible] = useState<'Gasolina' | 'Diesel'>('Diesel');
  const [monedaSeleccionada, setMonedaSeleccionada] = useState<Moneda | null>(null);
  const [tipoMedida, setTipoMedida] = useState<string>(''); 
  
  const [proveedoresDB, setProveedoresDB] = useState<any[]>([]);
  const [proveedorId, setProveedorId] = useState<string>('');
  const [proveedorNombre, setProveedorNombre] = useState<string>('');

  const [costo, setCosto] = useState<number>(0);
  const [tipoCambio, setTipoCambio] = useState<number>(0);
  const [cargandoApi, setCargandoApi] = useState<boolean>(false);

  useEffect(() => {
    const fetchMonedas = async () => {
      const data = await getMonedasCatalogo();
      setMonedas(data);
      if (data.length > 0 && !initialData) {
        setMonedaSeleccionada(data[0]);
        setTipoMedida(data[0].esDolar ? 'Galones' : 'Litros');
      }
    };
    fetchMonedas();
  }, [initialData]);

  // ✅ EFECTO PARA LLENAR EL FORMULARIO SI ESTAMOS EDITANDO
  useEffect(() => {
    if (initialData) {
      setFecha(initialData.fecha || todayISO);
      setTipoCombustible(initialData.tipoCombustible || 'Diesel');
      setTipoMedida(initialData.tipoMedida || '');
      setProveedorId(initialData.proveedorId || '');
      setProveedorNombre(initialData.proveedor || '');
      setCosto(initialData.costo || 0);

      // Si las monedas ya cargaron, buscamos la que corresponde al registro
      if (initialData.monedaId && monedas.length > 0) {
        const monedaMatch = monedas.find(m => m.id === initialData.monedaId);
        if (monedaMatch) setMonedaSeleccionada(monedaMatch);
      }
    }
  }, [initialData, monedas, todayISO]);

  useEffect(() => {
    const cargarProveedores = async () => {
      try {
        const empSnapshot = await getDocs(collection(db, 'empresas'));
        const todasEmpresas = empSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        const ID_PROVEEDOR = '11894dfd';
        
        const proveedoresFiltrados = todasEmpresas.filter((emp: any) => {
          if (Array.isArray(emp.tiposEmpresa)) {
            return emp.tiposEmpresa.some((tipo: string) => 
              tipo === ID_PROVEEDOR || tipo.toLowerCase().includes('proveedor')
            );
          }
          const stringData = JSON.stringify(emp).toLowerCase();
          return stringData.includes(ID_PROVEEDOR.toLowerCase()) || stringData.includes('proveedor');
        });
        
        setProveedoresDB(proveedoresFiltrados);
      } catch (error) {
        console.error("Error al obtener proveedores:", error);
      }
    };
    cargarProveedores();
  }, []);

  useEffect(() => {
    const fetchTipoCambio = async () => {
      if (monedaSeleccionada?.esDolar && fecha) {
        setCargandoApi(true);
        const tc = await getTipoCambioPorFecha();
        // Si estamos editando y es el mismo día, respetamos el tc guardado temporalmente, 
        // pero preferimos siempre usar el oficial de la API para mantener integridad.
        setTipoCambio(tc);
        setCargandoApi(false);
      } else {
        setTipoCambio(0);
      }
    };
    fetchTipoCambio();
  }, [fecha, monedaSeleccionada]);

  const esDolar = monedaSeleccionada?.esDolar ?? false;
  const totalPesos = esDolar ? costo * tipoCambio : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!monedaSeleccionada) return;
    if (!proveedorId) {
        alert("Por favor seleccione un proveedor válido de la lista.");
        return;
    }

    // Usamos 'any' internamente para que no nos de conflicto si el ID va o no incluido
    const record: any = {
      fecha,
      tipoCombustible,
      monedaId: monedaSeleccionada.id,
      monedaNombre: monedaSeleccionada.nombre,
      tipoMedida: tipoMedida as 'Litros' | 'Galones',
      proveedor: proveedorNombre, 
      proveedorId: proveedorId, 
      costo,
      ...(esDolar && { tipoCambio, totalPesos })
    };

    try {
      // ✅ SI HAY INITIAL DATA, ACTUALIZAMOS. SI NO, CREAMOS UNO NUEVO
      if (initialData && (initialData as any).id) {
        await actualizarRegistro('combustibles', (initialData as any).id, record);
      } else {
        await saveCombustible(record as CombustibleRecord);
      }
      onSuccess();
      onClose();
    } catch (error) {
      console.error("Error al guardar:", error);
      alert('Hubo un error al guardar los datos. Revisa tu conexión.');
    }
  };

  const handleMonedaChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    const encontrada = monedas.find(m => m.id === id) || null;
    setMonedaSeleccionada(encontrada);
    if (encontrada) setTipoMedida(encontrada.esDolar ? 'Galones' : 'Litros');
  };

  const opcionesProveedores = proveedoresDB.map(prov => ({
    id: prov.id,
    label: prov.nombre || prov.nombreCorto || prov.empresa || `Proveedor ID: ${prov.id.slice(0,4)}`
  }));

  return (
    <div className={`modal-overlay ${estado === 'minimizado' ? 'minimized' : ''}`}>
      <div className="form-card" style={{ maxWidth: '700px' }}>
        <div className="form-header">
          <h2>{estado === 'minimizado' ? 'Editando...' : (initialData ? 'Editar Costo de Combustible' : 'Nuevo Costo de Combustible')}</h2>
          <div className="header-actions">
            {estado === 'abierto' ? (
              <button type="button" onClick={onMinimize} className="btn-window">🗕</button>
            ) : (
              <button type="button" onClick={onRestore} className="btn-window restore">🗖</button>
            )}
            <button type="button" onClick={onClose} className="btn-window close">✕</button>
          </div>
        </div>

        <div style={{ display: estado === 'minimizado' ? 'none' : 'block', padding: '10px 0' }}>
          <form onSubmit={handleSubmit}>
            <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              <div className="form-group">
                <label className="form-label">Fecha *</label>
                <input type="date" className="form-control" value={fecha} onChange={(e) => setFecha(e.target.value)} required />
              </div>

              <div className="form-group">
                <label className="form-label">Proveedor *</label>
                <SearchableSelect 
                  options={opcionesProveedores}
                  value={proveedorId}
                  onChange={(id, label) => {
                    setProveedorId(id);
                    setProveedorNombre(label);
                  }}
                  placeholder="Ej: Fuel America..."
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Tipo de Combustible *</label>
                <select className="form-control" value={tipoCombustible} onChange={(e) => setTipoCombustible(e.target.value as 'Gasolina' | 'Diesel')} required>
                  <option value="Gasolina">Gasolina</option>
                  <option value="Diesel">Diesel</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Moneda *</label>
                <select className="form-control" value={monedaSeleccionada?.id || ''} onChange={handleMonedaChange} required>
                  {monedas.map(m => (
                    <option key={m.id} value={m.id}>{m.nombre}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Tipo de Medida *</label>
                <input type="text" className="form-control" value={tipoMedida} onChange={(e) => setTipoMedida(e.target.value)} required />
              </div>

              <div className="form-group">
                <label className="form-label">Costo ({monedaSeleccionada?.nombre || ''}) *</label>
                <input type="number" step="0.001" className="form-control" value={costo} onChange={(e) => setCosto(parseFloat(e.target.value) || 0)} required />
              </div>

              {esDolar && (
                <>
                  <div className="form-group">
                    <label className="form-label orange">T.C. DOF (al {fecha})</label>
                    <input type="text" className="form-control" value={cargandoApi ? 'Consultando...' : tipoCambio.toFixed(4)} disabled style={{ backgroundColor: '#21262d', color: '#8b949e', cursor: 'not-allowed' }} />
                  </div>
                  <div className="form-group">
                    <label className="form-label orange">Total en Pesos MXN</label>
                    <input type="number" className="form-control" value={totalPesos.toFixed(4)} disabled style={{ backgroundColor: '#21262d', color: '#8b949e', cursor: 'not-allowed' }} />
                  </div>
                </>
              )}
            </div>

            <div className="form-actions" style={{ marginTop: '24px' }}>
              <button type="button" onClick={onClose} className="btn btn-outline">Cancelar</button>
              <button type="submit" className="btn btn-primary" disabled={cargandoApi}>Guardar</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};