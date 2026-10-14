// src/features/configuracion/ConfiguracionEmpresa.tsx
//
// Pantalla para editar los DATOS DE LA EMPRESA: logo, nombre, RFC, dirección,
// teléfonos, email, etc. Guarda en Firestore (configuracion/empresa) y el logo
// en Firebase Storage. El menú lateral lee estos datos vía <EmpresaBrand />.
//
// ✅ Al subir el logo se guarda TAMBIÉN como base64 (logoBase64) dentro del
//    documento de Firestore. Así la app y los PDFs usan el mismo logo SIN
//    depender de CORS de Storage (html2pdf "tinta" el canvas con imágenes de
//    otro dominio y las bloquea; el base64 evita ese problema por completo).

import React, { useState, useEffect, useRef } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { ref as storageRef, deleteObject } from 'firebase/storage';
import { db, storage } from '../../config/firebase';
import { useEmpresaConfig, CONFIG_EMPRESA_COL, CONFIG_EMPRESA_DOC } from './useEmpresaConfig';
import type { EmpresaConfig } from './useEmpresaConfig';
import AdjuntosArchivos from '../../shared/components/AdjuntosArchivos'; // ✅ V00451
import { desdeGuardados } from '../../shared/archivos/adjuntos';
import type { Adjunto } from '../../shared/archivos/adjuntos';
import { subirAdjuntos } from '../../shared/archivos/subirAdjuntos';
import { useUrlArchivo } from '../../shared/hooks/useUrlArchivo';
import './ConfiguracionEmpresa.css';

// ✅ Convierte un archivo LOCAL de imagen a dataURL base64, redimensionándolo a un
// máximo razonable para no inflar el documento de Firestore (límite ~1 MB por doc).
// Como el archivo es local (no viene de otro dominio), NO hay problema de CORS.
const fileToLogoBase64 = (file: File, maxDim = 400): Promise<string> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const escala = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * escala);
        height = Math.round(height * escala);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('No se pudo crear el contexto del canvas')); return; }
      ctx.drawImage(img, 0, 0, width, height);
      // PNG conserva transparencia; si saliera muy pesado, caemos a JPEG.
      let dataUrl = canvas.toDataURL('image/png');
      if (dataUrl.length > 700000) {
        dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      }
      resolve(dataUrl);
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });

const ConfiguracionEmpresa = () => {
  const { config, cargando } = useEmpresaConfig();

  const [form, setForm] = useState<EmpresaConfig>({});
  // ✅ V00451: logo con la carga compartida (una imagen). null = sin cambios: se muestra el
  //   guardado (se ve y se puede reemplazar o quitar); el nuevo se sube al guardar.
  const [logoElegido, setLogoElegido] = useState<Adjunto[] | null>(null);
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

  const urlLogoGuardado = form.logoUrl || form.logoBase64 || '';
  const adjuntosLogo = logoElegido ?? desdeGuardados(urlLogoGuardado ? [{ url: urlLogoGuardado, nombre: 'Logo actual' }] : []);
  const logoActual = adjuntosLogo[0];
  const urlLogoNuevo = useUrlArchivo(logoActual?.estado === 'nuevo' ? logoActual.file : null);
  const logoMostrado = !logoActual ? '' : logoActual.estado === 'nuevo' ? urlLogoNuevo : (form.logoBase64 || form.logoUrl || '');

  const handleGuardar = async () => {
    if (!form.nombre || !form.nombre.trim()) {
      alert('El nombre de la empresa es obligatorio.');
      return;
    }
    setGuardando(true);
    try {
      let logoUrl = form.logoUrl || '';
      let logoPath = form.logoPath || '';
      let logoBase64 = form.logoBase64 || '';
      const logoAnterior = logoPath;

      // Si se eligió un nuevo logo, súbelo a Storage Y conviértelo a base64.
      // ✅ V00451: con la carga compartida (nombre único + caché); quitarlo deja los campos vacíos.
      const archivoLogo = logoActual?.estado === 'nuevo' ? logoActual.file : null;
      if (archivoLogo) {
        const [subido] = await subirAdjuntos(adjuntosLogo, 'configuracion');
        logoUrl = subido.url;
        logoPath = subido.path ?? '';

        // ✅ Generar el base64 (lo usan la app y los PDFs sin CORS)
        try {
          logoBase64 = await fileToLogoBase64(archivoLogo);
        } catch (e) {
          console.warn('No se pudo generar el logo en base64:', e);
          logoBase64 = '';
        }
      } else if (!logoActual) {
        logoUrl = '';
        logoPath = '';
        logoBase64 = '';
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
        logoBase64,
      };

      await setDoc(doc(db, CONFIG_EMPRESA_COL, CONFIG_EMPRESA_DOC), datos, { merge: true });

      // Borra el logo anterior (si existía y es distinto). ✅ V00451: después de guardar, para no
      //   dejar la configuración apuntando a un archivo borrado si el guardado falla.
      if (logoAnterior && logoAnterior !== logoPath) {
        try { await deleteObject(storageRef(storage, logoAnterior)); } catch (e) { console.warn('No se pudo borrar el logo anterior:', e); }
      }

      setLogoElegido(null);
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
    <div className="module-container ce-x1">
      <div className="ce-x2">
        <h1 className="module-title ce-x3">Datos de la Empresa</h1>

        {cargando ? (
          <div className="ce-x4">Cargando...</div>
        ) : (
          <div className="ce-x5">
            {/* LOGO */}
            <div className="ce-x6">
              <div className="ce-x7">
                {logoMostrado ? (
                  <img className="ce-x8" src={logoMostrado} alt="Logo" />
                ) : (
                  <div className="ce-x9" />
                )}
              </div>
              <div className="ce-x10">
                <div className="ce-x11">Logo de la empresa</div>
                <div className="ce-x12">Aparecerá en el menú y en los documentos PDF. Recomendado: imagen cuadrada (PNG/JPG).</div>
                {/* ✅ V00451: carga compartida (Ver, Reemplazar, ×); se sube al guardar */}
                <AdjuntosArchivos etiqueta="" max={1} tipos="imagen" previaCerrada adjuntos={adjuntosLogo} onCambiar={setLogoElegido} deshabilitado={guardando} />
              </div>
            </div>

            {/* CAMPOS */}
            <div className="ce-x16">
              <div className="ce-x17">
                <label style={labelStyle}>Nombre de la empresa <span className="ce-x18">*</span></label>
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

              <div className="ce-x17">
                <label style={labelStyle}>Sitio web</label>
                <input type="url" style={inputStyle} value={form.sitioWeb || ''} onChange={(e) => handleChange('sitioWeb', e.target.value)} placeholder="https://..." />
              </div>

              <div className="ce-x17">
                <label style={labelStyle}>Dirección</label>
                <textarea style={{ ...inputStyle, minHeight: '70px', resize: 'vertical' }} value={form.direccion || ''} onChange={(e) => handleChange('direccion', e.target.value)} placeholder="Calle, número, colonia, ciudad, estado, C.P., país" />
              </div>

              <div className="ce-x17">
                <label style={labelStyle}>Notas / Información adicional</label>
                <textarea style={{ ...inputStyle, minHeight: '70px', resize: 'vertical' }} value={form.notas || ''} onChange={(e) => handleChange('notas', e.target.value)} />
              </div>
            </div>

            {/* ACCIONES */}
            <div className="ce-x19">
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