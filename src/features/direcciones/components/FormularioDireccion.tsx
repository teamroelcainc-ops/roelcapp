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

// ✅ Jerarquía de catálogos de dirección. Cada nivel conoce su colección de
//   Firestore, el campo donde vive el nombre y el campo que referencia al padre.
type NivelKey = 'pais' | 'estado' | 'municipio' | 'colonia' | 'cp' | 'calle';
const NIVELES: Record<NivelKey, {
  label: string;
  coleccion: string;
  campoNombre: string;      // campo del documento donde va el texto (nombre/estado/municipio...)
  padre: NivelKey | null;   // nivel padre en la jerarquía
  campoPadre: string;       // campo del documento que guarda el id del padre
  keyId: keyof DireccionRecord;
  keyNombre: keyof DireccionRecord;
}> = {
  pais:      { label: 'País',          coleccion: 'catalogo_paises',        campoNombre: 'nombre',        padre: null,        campoPadre: '',              keyId: 'paisId',      keyNombre: 'paisNombre' },
  estado:    { label: 'Estado',        coleccion: 'catalogo_estados',       campoNombre: 'estado',        padre: 'pais',      campoPadre: 'pais',          keyId: 'estadoId',    keyNombre: 'estadoNombre' },
  municipio: { label: 'Municipio',     coleccion: 'catalogo_municipios',    campoNombre: 'municipio',     padre: 'estado',    campoPadre: 'estado',        keyId: 'municipioId', keyNombre: 'municipioNombre' },
  colonia:   { label: 'Colonia',       coleccion: 'catalogo_colonias',      campoNombre: 'colonia',       padre: 'municipio', campoPadre: 'municipio',     keyId: 'coloniaId',   keyNombre: 'coloniaNombre' },
  cp:        { label: 'Código Postal', coleccion: 'catalogo_codigo_postal', campoNombre: 'codigo_postal', padre: 'colonia',   campoPadre: 'colonia',       keyId: 'cpId',        keyNombre: 'cpNombre' },
  calle:     { label: 'Calle',         coleccion: 'catalogo_calles',        campoNombre: 'calle',         padre: 'cp',        campoPadre: 'codigo_postal', keyId: 'calleId',     keyNombre: 'calleNombre' },
};
const ORDEN_NIVELES: NivelKey[] = ['pais', 'estado', 'municipio', 'colonia', 'cp', 'calle'];

