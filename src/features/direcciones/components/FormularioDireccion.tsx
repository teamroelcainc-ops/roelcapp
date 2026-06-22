// src/features/direcciones/components/FormularioDireccion.tsx
import React, { useState, useEffect } from 'react';
import { collection, getDocs, addDoc, updateDoc, doc } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import type { DireccionRecord } from '../../../types/direccion';

interface FormProps {
  estado: 'abierto' | 'minimizado';
  initialData?: DireccionRecord | null;
  onClose: () => void;
  onMinimize?: () => void;
  onRestore?: () => void;
}

export const FormularioDireccion: React.FC<FormProps> = ({ 
  estado, 
  initialData, 
  onClose, 
  onMinimize = () => {}, 
  onRestore = () => {} 
}) => {
  const estadoInicial: DireccionRecord = {
    paisId: '', paisNombre: '',
    estadoId: '', estadoNombre: '',
    municipioId: '', municipioNombre: '',
    coloniaId: '', coloniaNombre: '',
    cpId: '', cpNombre: '',
    calleId: '', calleNombre: '',
    numExterior: '', numInterior: '',
    direccionCompleta: ''
  };

  const [formData, setFormData] = useState<DireccionRecord>(estadoInicial);
  const [cargando, setCargando] = useState(false);

  const [paises, setPaises] = useState<any[]>([]);
  const [estadosDB, setEstadosDB] = useState<any[]>([]);
  const [municipios, setMunicipios] = useState<any[]>([]);
  const [colonias, setColonias] = useState<any[]>([]);
  const [cps, setCps] = useState<any[]>([]);
  const [calles, setCalles] = useState<any[]>([]);

  useEffect(() => {
    if (initialData) {
      setFormData(initialData);
    } else {
      setFormData(estadoInicial);
    }
  }, [initialData]);

  useEffect(() => {
    const cargarCatalogos = async () => {
      try {
        const [resPaises, resEstados, resMunicipios, resColonias, resCps, resCalles] = await Promise.all([
          getDocs(collection(db, 'catalogo_paises')),
          getDocs(collection(db, 'catalogo_estados')),
          getDocs(collection(db, 'catalogo_municipios')),
          getDocs(collection(db, 'catalogo_colonias')),
          getDocs(collection(db, 'catalogo_codigo_postal')),
          getDocs(collection(db, 'catalogo_calles'))
        ]);

        setPaises(resPaises.docs.map(d => ({ id: d.id, ...d.data() })));
        setEstadosDB(resEstados.docs.map(d => ({ id: d.id, ...d.data() })));
        setMunicipios(resMunicipios.docs.map(d => ({ id: d.id, ...d.data() })));
        setColonias(resColonias.docs.map(d => ({ id: d.id, ...d.data() })));
        setCps(resCps.docs.map(d => ({ id: d.id, ...d.data() })));
        setCalles(resCalles.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (error) {
        console.error("Error al cargar catálogos:", error);
      }
    };
    cargarCatalogos();
  }, []);

  const estadosFiltrados = estadosDB.filter(e => e.pais === formData.paisId);
  const municipiosFiltrados = municipios.filter(m => m.estado === formData.estadoId);
  const coloniasFiltradas = colonias.filter(c => c.municipio === formData.municipioId);
  const cpsFiltrados = cps.filter(cp => cp.colonia === formData.coloniaId);
  const callesFiltradas = calles.filter(c => c.codigo_postal === formData.cpId);

  const construirDireccionCompleta = (data: DireccionRecord) => {
    const pais = data.paisNombre?.toLowerCase() || '';
    
    const numExt = data.numExterior ? ` #${data.numExterior}` : '';
    const numInt = data.numInterior ? ` ${data.numInterior}` : '';
    const col = data.coloniaNombre ? `, Col. ${data.coloniaNombre}` : '';
    const cp = data.cpNombre ? `, C.P. ${data.cpNombre}` : '';
    const mun = data.municipioNombre ? `, ${data.municipioNombre}` : '';
    const est = data.estadoNombre ? `, ${data.estadoNombre}` : '';
    const namePais = data.paisNombre ? `, ${data.paisNombre}` : '';
    const calle = data.calleNombre || '';

    if (pais.includes('méxico') || pais.includes('mexico')) {
      return `${calle}${numExt}${numInt}${col}${cp}${mun}${est}${namePais}`;
    } else if (pais.includes('estados unidos') || pais.includes('usa') || pais.includes('us')) {
      const extUS = data.numExterior ? `${data.numExterior} ` : '';
      const intUS = data.numInterior ? `, ${data.numInterior}` : '';
      const colUS = data.coloniaNombre ? `, ${data.coloniaNombre}` : '';
      const cpUS = data.cpNombre ? `, ${data.cpNombre}` : '';
      return `${extUS}${calle}${intUS}${colUS}${cpUS}${mun}${est}${namePais}`;
    }

    if (!calle && !data.numExterior && !data.estadoNombre) return '';
    return `${calle}${numExt}${col}${mun}${est}${namePais}`;
  };

  useEffect(() => {
    const dirCompleta = construirDireccionCompleta(formData);
    setFormData(prev => ({ ...prev, direccionCompleta: dirCompleta }));
  }, [
    formData.paisNombre, formData.estadoNombre, formData.municipioNombre, 
    formData.coloniaNombre, formData.cpNombre, formData.calleNombre, 
    formData.numExterior, formData.numInterior
  ]);

  const handlePaisChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    const nombre = paises.find(p => p.id === id)?.nombre || '';
    setFormData(prev => ({
      ...prev, paisId: id, paisNombre: nombre,
      estadoId: '', estadoNombre: '', municipioId: '', municipioNombre: '',
      coloniaId: '', coloniaNombre: '', cpId: '', cpNombre: '', calleId: '', calleNombre: ''
    }));
  };

  const handleEstadoChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    const nombre = estadosDB.find(x => x.id === id)?.estado || '';
    setFormData(prev => ({
      ...prev, estadoId: id, estadoNombre: nombre,
      municipioId: '', municipioNombre: '', coloniaId: '', coloniaNombre: '', 
      cpId: '', cpNombre: '', calleId: '', calleNombre: ''
    }));
  };

  const handleMunicipioChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    const nombre = municipios.find(x => x.id === id)?.municipio || '';
    setFormData(prev => ({
      ...prev, municipioId: id, municipioNombre: nombre,
      coloniaId: '', coloniaNombre: '', cpId: '', cpNombre: '', calleId: '', calleNombre: ''
    }));
  };

  const handleColoniaChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    const nombre = colonias.find(x => x.id === id)?.colonia || '';
    setFormData(prev => ({
      ...prev, coloniaId: id, coloniaNombre: nombre,
      cpId: '', cpNombre: '', calleId: '', calleNombre: ''
    }));
  };

  const handleCpChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    const nombre = cps.find(x => x.id === id)?.codigo_postal || '';
    setFormData(prev => ({
      ...prev, cpId: id, cpNombre: nombre, calleId: '', calleNombre: ''
    }));
  };

  const handleCalleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    const nombre = calles.find(x => x.id === id)?.calle || '';
    setFormData(prev => ({ ...prev, calleId: id, calleNombre: nombre }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCargando(true);
    try {
      const dataToSave = { ...formData };

      if (formData.id) {
        await updateDoc(doc(db, 'direcciones', formData.id), dataToSave);
      } else {
        await addDoc(collection(db, 'direcciones'), dataToSave);
      }
      onClose();
    } catch (error) {
      console.error("Error guardando dirección:", error);
      alert("Error al guardar la dirección. Revisa tu conexión.");
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className={`modal-overlay ${estado === 'minimizado' ? 'minimized' : ''}`} style={{ backdropFilter: 'blur(4px)', zIndex: 2200 }}>
      <div className="form-card" style={{ maxWidth: '800px', width: '100%', borderRadius: '12px', border: '1px solid #444', backgroundColor: '#0d1117' }}>
        <div className="form-header" style={{ padding: '24px', borderBottom: '1px solid #30363d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '1.25rem', margin: 0, color: '#f0f6fc', fontWeight: '500' }}>
            {estado === 'minimizado' ? 'Editando...' : (initialData ? 'Editar Dirección' : 'Nueva Dirección')}
          </h2>
          <div className="header-actions">
            {estado === 'abierto' ? (
              <button type="button" onClick={onMinimize} className="btn-window">🗕</button>
            ) : (
              <button type="button" onClick={onRestore} className="btn-window restore">🗖</button>
            )}
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#8b949e', fontSize: '1.2rem', cursor: 'pointer' }}>✕</button>
          </div>
        </div>

        <div style={{ display: estado === 'minimizado' ? 'none' : 'block' }}>
          <form onSubmit={handleSubmit} style={{ padding: '24px' }}>
            
            <div style={{ marginBottom: '24px', padding: '16px', backgroundColor: '#161b22', border: '1px dashed #30363d', borderRadius: '8px' }}>
              <span style={{ display: 'block', fontSize: '0.75rem', color: '#8b949e', textTransform: 'uppercase', marginBottom: '8px' }}>Vista Previa de la Dirección:</span>
              <span style={{ fontSize: '1.1rem', color: '#58a6ff', fontWeight: '500' }}>
                {formData.direccionCompleta || 'Complete los campos para generar la dirección...'}
              </span>
            </div>

            <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              
              <div className="form-group">
                <label className="form-label" style={{ color: '#8b949e', fontSize: '0.85rem' }}>País *</label>
                <select className="form-control" value={formData.paisId || ''} onChange={handlePaisChange} required style={{ backgroundColor: '#010409', border: '1px solid #30363d', color: '#c9d1d9' }}>
                  <option value="">Seleccione una opción</option>
                  {paises.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" style={{ color: '#8b949e', fontSize: '0.85rem' }}>Estado *</label>
                <select className="form-control" value={formData.estadoId || ''} onChange={handleEstadoChange} required disabled={!formData.paisId} style={{ backgroundColor: '#010409', border: '1px solid #30363d', color: '#c9d1d9' }}>
                  <option value="">Seleccione una opción</option>
                  {estadosFiltrados.map(e => <option key={e.id} value={e.id}>{e.estado}</option>)}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" style={{ color: '#8b949e', fontSize: '0.85rem' }}>Municipio *</label>
                <select className="form-control" value={formData.municipioId || ''} onChange={handleMunicipioChange} required disabled={!formData.estadoId} style={{ backgroundColor: '#010409', border: '1px solid #30363d', color: '#c9d1d9' }}>
                  <option value="">Seleccione una opción</option>
                  {municipiosFiltrados.map(m => <option key={m.id} value={m.id}>{m.municipio}</option>)}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" style={{ color: '#8b949e', fontSize: '0.85rem' }}>Colonia *</label>
                <select className="form-control" value={formData.coloniaId || ''} onChange={handleColoniaChange} required disabled={!formData.municipioId} style={{ backgroundColor: '#010409', border: '1px solid #30363d', color: '#c9d1d9' }}>
                  <option value="">Seleccione una opción</option>
                  {coloniasFiltradas.map(c => <option key={c.id} value={c.id}>{c.colonia}</option>)}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" style={{ color: '#8b949e', fontSize: '0.85rem' }}>Código Postal *</label>
                <select className="form-control" value={formData.cpId || ''} onChange={handleCpChange} required disabled={!formData.coloniaId} style={{ backgroundColor: '#010409', border: '1px solid #30363d', color: '#c9d1d9' }}>
                  <option value="">Seleccione una opción</option>
                  {cpsFiltrados.map(cp => <option key={cp.id} value={cp.id}>{cp.codigo_postal}</option>)}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" style={{ color: '#8b949e', fontSize: '0.85rem' }}>Calle *</label>
                <select className="form-control" value={formData.calleId || ''} onChange={handleCalleChange} required disabled={!formData.cpId} style={{ backgroundColor: '#010409', border: '1px solid #30363d', color: '#c9d1d9' }}>
                  <option value="">Seleccione una opción</option>
                  {callesFiltradas.map(c => <option key={c.id} value={c.id}>{c.calle}</option>)}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" style={{ color: '#8b949e', fontSize: '0.85rem' }}># Exterior *</label>
                <input type="text" className="form-control" value={formData.numExterior || ''} onChange={(e) => setFormData({...formData, numExterior: e.target.value})} required style={{ backgroundColor: '#010409', border: '1px solid #30363d', color: '#c9d1d9' }} />
              </div>
              <div className="form-group">
                <label className="form-label" style={{ color: '#8b949e', fontSize: '0.85rem' }}># Interior</label>
                <input type="text" className="form-control" value={formData.numInterior || ''} onChange={(e) => setFormData({...formData, numInterior: e.target.value})} style={{ backgroundColor: '#010409', border: '1px solid #30363d', color: '#c9d1d9' }} />
              </div>

            </div>

            <div style={{ marginTop: '32px', display: 'flex', gap: '16px', justifyContent: 'flex-end', borderTop: '1px solid #30363d', paddingTop: '24px' }}>
              <button type="button" onClick={onClose} style={{ backgroundColor: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', padding: '10px 24px', borderRadius: '6px', cursor: 'pointer', fontWeight: '500' }}>Cancelar</button>
              <button type="submit" disabled={cargando} style={{ backgroundColor: '#D84315', color: '#fff', border: 'none', padding: '10px 24px', borderRadius: '6px', cursor: 'pointer', fontWeight: '500' }}>
                {cargando ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};