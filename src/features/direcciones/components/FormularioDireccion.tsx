// src/features/direcciones/components/FormularioDireccion.tsx
import React, { useState, useEffect } from 'react';
import { collection, getDocs, addDoc, updateDoc, doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import type { DireccionRecord } from '../../../types/direccion';

interface FormProps {
  estado: 'abierto' | 'minimizado';
  initialData?: DireccionRecord | null;
  onClose: () => void;
  onMinimize?: () => void;
  onRestore?: () => void;
}

// ✅ Campos del formulario de direcciones (para configurar cuáles son obligatorios).
const CAMPOS_DIRECCION: { key: string; label: string }[] = [
  { key: 'paisId', label: 'País' },
  { key: 'estadoId', label: 'Estado' },
  { key: 'municipioId', label: 'Municipio' },
  { key: 'coloniaId', label: 'Colonia' },
  { key: 'cpId', label: 'Código Postal' },
  { key: 'calleId', label: 'Calle' },
  { key: 'numExterior', label: '# Exterior' },
  { key: 'numInterior', label: '# Interior' },
];
// Por defecto: todos obligatorios excepto "# Interior".
const OBLIGATORIOS_DEFAULT = ['paisId', 'estadoId', 'municipioId', 'coloniaId', 'cpId', 'calleId', 'numExterior'];
const CONFIG_COLECCION = 'config_formularios';
const CONFIG_DOC_ID = 'direcciones';

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

  // ✅ Configuración de campos obligatorios (se carga de Firestore).
  const [camposObligatorios, setCamposObligatorios] = useState<string[]>(OBLIGATORIOS_DEFAULT);
  const [modalConfigAbierto, setModalConfigAbierto] = useState(false);
  const [guardandoConfig, setGuardandoConfig] = useState(false);
  const esObligatorio = (key: string) => camposObligatorios.includes(key);

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

  // ✅ Carga la configuración de campos obligatorios desde Firestore.
  useEffect(() => {
    const cargarConfigObligatorios = async () => {
      try {
        const snap = await getDoc(doc(db, CONFIG_COLECCION, CONFIG_DOC_ID));
        if (snap.exists()) {
          const data: any = snap.data();
          if (Array.isArray(data.camposObligatorios)) {
            setCamposObligatorios(data.camposObligatorios);
          }
        }
      } catch (error) {
        console.error('Error cargando configuración de campos obligatorios:', error);
      }
    };
    cargarConfigObligatorios();
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

  const toggleObligatorio = (key: string) => {
    setCamposObligatorios(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };

  const guardarConfigObligatorios = async () => {
    setGuardandoConfig(true);
    try {
      await setDoc(doc(db, CONFIG_COLECCION, CONFIG_DOC_ID), { camposObligatorios }, { merge: true });
      setModalConfigAbierto(false);
    } catch (error) {
      console.error('Error guardando configuración:', error);
      alert('No se pudo guardar la configuración. Revisa tu conexión.');
    } finally {
      setGuardandoConfig(false);
    }
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
    <>
    <div className={`modal-overlay ${estado === 'minimizado' ? 'minimized' : ''}`} style={{ backdropFilter: 'blur(4px)', zIndex: 2200 }}>
      <div className="form-card" style={{ maxWidth: '800px', width: '100%', borderRadius: '12px', border: '1px solid #444', backgroundColor: '#0d1117' }}>
        <div className="form-header" style={{ padding: '24px', borderBottom: '1px solid #30363d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '1.25rem', margin: 0, color: '#f0f6fc', fontWeight: '500' }}>
            {estado === 'minimizado' ? 'Editando...' : (initialData ? 'Editar Dirección' : 'Nueva Dirección')}
          </h2>
          <div className="header-actions" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              onClick={() => setModalConfigAbierto(true)}
              title="Configurar campos obligatorios"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '7px 12px', borderRadius: '6px', border: '1px solid #30363d', backgroundColor: '#21262d', color: '#c9d1d9', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
              Obligatorios
            </button>
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
                <label className="form-label" style={{ color: '#8b949e', fontSize: '0.85rem' }}>País{esObligatorio('paisId') ? ' *' : ''}</label>
                <select className="form-control" value={formData.paisId || ''} onChange={handlePaisChange} required={esObligatorio('paisId')} style={{ backgroundColor: '#010409', border: '1px solid #30363d', color: '#c9d1d9' }}>
                  <option value="">Seleccione una opción</option>
                  {paises.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" style={{ color: '#8b949e', fontSize: '0.85rem' }}>Estado{esObligatorio('estadoId') ? ' *' : ''}</label>
                <select className="form-control" value={formData.estadoId || ''} onChange={handleEstadoChange} required={esObligatorio('estadoId')} disabled={!formData.paisId} style={{ backgroundColor: '#010409', border: '1px solid #30363d', color: '#c9d1d9' }}>
                  <option value="">Seleccione una opción</option>
                  {estadosFiltrados.map(e => <option key={e.id} value={e.id}>{e.estado}</option>)}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" style={{ color: '#8b949e', fontSize: '0.85rem' }}>Municipio{esObligatorio('municipioId') ? ' *' : ''}</label>
                <select className="form-control" value={formData.municipioId || ''} onChange={handleMunicipioChange} required={esObligatorio('municipioId')} disabled={!formData.estadoId} style={{ backgroundColor: '#010409', border: '1px solid #30363d', color: '#c9d1d9' }}>
                  <option value="">Seleccione una opción</option>
                  {municipiosFiltrados.map(m => <option key={m.id} value={m.id}>{m.municipio}</option>)}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" style={{ color: '#8b949e', fontSize: '0.85rem' }}>Colonia{esObligatorio('coloniaId') ? ' *' : ''}</label>
                <select className="form-control" value={formData.coloniaId || ''} onChange={handleColoniaChange} required={esObligatorio('coloniaId')} disabled={!formData.municipioId} style={{ backgroundColor: '#010409', border: '1px solid #30363d', color: '#c9d1d9' }}>
                  <option value="">Seleccione una opción</option>
                  {coloniasFiltradas.map(c => <option key={c.id} value={c.id}>{c.colonia}</option>)}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" style={{ color: '#8b949e', fontSize: '0.85rem' }}>Código Postal{esObligatorio('cpId') ? ' *' : ''}</label>
                <select className="form-control" value={formData.cpId || ''} onChange={handleCpChange} required={esObligatorio('cpId')} disabled={!formData.coloniaId} style={{ backgroundColor: '#010409', border: '1px solid #30363d', color: '#c9d1d9' }}>
                  <option value="">Seleccione una opción</option>
                  {cpsFiltrados.map(cp => <option key={cp.id} value={cp.id}>{cp.codigo_postal}</option>)}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" style={{ color: '#8b949e', fontSize: '0.85rem' }}>Calle{esObligatorio('calleId') ? ' *' : ''}</label>
                <select className="form-control" value={formData.calleId || ''} onChange={handleCalleChange} required={esObligatorio('calleId')} disabled={!formData.cpId} style={{ backgroundColor: '#010409', border: '1px solid #30363d', color: '#c9d1d9' }}>
                  <option value="">Seleccione una opción</option>
                  {callesFiltradas.map(c => <option key={c.id} value={c.id}>{c.calle}</option>)}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" style={{ color: '#8b949e', fontSize: '0.85rem' }}># Exterior{esObligatorio('numExterior') ? ' *' : ''}</label>
                <input type="text" className="form-control" value={formData.numExterior || ''} onChange={(e) => setFormData({...formData, numExterior: e.target.value})} required={esObligatorio('numExterior')} style={{ backgroundColor: '#010409', border: '1px solid #30363d', color: '#c9d1d9' }} />
              </div>
              <div className="form-group">
                <label className="form-label" style={{ color: '#8b949e', fontSize: '0.85rem' }}># Interior{esObligatorio('numInterior') ? ' *' : ''}</label>
                <input type="text" className="form-control" value={formData.numInterior || ''} onChange={(e) => setFormData({...formData, numInterior: e.target.value})} required={esObligatorio('numInterior')} style={{ backgroundColor: '#010409', border: '1px solid #30363d', color: '#c9d1d9' }} />
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

    {modalConfigAbierto && (
      <div className="modal-overlay" style={{ backdropFilter: 'blur(4px)', zIndex: 2300, position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <div className="form-card" style={{ maxWidth: '460px', width: '95%', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px' }}>
          <div className="form-header" style={{ padding: '20px 24px', borderBottom: '1px solid #30363d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.1rem' }}>Campos Obligatorios</h3>
            <button type="button" onClick={() => setModalConfigAbierto(false)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
          </div>
          <div style={{ padding: '20px 24px' }}>
            <p style={{ color: '#8b949e', fontSize: '0.85rem', marginTop: 0, marginBottom: '16px' }}>
              Marca los campos que serán obligatorios al guardar una dirección. La configuración aplica para todos los usuarios.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              {CAMPOS_DIRECCION.map(campo => (
                <label key={campo.key} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '6px', cursor: 'pointer', color: esObligatorio(campo.key) ? '#c9d1d9' : '#8b949e', fontSize: '0.9rem' }}>
                  <input
                    type="checkbox"
                    checked={esObligatorio(campo.key)}
                    onChange={() => toggleObligatorio(campo.key)}
                    style={{ accentColor: '#D84315', width: '16px', height: '16px', cursor: 'pointer' }}
                  />
                  {campo.label}
                </label>
              ))}
            </div>
          </div>
          <div style={{ padding: '16px 24px', borderTop: '1px solid #30363d', display: 'flex', justifyContent: 'flex-end', gap: '12px', backgroundColor: '#161b22', borderBottomLeftRadius: '12px', borderBottomRightRadius: '12px' }}>
            <button type="button" onClick={() => setModalConfigAbierto(false)} style={{ padding: '8px 16px', background: 'transparent', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: '6px', cursor: 'pointer' }}>Cancelar</button>
            <button type="button" onClick={guardarConfigObligatorios} disabled={guardandoConfig} style={{ padding: '8px 20px', backgroundColor: '#D84315', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>
              {guardandoConfig ? 'Guardando...' : 'Guardar Configuración'}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
};