// ✅ Normalización para comparar sin acentos/mayúsculas (evita duplicados
//   tipo "México" vs "mexico" en los catálogos).
const normTexto = (s: any): string =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

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

  // ✅ Texto de búsqueda por nivel (los selects se cambiaron por buscadores).
  const [textos, setTextos] = useState<Record<NivelKey, string>>({
    pais: '', estado: '', municipio: '', colonia: '', cp: '', calle: '',
  });
  // Qué dropdown está abierto ('' = ninguno).
  const [ddAbierto, setDdAbierto] = useState<NivelKey | ''>('');
  // Errores de validación por campo (keyId o numExterior/numInterior).
  const [errores, setErrores] = useState<string[]>([]);

  // ✅ Modal de creación rápida de catálogo (botón "+", como en Operaciones).
  const [modalNuevo, setModalNuevo] = useState<{ nivel: NivelKey; valor: string } | null>(null);
  const [guardandoNuevo, setGuardandoNuevo] = useState(false);

  useEffect(() => {
    if (initialData) {
      setFormData(initialData);
      setTextos({
        pais: initialData.paisNombre || '',
        estado: initialData.estadoNombre || '',
        municipio: initialData.municipioNombre || '',
        colonia: initialData.coloniaNombre || '',
        cp: initialData.cpNombre || '',
        calle: initialData.calleNombre || '',
      });
    } else {
      setFormData(estadoInicial);
      setTextos({ pais: '', estado: '', municipio: '', colonia: '', cp: '', calle: '' });
    }
    setErrores([]);
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

  // ── Listas crudas y setters por nivel ────────────────────────────────────
  const listasPorNivel: Record<NivelKey, any[]> = {
    pais: paises, estado: estadosDB, municipio: municipios,
    colonia: colonias, cp: cps, calle: calles,
  };
  const settersPorNivel: Record<NivelKey, React.Dispatch<React.SetStateAction<any[]>>> = {
    pais: setPaises, estado: setEstadosDB, municipio: setMunicipios,
    colonia: setColonias, cp: setCps, calle: setCalles,
  };

  // ✅ Opciones {id, nombre} de un nivel, filtradas por su padre seleccionado
  //   y ordenadas alfabéticamente.
  const opcionesDeNivel = (nivel: NivelKey): { id: string; nombre: string }[] => {
    const cfg = NIVELES[nivel];
    const lista = listasPorNivel[nivel] || [];
    const idPadre = cfg.padre ? String(formData[NIVELES[cfg.padre].keyId] || '') : '';
    const filtrada = cfg.padre
      ? lista.filter((x: any) => String(x[cfg.campoPadre] || '') === idPadre)
      : lista;
    return filtrada
      .map((x: any) => ({ id: String(x.id), nombre: String(x[cfg.campoNombre] ?? '') }))
      .filter(o => o.nombre)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base', numeric: true }));
  };

  // Padre seleccionado (id y nombre) para un nivel; '' si no aplica o falta.
  const padreSeleccionado = (nivel: NivelKey): { id: string; nombre: string; label: string } | null => {
    const padre = NIVELES[nivel].padre;
    if (!padre) return null;
    return {
      id: String(formData[NIVELES[padre].keyId] || ''),
      nombre: String(formData[NIVELES[padre].keyNombre] || ''),
      label: NIVELES[padre].label,
    };
  };

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

  // ✅ Selecciona una opción de un nivel: fija id + nombre y limpia TODOS los
  //   niveles hijos (id, nombre y texto de búsqueda) para mantener la
  //   jerarquía consistente.
  const seleccionarNivel = (nivel: NivelKey, op: { id: string; nombre: string }) => {
    const idx = ORDEN_NIVELES.indexOf(nivel);
    const hijos = ORDEN_NIVELES.slice(idx + 1);
    setFormData(prev => {
      const nuevo: any = { ...prev };
      nuevo[NIVELES[nivel].keyId] = op.id;
      nuevo[NIVELES[nivel].keyNombre] = op.nombre;
      hijos.forEach(h => { nuevo[NIVELES[h].keyId] = ''; nuevo[NIVELES[h].keyNombre] = ''; });
      return nuevo;
    });
    setTextos(prev => {
      const nuevo = { ...prev, [nivel]: op.nombre };
      hijos.forEach(h => { nuevo[h] = ''; });
      return nuevo;
    });
    setErrores(prev => prev.filter(e => e !== String(NIVELES[nivel].keyId)));
    setDdAbierto('');
  };

  // ✅ Al escribir en el buscador: guarda el texto y, si había una selección
  //   previa que ya no coincide, la limpia junto con los hijos.
  const escribirNivel = (nivel: NivelKey, texto: string) => {
    setTextos(prev => ({ ...prev, [nivel]: texto }));
    setDdAbierto(nivel);
    const nombreActual = String(formData[NIVELES[nivel].keyNombre] || '');
    if (nombreActual && normTexto(nombreActual) !== normTexto(texto)) {
      const idx = ORDEN_NIVELES.indexOf(nivel);
      const aLimpiar = ORDEN_NIVELES.slice(idx);
      setFormData(prev => {
        const nuevo: any = { ...prev };
        aLimpiar.forEach(h => { nuevo[NIVELES[h].keyId] = ''; nuevo[NIVELES[h].keyNombre] = ''; });
        return nuevo;
      });
      setTextos(prev => {
        const nuevo = { ...prev, [nivel]: texto };
        ORDEN_NIVELES.slice(idx + 1).forEach(h => { nuevo[h] = ''; });
        return nuevo;
      });
    }
  };

  // ✅ Al salir del campo: si el texto coincide EXACTO (sin acentos/mayúsculas)
  //   con una sola opción, se auto-selecciona para evitar errores por no dar
  //   clic en la lista.
  const blurNivel = (nivel: NivelKey) => {
    setTimeout(() => {
      setDdAbierto(prev => (prev === nivel ? '' : prev));
      const yaSeleccionado = String(formData[NIVELES[nivel].keyId] || '');
      const texto = normTexto(textos[nivel]);
      if (yaSeleccionado || !texto) return;
      const coincidencias = opcionesDeNivel(nivel).filter(o => normTexto(o.nombre) === texto);
      if (coincidencias.length === 1) seleccionarNivel(nivel, coincidencias[0]);
    }, 200);
  };

  // ✅ Guardar un registro nuevo de catálogo desde el modal "+".
  //   · Requiere que el padre esté seleccionado (excepto País).
  //   · Si ya existe uno igual (normalizado) bajo el mismo padre, NO duplica:
  //     selecciona el existente.
  const guardarNuevoCatalogo = async () => {
    if (!modalNuevo) return;
    const { nivel } = modalNuevo;
    const cfg = NIVELES[nivel];
    const valor = String(modalNuevo.valor || '').trim();
    if (!valor) { alert(`Escribe el ${cfg.label} a agregar.`); return; }
    const padre = padreSeleccionado(nivel);
    if (cfg.padre && (!padre || !padre.id)) {
      alert(`Primero selecciona ${NIVELES[cfg.padre].label} para poder agregar ${cfg.label}.`);
      return;
    }
    // Anti-duplicados bajo el mismo padre.
    const existente = opcionesDeNivel(nivel).find(o => normTexto(o.nombre) === normTexto(valor));
    if (existente) {
      seleccionarNivel(nivel, existente);
      setModalNuevo(null);
      return;
    }
    setGuardandoNuevo(true);
    try {
      const docNuevo: any = { [cfg.campoNombre]: valor };
      if (cfg.padre && padre) docNuevo[cfg.campoPadre] = padre.id;
      const ref = await addDoc(collection(db, cfg.coleccion), docNuevo);
      // Actualiza la lista local y selecciona el nuevo registro.
      settersPorNivel[nivel](prev => [...prev, { id: ref.id, ...docNuevo }]);
      seleccionarNivel(nivel, { id: ref.id, nombre: valor });
      setModalNuevo(null);
    } catch (error) {
      console.error(`Error agregando ${cfg.label}:`, error);
      alert(`No se pudo agregar ${cfg.label}. Revisa tu conexión.`);
    } finally {
      setGuardandoNuevo(false);
    }
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

    // ✅ Resolución de textos pendientes: si el usuario escribió pero no dio
    //   clic en la lista, se intenta el match exacto antes de validar.
    let datos: any = { ...formData };
    ORDEN_NIVELES.forEach(nivel => {
      const cfg = NIVELES[nivel];
      if (!datos[cfg.keyId] && normTexto(textos[nivel])) {
        const match = opcionesDeNivel(nivel).find(o => normTexto(o.nombre) === normTexto(textos[nivel]));
        if (match) { datos[cfg.keyId] = match.id; datos[cfg.keyNombre] = match.nombre; }
      }
    });

    // ✅ Validación manual (los buscadores no soportan "required" nativo).
    const faltantes: string[] = [];
    const mensajes: string[] = [];
    ORDEN_NIVELES.forEach(nivel => {
      const cfg = NIVELES[nivel];
      const keyId = String(cfg.keyId);
      const tieneId = !!datos[cfg.keyId];
      const tieneTexto = !!normTexto(textos[nivel]);
      if (esObligatorio(keyId) && !tieneId) {
        faltantes.push(keyId);
        mensajes.push(tieneTexto
          ? `${cfg.label}: "${textos[nivel]}" no está en el catálogo. Selecciónalo de la lista o agrégalo con el botón +.`
          : `${cfg.label} es obligatorio.`);
      } else if (!esObligatorio(keyId) && !tieneId && tieneTexto) {
        // Texto suelto en un campo opcional: también hay que resolverlo para no guardar basura.
        faltantes.push(keyId);
        mensajes.push(`${cfg.label}: "${textos[nivel]}" no está en el catálogo. Selecciónalo de la lista, agrégalo con el botón + o borra el texto.`);
      }
    });
    if (esObligatorio('numExterior') && !String(datos.numExterior || '').trim()) {
      faltantes.push('numExterior'); mensajes.push('# Exterior es obligatorio.');
    }
    if (esObligatorio('numInterior') && !String(datos.numInterior || '').trim()) {
      faltantes.push('numInterior'); mensajes.push('# Interior es obligatorio.');
    }
    setErrores(faltantes);
    if (faltantes.length) {
      alert('Revisa la dirección antes de guardar:\n\n' + mensajes.join('\n'));
      return;
    }

    setCargando(true);
    try {
      datos.numExterior = String(datos.numExterior || '').trim();
      datos.numInterior = String(datos.numInterior || '').trim();
      datos.direccionCompleta = construirDireccionCompleta(datos);
      const dataToSave = { ...datos };

      if (formData.id) {
        await updateDoc(doc(db, 'direcciones', formData.id), dataToSave);
      } else {
        delete dataToSave.id;
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

  // ── Estilos compartidos de los buscadores ────────────────────────────────
  const estiloInput = (conError: boolean): React.CSSProperties => ({
    backgroundColor: '#010409',
    border: `1px solid ${conError ? '#f85149' : '#30363d'}`,
    color: '#c9d1d9',
    width: '100%',
    boxSizing: 'border-box',
  });
  const estiloDropdown: React.CSSProperties = {
    position: 'absolute', top: '100%', left: 0, right: 0,
    backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '6px',
    zIndex: 20, maxHeight: '220px', overflowY: 'auto', marginTop: '2px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  };
  const estiloBotonMas: React.CSSProperties = {
    flexShrink: 0, width: '38px', height: '38px', display: 'inline-flex',
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#D84315',
    color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer',
    fontSize: '1.3rem', fontWeight: 'bold', lineHeight: 1,
  };

  // ✅ Campo de búsqueda con dropdown + botón "+" (patrón de Operaciones).
  const renderCampoBusqueda = (nivel: NivelKey) => {
    const cfg = NIVELES[nivel];
    const keyId = String(cfg.keyId);
    const padre = padreSeleccionado(nivel);
    const bloqueado = !!cfg.padre && !(padre && padre.id);
    const conError = errores.includes(keyId);
    const opciones = opcionesDeNivel(nivel);
    const q = normTexto(textos[nivel]);
    const seleccionadoId = String(formData[cfg.keyId] || '');
    const filtradas = q && !seleccionadoId
      ? opciones.filter(o => normTexto(o.nombre).includes(q))
      : opciones;
    const tituloMas = bloqueado
      ? `Selecciona ${cfg.padre ? NIVELES[cfg.padre].label : ''} primero`
      : `Agregar nuevo ${cfg.label}`;

    return (
      <div className="form-group" key={nivel}>
        <label className="form-label" style={{ color: conError ? '#f85149' : '#8b949e', fontSize: '0.85rem' }}>
          {cfg.label}{esObligatorio(keyId) ? ' *' : ''}
        </label>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <input
              type="text"
              className="form-control"
              placeholder={bloqueado ? `Selecciona ${cfg.padre ? NIVELES[cfg.padre].label : ''} primero...` : `Buscar ${cfg.label.toLowerCase()}...`}
              value={textos[nivel]}
              disabled={bloqueado}
              onChange={(e) => escribirNivel(nivel, e.target.value)}
              onFocus={() => { if (!bloqueado) setDdAbierto(nivel); }}
              onBlur={() => blurNivel(nivel)}
              style={{ ...estiloInput(conError), opacity: bloqueado ? 0.55 : 1, cursor: bloqueado ? 'not-allowed' : 'text' }}
            />
            {seleccionadoId && !bloqueado && (
              <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', color: '#3fb950', fontSize: '0.85rem', pointerEvents: 'none' }}>✓</span>
            )}
            {ddAbierto === nivel && !bloqueado && (
              <div style={estiloDropdown}>
                {filtradas.length > 0 ? filtradas.map(op => (
                  <div
                    key={op.id}
                    onMouseDown={(e) => { e.preventDefault(); seleccionarNivel(nivel, op); }}
                    style={{ padding: '9px 12px', cursor: 'pointer', borderBottom: '1px solid #21262d', color: op.id === seleccionadoId ? '#58a6ff' : '#c9d1d9', backgroundColor: op.id === seleccionadoId ? '#0d1b2a' : 'transparent', fontSize: '0.9rem' }}
                  >
                    {op.nombre}
                  </div>
                )) : (
                  <div
                    onMouseDown={(e) => { e.preventDefault(); setDdAbierto(''); setModalNuevo({ nivel, valor: textos[nivel] }); }}
                    style={{ padding: '10px 12px', cursor: 'pointer', color: '#fb923c', fontSize: '0.85rem' }}
                  >
                    Sin coincidencias{textos[nivel] ? ` para "${textos[nivel]}"` : ''}. Clic aquí para agregarlo ➕
                  </div>
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            title={tituloMas}
            disabled={bloqueado}
            onClick={() => setModalNuevo({ nivel, valor: seleccionadoId ? '' : textos[nivel] })}
            style={{ ...estiloBotonMas, opacity: bloqueado ? 0.4 : 1, cursor: bloqueado ? 'not-allowed' : 'pointer' }}
          >
            +
          </button>
        </div>
      </div>
    );
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

              {renderCampoBusqueda('pais')}
              {renderCampoBusqueda('estado')}
              {renderCampoBusqueda('municipio')}
              {renderCampoBusqueda('colonia')}
              {renderCampoBusqueda('cp')}
              {renderCampoBusqueda('calle')}

              <div className="form-group">
                <label className="form-label" style={{ color: errores.includes('numExterior') ? '#f85149' : '#8b949e', fontSize: '0.85rem' }}># Exterior{esObligatorio('numExterior') ? ' *' : ''}</label>
                <input type="text" className="form-control" value={formData.numExterior || ''} onChange={(e) => { setFormData({...formData, numExterior: e.target.value}); setErrores(prev => prev.filter(x => x !== 'numExterior')); }} style={estiloInput(errores.includes('numExterior'))} />
              </div>
              <div className="form-group">
                <label className="form-label" style={{ color: errores.includes('numInterior') ? '#f85149' : '#8b949e', fontSize: '0.85rem' }}># Interior{esObligatorio('numInterior') ? ' *' : ''}</label>
                <input type="text" className="form-control" value={formData.numInterior || ''} onChange={(e) => { setFormData({...formData, numInterior: e.target.value}); setErrores(prev => prev.filter(x => x !== 'numInterior')); }} style={estiloInput(errores.includes('numInterior'))} />
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

    {/* ✅ Modal de creación rápida de catálogo (botón "+") */}
    {modalNuevo && (
      <div className="modal-overlay" style={{ backdropFilter: 'blur(4px)', zIndex: 2400, position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <div className="form-card" style={{ maxWidth: '420px', width: '95%', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px' }}>
          <div className="form-header" style={{ padding: '20px 24px', borderBottom: '1px solid #30363d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.1rem' }}>Nuevo {NIVELES[modalNuevo.nivel].label}</h3>
            <button type="button" onClick={() => setModalNuevo(null)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
          </div>
          <div style={{ padding: '20px 24px' }}>
            {(() => {
              const cfg = NIVELES[modalNuevo.nivel];
              const padre = padreSeleccionado(modalNuevo.nivel);
              return (
                <>
                  {cfg.padre && padre && (
                    <div style={{ marginBottom: '14px', padding: '10px 12px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '6px', fontSize: '0.85rem', color: '#8b949e' }}>
                      {NIVELES[cfg.padre].label}: <span style={{ color: '#58a6ff', fontWeight: 600 }}>{padre.nombre || '—'}</span>
                    </div>
                  )}
                  <label className="form-label" style={{ color: '#8b949e', fontSize: '0.85rem', display: 'block', marginBottom: '6px' }}>{cfg.label} *</label>
                  <input
                    type="text"
                    className="form-control"
                    autoFocus
                    placeholder={`Escribe el ${cfg.label.toLowerCase()}...`}
                    value={modalNuevo.valor}
                    onChange={(e) => setModalNuevo(prev => prev ? { ...prev, valor: e.target.value } : prev)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); guardarNuevoCatalogo(); } }}
                    style={{ backgroundColor: '#010409', border: '1px solid #30363d', color: '#c9d1d9', width: '100%', boxSizing: 'border-box' }}
                  />
                  <p style={{ color: '#8b949e', fontSize: '0.78rem', marginTop: '10px', marginBottom: 0 }}>
                    Si ya existe uno igual{cfg.padre && padre?.nombre ? ` en ${padre.nombre}` : ''}, se seleccionará el existente en lugar de duplicarlo.
                  </p>
                </>
              );
            })()}
          </div>
          <div style={{ padding: '16px 24px', borderTop: '1px solid #30363d', display: 'flex', justifyContent: 'flex-end', gap: '12px', backgroundColor: '#161b22', borderBottomLeftRadius: '12px', borderBottomRightRadius: '12px' }}>
            <button type="button" onClick={() => setModalNuevo(null)} style={{ padding: '8px 16px', background: 'transparent', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: '6px', cursor: 'pointer' }}>Cancelar</button>
            <button type="button" onClick={guardarNuevoCatalogo} disabled={guardandoNuevo} style={{ padding: '8px 20px', backgroundColor: '#D84315', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>
              {guardandoNuevo ? 'Guardando...' : 'Agregar'}
            </button>
          </div>
        </div>
      </div>
    )}

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