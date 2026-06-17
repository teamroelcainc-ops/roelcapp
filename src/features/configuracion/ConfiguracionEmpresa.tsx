// src/features/configuracion/ConfiguracionEmpresa.tsx
//
// Pantalla para editar los DATOS DE LA EMPRESA: logo, nombre, RFC, dirección,
// teléfonos, email, etc. Guarda en Firestore (configuracion/empresa) y el logo
// en Firebase Storage. El menú lateral lee estos datos vía <EmpresaBrand />.

import React, { useState, useEffect, useRef } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from '../../config/firebase';
import { useEmpresaConfig, CONFIG_EMPRESA_COL, CONFIG_EMPRESA_DOC } from './useEmpresaConfig';
import type { EmpresaConfig } from './useEmpresaConfig';

const sanitizarRuta = (s: string) =>
  String(s || '').trim().replace(/[\/\\:*?"<>|#]+/g, '').replace(/\s+/g, '_').trim();

const ConfiguracionEmpresa = () => {
  const { config, cargando } = useEmpresaConfig();

  const [form, setForm] = useState<EmpresaConfig>({});
  const [archivoLogo, setArchivoLogo] = useState<File | null>(null);
  const [previewLocal, setPreviewLocal] = useState<string>('');
  const [guardando, setGuardando] = useState(false);
  const inicializado = useRef(false);

  // Sembrar el formulario con la config existente (solo la primera vez que llega)
  useEffect(() => {
    if (!inicializado.current && !cargando) {
      setForm(config || {});
      inicializado.current = true;
    }
  }, [config, cargando]);

  const handleChange = (campo: keyof EmpresaConfig, valor: string) => {
    setForm(prev => ({ ...prev, [campo]: valor }));
  };

  const handleArchivo = (file: File | null) => {
    setArchivoLogo(file);
    if (file) setPreviewLocal(URL.createObjectURL(file));
  };

  const logoMostrado = previewLocal || form.logoUrl || '';

  const handleGuardar = async () => {
    if (!form.nombre || !form.nombre.trim()) {
      alert('El nombre de la empresa es obligatorio.');
      return;
    }
    setGuardando(true);
    try {
      let logoUrl = form.logoUrl || '';
      let logoPath = form.logoPath || '';

      // Si se eligió un nuevo logo, súbelo a Storage
      if (archivoLogo) {
        const ruta = `configuracion/logo_${Date.now()}_${sanitizarRuta(archivoLogo.name)}`;
        const r = storageRef(storage, ruta);
        await uploadBytes(r, archivoLogo);
        logoUrl = await getDownloadURL(r);

        // Borra el logo anterior (si existía y es distinto)
        if (logoPath && logoPath !== ruta) {
          try { await deleteObject(storageRef(storage, logoPath)); } catch (e) { console.warn('No se pudo borrar el logo anterior:', e); }
        }
        logoPath = ruta;
      }

      const datos: EmpresaConfig = {
        nombre: form.nombre?.trim() || '',
        rfc: form.rfc || '',
        direccion: form.direccion || '',
        telefono: form.telefono || '',
        telefonoAlt: form.telefonoAlt || '',
        email: form.email || '',
        sitioWeb: form.sitioWeb || '',
        notas: form.notas || '',
        logoUrl,
        logoPath,
      };

      await setDoc(doc(db, CONFIG_EMPRESA_COL, CONFIG_EMPRESA_DOC), datos, { merge: true });

      setArchivoLogo(null);
      setPreviewLocal('');
      setForm(datos);
      alert('Datos de la empresa guardados correctamente.');
    } catch (e: any) {
      console.error('Error guardando configuración:', e);
      alert('No se pudieron guardar los datos.\n\nVerifica las reglas de Firebase (Firestore y Storage).\n\nDetalle: ' + (e?.message || e));
    }
    setGuardando(false);
  };

  const labelStyle: React.CSSProperties = { color: '#8b949e', fontSize: '0.85rem', fontWeight: 'bold', display: 'block', marginBottom: '8px' };
  const inputStyle: React.CSSProperties = { width: '100%', padding: '10px', backgroundColor: '#010409', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', boxSizing: 'border-box', fontSize: '0.95rem' };

  return (
    <div className="module-container" style={{ padding: '24px', animation: 'fadeIn 0.3s ease', width: '100%', boxSizing: 'border-box' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>
        <h1 className="module-title" style={{ fontSize: '1.5rem', color: '#f0f6fc', margin: '0 0 24px 0', fontWeight: 'bold' }}>Datos de la Empresa</h1>

        {cargando ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#8b949e' }}>Cargando...</div>
        ) : (
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', overflow: 'hidden' }}>
            {/* LOGO */}
            <div style={{ padding: '24px', borderBottom: '1px solid #30363d', display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ width: '88px', height: '88px', borderRadius: '12px', border: '1px solid #30363d', backgroundColor: '#161b22', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                {logoMostrado ? (
                  <img src={logoMostrado} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <div style={{ width: '40px', height: '40px', borderRadius: '8px', backgroundColor: '#D84315' }} />
                )}
              </div>
              <div style={{ flex: 1, minWidth: '220px' }}>
                <div style={{ color: '#f0f6fc', fontWeight: 600, marginBottom: '4px' }}>Logo de la empresa</div>
                <div style={{ color: '#8b949e', fontSize: '0.82rem', marginBottom: '10px' }}>Aparecerá en el menú, junto al nombre. Recomendado: imagen cuadrada (PNG/JPG).</div>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: '6px', backgroundColor: '#D84315', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                  {logoMostrado ? 'Cambiar logo' : 'Subir logo'}
                  <input type="file" accept="image/*" onChange={(e) => handleArchivo(e.target.files?.[0] || null)} style={{ display: 'none' }} />
                </label>
                {archivoLogo && <span style={{ color: '#3fb950', fontSize: '0.8rem', marginLeft: '10px' }}>✓ {archivoLogo.name} (se subirá al guardar)</span>}
              </div>
            </div>

            {/* CAMPOS */}
            <div style={{ padding: '24px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Nombre de la empresa <span style={{ color: '#ef4444' }}>*</span></label>
                <input style={inputStyle} value={form.nombre || ''} onChange={(e) => handleChange('nombre', e.target.value)} placeholder="Ej. Roelca Inc." />
              </div>

              <div>
                <label style={labelStyle}>RFC / Tax ID</label>
                <input style={inputStyle} value={form.rfc || ''} onChange={(e) => handleChange('rfc', e.target.value)} />
              </div>
              <div>
                <label style={labelStyle}>Correo electrónico</label>
                <input type="email" style={inputStyle} value={form.email || ''} onChange={(e) => handleChange('email', e.target.value)} placeholder="contacto@empresa.com" />
              </div>

              <div>
                <label style={labelStyle}>Teléfono</label>
                <input type="tel" style={inputStyle} value={form.telefono || ''} onChange={(e) => handleChange('telefono', e.target.value)} />
              </div>
              <div>
                <label style={labelStyle}>Teléfono alterno</label>
                <input type="tel" style={inputStyle} value={form.telefonoAlt || ''} onChange={(e) => handleChange('telefonoAlt', e.target.value)} />
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Sitio web</label>
                <input type="url" style={inputStyle} value={form.sitioWeb || ''} onChange={(e) => handleChange('sitioWeb', e.target.value)} placeholder="https://..." />
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Dirección</label>
                <textarea style={{ ...inputStyle, minHeight: '70px', resize: 'vertical' }} value={form.direccion || ''} onChange={(e) => handleChange('direccion', e.target.value)} placeholder="Calle, número, colonia, ciudad, estado, C.P., país" />
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Notas / Información adicional</label>
                <textarea style={{ ...inputStyle, minHeight: '70px', resize: 'vertical' }} value={form.notas || ''} onChange={(e) => handleChange('notas', e.target.value)} />
              </div>
            </div>

            {/* ACCIONES */}
            <div style={{ padding: '16px 24px', borderTop: '1px solid #30363d', display: 'flex', justifyContent: 'flex-end', backgroundColor: '#161b22' }}>
              <button
                type="button"
                onClick={handleGuardar}
                disabled={guardando}
                style={{ padding: '10px 28px', borderRadius: '6px', border: 'none', backgroundColor: guardando ? '#21262d' : '#D84315', color: guardando ? '#6e7681' : '#fff', fontWeight: 'bold', cursor: guardando ? 'not-allowed' : 'pointer' }}
              >
                {guardando ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ConfiguracionEmpresa;