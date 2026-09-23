// src/features/empresas/components/FormularioEmpresa.tsx
import React, { useState, useEffect, useRef } from 'react';
import { obtenerCacheMemoria, guardarCacheMemoria } from '../../../utils/cacheMemoria'; // ✅ V00269
import { propagarMonedaEmpresa } from '../services/propagarMoneda';
import { ModalAccesoCampo } from '../../autorizaciones/ModalAccesoCampo';
import { useAutorizacionesCampos } from '../../autorizaciones/useAutorizacionesCampos';
import { collection, getDocs, onSnapshot, addDoc, query, where, writeBatch } from 'firebase/firestore';
import { db, agregarRegistro, actualizarRegistro } from '../../../config/firebase';
import { FormularioDireccion } from '../../direcciones/components/FormularioDireccion'; 
import { registrarLog } from '../../../utils/logger'; 
import { DocumentoUploadModal } from '../../documentos/DocumentoUploadModal';
import './FormularioEmpresa.css';

// Tipos de documento que se manejan para EMPRESAS / CLIENTES (edítalos a tu gusto)
export const TIPOS_DOCUMENTO_EMPRESA = [
  '1. Constancia de Situación Fiscal (RFC)',
  '2. Comprobante de Domicilio',
  '3. Acta Constitutiva',
  '4. Poder Notarial del Representante',
  '5. Identificación del Representante Legal',
  '6. Cédula de Identificación Fiscal',
  '7. Opinión de Cumplimiento (SAT)',
  '8. Carátula Bancaria / Estado de Cuenta',
  '9. Contrato de Servicio',
  '10. Orden de Compra',
  '11. Carta de Crédito',
  '12. W-9 / W-8BEN-E (Tax ID USA)',
  '13. Comprobante de Pago',
  '14. Factura',
  '15. Otro',
];

// ✅ ID del tipo de empresa "Cliente (Paga)" en el catálogo catalogo_tipo_empresa.
//    En la base de datos, las empresas guardan su tiposEmpresa con ESTE id (no
//    con el texto). Es el mismo id que usa FormularioOperacion.tsx.
const ID_TIPO_CLIENTE_PAGA = '7eec9cbb';

// =========================================
// SUB-COMPONENTE: SELECTOR MULTIPLE CON CHECKBOXES
// =========================================
const MultiSelectCheckbox: React.FC<{
  options: string[];
  selectedValues: string[];
  onChange: (newValues: string[]) => void;
  placeholder?: string;
}> = ({ options, selectedValues, onChange, placeholder = "Seleccionar..." }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleToggle = (option: string) => {
    if (selectedValues.includes(option)) {
      onChange(selectedValues.filter(v => v !== option));
    } else {
      onChange([...selectedValues, option]);
    }
  };

  // ✅ CORRECCIÓN: Mostrar los nombres seleccionados en lugar del conteo
  const displayText = selectedValues.length > 0 
    ? selectedValues.join(', ') 
    : placeholder;

  return (
    <div className="fe-x1" ref={containerRef}>
      <div 
        onClick={() => setIsOpen(!isOpen)}
        className="form-control"
        style={{
          cursor: 'pointer', border: isOpen ? '1px solid #3b82f6' : '1px solid #30363d',
          backgroundColor: '#010409', color: selectedValues.length > 0 ? '#c9d1d9' : '#8b949e',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', userSelect: 'none',
          padding: '10px'
        }}
      >
        {/* Agregado overflow hidden para que textos muy largos no rompan la caja */}
        <span className="fe-x2">
          {displayText}
        </span>
        <span className="fe-x3">{isOpen ? '▲' : '▼'}</span>
      </div>
      
      {isOpen && (
        <div className="fe-x4">
          {options.map(opt => (
            <label className="fe-x5" 
              key={opt}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#21262d'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <input className="fe-x6" 
                type="checkbox" 
                checked={selectedValues.includes(opt)}
                onChange={() => handleToggle(opt)}
              />
              {opt}
            </label>
          ))}
        </div>
      )}
    </div>
  );
};

// =========================================
// SUB-COMPONENTE: SELECTOR MULTIPLE CON BUSCADOR (id/label) + CHIPS
// Para campos como "Cliente que Paga (Relacionado)" donde se puede
// seleccionar varios registros y la lista puede ser larga.
// =========================================
const MultiSearchableSelect: React.FC<{
  options: { id: string, label: string }[];
  selectedIds: string[];
  onChange: (ids: string[], labels: string[]) => void;
  placeholder?: string;
}> = ({ options, selectedIds, onChange, placeholder = "Buscar..." }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const seleccionados = options.filter(o => selectedIds.includes(o.id));
  const filtrados = options.filter(o => o.label.toLowerCase().includes(searchTerm.toLowerCase()));

  const emitir = (nuevosIds: string[]) => {
    const labels = options.filter(o => nuevosIds.includes(o.id)).map(o => o.label);
    onChange(nuevosIds, labels);
  };

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) emitir(selectedIds.filter(x => x !== id));
    else emitir([...selectedIds, id]);
  };

  const quitar = (id: string) => emitir(selectedIds.filter(x => x !== id));

  return (
    <div className="fe-x1" ref={containerRef}>
      {/* Chips de seleccionados */}
      {seleccionados.length > 0 && (
        <div className="fe-x7">
          {seleccionados.map(s => (
            <span className="fe-x8" key={s.id}>
              {s.label}
              <button className="fe-x9" type="button" onClick={() => quitar(s.id)} title="Quitar">✕</button>
            </span>
          ))}
        </div>
      )}

      <div
        onClick={() => setIsOpen(!isOpen)}
        className="form-control"
        style={{
          cursor: 'pointer', border: isOpen ? '1px solid #3b82f6' : '1px solid #30363d',
          backgroundColor: '#010409', color: '#8b949e',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', userSelect: 'none',
          padding: '10px'
        }}
      >
        <span>{selectedIds.length > 0 ? `${selectedIds.length} cliente(s) seleccionado(s)` : placeholder}</span>
        <span className="fe-x3">{isOpen ? '▲' : '▼'}</span>
      </div>

      {isOpen && (
        <div className="fe-x10">
          <div className="fe-x11">
            <input className="fe-x12"
              type="text"
              autoFocus
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar cliente..."
            />
          </div>
          {filtrados.length > 0 ? filtrados.map(opt => (
            <label className="fe-x5"
              key={opt.id}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#21262d'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <input className="fe-x6"
                type="checkbox"
                checked={selectedIds.includes(opt.id)}
                onChange={() => toggle(opt.id)}
              />
              {opt.label}
            </label>
          )) : (
            <div className="fe-x13">
              No se encontraron coincidencias
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// =========================================
// SUB-COMPONENTE: SELECTOR CON BUSCADOR ESTRICTO
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
    <div className="fe-x1">
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
          setTimeout(() => {
            setIsOpen(false);
            const match = options.find(o => o.label.toLowerCase() === searchTerm.toLowerCase());
            if (!match && searchTerm !== selectedLabel) {
               setSearchTerm(selectedLabel);
            }
          }, 200);
        }}
        required={required && !value} 
        style={{
          cursor: 'text', border: isOpen ? '1px solid #3b82f6' : '1px solid #30363d',
          backgroundColor: '#010409', color: '#c9d1d9', padding: '10px'
        }}
      />
      
      {isOpen && (
        <ul className="fe-x14">
          {filteredOptions.length > 0 ? (
            filteredOptions.map(opt => (
              <li className="fe-x15"
                key={opt.id}
                onClick={() => {
                  onChange(opt.id, opt.label);
                  setSearchTerm(opt.label);
                  setIsOpen(false);
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#21262d'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                {opt.label}
              </li>
            ))
          ) : (
            <li className="fe-x16">
              No se encontraron coincidencias
            </li>
          )}
        </ul>
      )}
    </div>
  );
};

// =========================================
// SUB-COMPONENTE: MODAL NUEVO RÉGIMEN FISCAL
// =========================================
const ModalNuevoRegimen: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const [clave, setClave] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [guardando, setGuardando] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardando(true);
    try {
      await addDoc(collection(db, 'catalogo_regimen_fiscal'), { clave, descripcion });
      await registrarLog('Catálogos', 'Creación', `Se agregó el régimen fiscal: ${clave} - ${descripcion}`);
      onClose();
    } catch (error) {
      alert("Error al guardar el régimen fiscal.");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="modal-overlay fe-x17">
      <div className="form-card fe-x18">
        <div className="form-header fe-x19">
          <h3 className="fe-x20">Nuevo Régimen Fiscal</h3>
          <button onClick={onClose} className="close-x fe-x21">✕</button>
        </div>
        <form className="fe-x22" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Clave (Ej. 601) *</label>
            <input type="text" className="form-control" value={clave} onChange={e => setClave(e.target.value)} required />
          </div>
          <div className="form-group">
            <label className="form-label">Descripción *</label>
            <input type="text" className="form-control" value={descripcion} onChange={e => setDescripcion(e.target.value)} required />
          </div>
          <div className="fe-x23">
            <button type="button" onClick={onClose} className="btn btn-outline fe-x24">Cancelar</button>
            <button type="submit" className="btn btn-primary fe-x25" disabled={guardando}>{guardando ? 'Guardando...' : 'Guardar'}</button>
          </div>
        </form>
      </div>
    </div>
  );
};

// =========================================
// COMPONENTE PRINCIPAL
// =========================================
interface FormProps {
  estado: 'abierto' | 'minimizado';
  initialData?: any | null;
  registros: any[];
  onClose: () => void;
  onMinimize: () => void;
  onRestore: () => void;
  // ✅ Tipo de empresa que llega pre-marcado cuando el formulario se abre desde
  //   otro módulo (ej. el botón + de "Cliente (Mercancía)" en Operaciones).
  tipoEmpresaPreseleccionado?: string;
}

// ✅ V00329: velo de campo bloqueado por Autorizaciones — a nivel de módulo
//   para que su identidad sea estable y React NO remonte los controles
//   envueltos en cada render (los inputs conservan el foco al escribir).
// ✅ V00331: algunos controles usan un name distinto a la clave registrada en
//   Autorizaciones — este mapa los traduce.
const NAME_A_CLAVE_AUT: Record<string, string> = { rfcTaxId: 'rfc', condicionPago: 'creditoContado' };
// Y cada clave del registro corresponde a estos campos del formulario (para
//   saber si su valor realmente cambió).
const CAMPOS_FORM_DE_CLAVE_AUT: Record<string, string[]> = { rfc: ['rfcTaxId'], creditoContado: ['condicionPago'], regimenFiscal: ['regimenFiscalId', 'regimenFiscalLabel'] };

const BloqueoAut = ({ bloqueado, titulo, onSolicitar, children }: { bloqueado: boolean; titulo: string; onSolicitar: () => void; children: React.ReactNode }) => {
  if (!bloqueado) return <>{children}</>;
  return (
    <div className="fe-aut-bloq" title={titulo} onMouseDownCapture={(e) => { e.preventDefault(); e.stopPropagation(); onSolicitar(); }}>
      <span className="fe-aut-bloq-velo">🔒</span>
      <div className="fe-aut-bloq-contenido">{children}</div>
    </div>
  );
};

export const FormularioEmpresa: React.FC<FormProps> = ({ estado, initialData, registros, onClose, onMinimize, onRestore, tipoEmpresaPreseleccionado }) => {
  const [cargando, setCargando] = useState(false);
  const [activeTab, setActiveTab] = useState<'general' | 'fiscal' | 'contacto'>('general');
  
  const [regimenesFiscales, setRegimenesFiscales] = useState<{id: string, label: string}[]>([]);
  const [direccionesDB, setDireccionesDB] = useState<any[]>([]);
  const [monedas, setMonedas] = useState<any[]>([]);
  const [tiposFacturas, setTiposFacturas] = useState<any[]>([]);
  
  const [catalogoTiposEmpresa, setCatalogoTiposEmpresa] = useState<string[]>([]);
  const [catalogoTiposServicio, setCatalogoTiposServicio] = useState<string[]>([]);
  // ✅ Catálogos completos {id, nombre}: en la interfaz se trabaja con NOMBRES,
  //   pero en Firestore se guardan los IDs del catálogo (que es lo que filtran
  //   los buscadores del formulario de Operaciones).
  const [catTiposEmpresaFull, setCatTiposEmpresaFull] = useState<{ id: string; nombre: string }[]>([]);
  const [catTiposServicioFull, setCatTiposServicioFull] = useState<{ id: string; nombre: string }[]>([]);

  const [modalDireccionAbierto, setModalDireccionAbierto] = useState(false);
  // ✅ V00268: selección temporal del buscador de cada bloque "Dirección {tipo}".
  const [dirTipoSeleccion, setDirTipoSeleccion] = useState<Record<string, { id: string; label: string }>>({});
  const agregarDireccionTipo = (tipoNombre: string) => {
    const sel = dirTipoSeleccion[tipoNombre];
    if (!sel || !sel.id) return;
    setFormData(prev => {
      const ya = (prev.direccionesPorTipo || []).some(d => d.tipoNombre === tipoNombre && String(d.direccionId) === String(sel.id));
      if (ya) return prev; // sin duplicados del mismo tipo+dirección
      return { ...prev, direccionesPorTipo: [...(prev.direccionesPorTipo || []), { tipoNombre, direccionId: sel.id, direccionNombre: sel.label }] };
    });
    setDirTipoSeleccion(prev => ({ ...prev, [tipoNombre]: { id: '', label: '' } }));
  };
  const quitarDireccionTipo = (tipoNombre: string, direccionId: string) => {
    setFormData(prev => ({ ...prev, direccionesPorTipo: (prev.direccionesPorTipo || []).filter(d => !(d.tipoNombre === tipoNombre && String(d.direccionId) === String(direccionId))) }));
  };
  const [modalRegimenAbierto, setModalRegimenAbierto] = useState(false);
  const [mostrarSubirDoc, setMostrarSubirDoc] = useState(false);

  const [formData, setFormData] = useState({
    numCliente: '',
    nombre: '',
    nombreCorto: '',
    status: 'Activa',
    fechaBaja: '', 
    observacionesBaja: '', 
    tiposEmpresa: [] as string[], 
    tiposServicio: [] as string[], 
    // ✅ Ahora se pueden relacionar VARIOS clientes que pagan
    clienteRelacionadoIds: [] as string[], 
    clienteRelacionadoNombres: [] as string[], 
    rfcTaxId: '',
    fechaUltimoServicio: '',
    
    regimenFiscalId: '',
    regimenFiscalLabel: '',
    moneda: '', 
    tipoFactura: '', 
    condicionPago: 'Crédito',
    diasCredito: 30,
    limiteCredito: 0.00,

    direccionId: '',
    direccionLabel: '',
    // ✅ V00268: DIRECCIONES MÚLTIPLES etiquetadas por tipo de empresa —
    //   si la empresa es Cliente (Mercancía) Y Bodega, puede capturar varias
    //   "Dirección Cliente (Mercancía)" y varias "Dirección Bódega", todas
    //   del Directorio de Direcciones (relacional: se guarda el ID + nombre).
    direccionesPorTipo: [] as { tipoNombre: string; direccionId: string; direccionNombre: string }[],
    maps: '', 
    telefono: '',
    correo: ''
  });

  useEffect(() => {
    // ✅ V00269: EDITAR/ABRIR RÁPIDO — el formulario se monta en cada apertura
    //   y antes esperaba TODAS sus colecciones desde cero (por eso los selects
    //   salían vacíos unos segundos y "la información no estaba"). Ahora cada
    //   catálogo se SIEMBRA desde el caché del módulo (últimos datos conocidos,
    //   pintado instantáneo) y el snapshot en vivo lo actualiza y re-cachea.
    const sembrar = <T,>(clave: string, setter: (v: T) => void) => {
      const c = obtenerCacheMemoria<T>(clave, 10 * 60 * 1000);
      if (c) setter(c);
    };
    sembrar<{ id: string; label: string }[]>('fe_cat_regimenes', setRegimenesFiscales);
    sembrar<Record<string, unknown>[]>('fe_cat_direcciones', setDireccionesDB as (v: Record<string, unknown>[]) => void);
    sembrar<Record<string, unknown>[]>('fe_cat_tipos_factura', setTiposFacturas as (v: Record<string, unknown>[]) => void);

    const unsubRegimenes = onSnapshot(collection(db, 'catalogo_regimen_fiscal'), (snap) => {
      const lista = snap.docs.map(doc => {
        const d = doc.data();
        return { id: doc.id, label: `${d.clave} - ${d.descripcion}` };
      });
      guardarCacheMemoria('fe_cat_regimenes', lista);
      setRegimenesFiscales(lista);
    });

    const unsubDirecciones = onSnapshot(collection(db, 'direcciones'), (snap) => {
      const lista = snap.docs.map(doc => {
        const d: any = doc.data();
        // ✅ Se conservan TODOS los campos estructurados (país, estado, colonia,
        //   calle, C.P., números) para mostrarlos separados en el formulario.
        return { id: doc.id, label: d.direccionCompleta || 'Dirección sin formato', ...d };
      });
      guardarCacheMemoria('fe_cat_direcciones', lista);
      setDireccionesDB(lista);
    });

    const unsubFacturas = onSnapshot(collection(db, 'catalogo_tipo_factura'), (snap) => {
      const lista = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      guardarCacheMemoria('fe_cat_tipos_factura', lista);
      setTiposFacturas(lista);
    });

    const fetchTiposLists = async () => {
      try {
        // ✅ V00269: siembra instantánea de tipos y monedas desde el caché.
        const cE = obtenerCacheMemoria<{ id: string; nombre: string }[]>('fe_cat_tipos_empresa', 10 * 60 * 1000);
        if (cE) { setCatTiposEmpresaFull(cE); setCatalogoTiposEmpresa(cE.map(x => x.nombre)); }
        const cS = obtenerCacheMemoria<{ id: string; nombre: string }[]>('fe_cat_tipos_servicio', 10 * 60 * 1000);
        if (cS) { setCatTiposServicioFull(cS); setCatalogoTiposServicio(cS.map(x => x.nombre)); }
        const cM = obtenerCacheMemoria<Record<string, unknown>[]>('fe_cat_monedas', 10 * 60 * 1000) as never[] | null;
        if (cM) setMonedas(cM);
        const tEmpresas = await getDocs(collection(db, 'catalogo_tipo_empresa'));
        const emp = tEmpresas.docs
          .map(doc => ({ id: doc.id, nombre: String((doc.data() as any).tipo || '') }))
          .filter(x => x.nombre);
        guardarCacheMemoria('fe_cat_tipos_empresa', emp); // ✅ V00269
        setCatTiposEmpresaFull(emp);
        setCatalogoTiposEmpresa(emp.map(x => x.nombre));

        const tServicios = await getDocs(collection(db, 'catalogo_tipo_servicio'));
        const serv = tServicios.docs
          .map(doc => ({ id: doc.id, nombre: String((doc.data() as any).nombre || '') }))
          .filter(x => x.nombre);
        guardarCacheMemoria('fe_cat_tipos_servicio', serv); // ✅ V00269
        setCatTiposServicioFull(serv);
        setCatalogoTiposServicio(serv.map(x => x.nombre));

        const monedaSnap = await getDocs(collection(db, 'catalogo_moneda'));
        const listaMon = monedaSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        guardarCacheMemoria('fe_cat_monedas', listaMon); // ✅ V00269
        setMonedas(listaMon);
      } catch (error) {
        console.error("Error cargando catálogos secundarios", error);
      }
    };

    fetchTiposLists();

    return () => {
      unsubRegimenes();
      unsubDirecciones();
      unsubFacturas();
    };
  }, []);

  // ✅ Conversión entre NOMBRES (interfaz) e IDs (Firestore) de los catálogos.
  const idTipoEmpresaDeNombre = (nombre: string) => catTiposEmpresaFull.find(x => x.nombre === nombre)?.id || nombre;
  const nombreTipoEmpresaDeId = (v: string) => catTiposEmpresaFull.find(x => x.id === String(v))?.nombre || v;
  const idTipoServicioDeNombre = (nombre: string) => catTiposServicioFull.find(x => x.nombre === nombre)?.id || nombre;
  const nombreTipoServicioDeId = (v: string) => catTiposServicioFull.find(x => x.id === String(v))?.nombre || v;

  // ✅ Cuando cargan los catálogos, los tipos guardados como ID (formato de la
  //   base) se convierten a nombre para que los checkboxes se marquen bien.
  useEffect(() => {
    if (catTiposEmpresaFull.length === 0 && catTiposServicioFull.length === 0) return;
    setFormData(prev => {
      const tiposEmp = (prev.tiposEmpresa || []).map(v => nombreTipoEmpresaDeId(String(v)));
      const tiposServ = (prev.tiposServicio || []).map(v => nombreTipoServicioDeId(String(v)));
      const cambioEmp = JSON.stringify(tiposEmp) !== JSON.stringify(prev.tiposEmpresa);
      const cambioServ = JSON.stringify(tiposServ) !== JSON.stringify(prev.tiposServicio);
      if (!cambioEmp && !cambioServ) return prev;
      return { ...prev, tiposEmpresa: tiposEmp, tiposServicio: tiposServ };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catTiposEmpresaFull, catTiposServicioFull, initialData]);

  // ✅ V00342: hay empresas con la MONEDA (o tipo de factura) guardada como
  //   NOMBRE ("Dólares") y otras como ID — el select busca por id, por eso
  //   "tenía moneda pero no aparecía" o se veía el ID pelón. En cuanto llegan
  //   los catálogos, el valor se normaliza al ID y el select lo muestra.
  useEffect(() => {
    if (monedas.length === 0 && tiposFacturas.length === 0) return;
    setFormData(prev => {
      const monedasL = monedas as { id?: unknown; moneda?: unknown }[];
      const tiposL = tiposFacturas as { id?: unknown; tipo?: unknown; nombre?: unknown }[];
      let mon = String(prev.moneda || '');
      if (mon && monedasL.length > 0 && !monedasL.some((m) => String(m.id) === mon)) {
        const porNombre = monedasL.find((m) => String(m.moneda || '').trim().toLowerCase() === mon.trim().toLowerCase());
        if (porNombre) mon = String(porNombre.id);
      }
      let tf = String(prev.tipoFactura || '');
      if (tf && tiposL.length > 0 && !tiposL.some((t) => String(t.id) === tf)) {
        const porNombreTf = tiposL.find((t) => String(t.tipo || t.nombre || '').trim().toLowerCase() === tf.trim().toLowerCase());
        if (porNombreTf) tf = String(porNombreTf.id);
      }
      if (mon === String(prev.moneda || '') && tf === String(prev.tipoFactura || '')) return prev;
      return { ...prev, moneda: mon, tipoFactura: tf };
    });
  }, [monedas, tiposFacturas, initialData]);

  // ✅ V00328: FOTO del formulario al abrir (ya normalizado) — sirve para saber
  //   qué campos REALMENTE cambió el usuario al guardar. Sin esto, Autorizaciones
  //   pedía permiso por campos que nadie tocó (ej. Status).
  const formInicialRef = React.useRef<Record<string, unknown> | null>(null);
  useEffect(() => { formInicialRef.current = null; }, [initialData]);
  useEffect(() => {
    setFormData(prev => { formInicialRef.current = { ...prev }; return prev; });
  }, [catTiposEmpresaFull, catTiposServicioFull, initialData]);

  // ✅ Si el formulario se abrió desde otro módulo con un tipo preseleccionado
  //   (ej. "Cliente (Mercancía)" desde Operaciones), se marca de inicio.
  useEffect(() => {
    if (initialData || !tipoEmpresaPreseleccionado) return;
    setFormData(prev => prev.tiposEmpresa.length === 0
      ? { ...prev, tiposEmpresa: [tipoEmpresaPreseleccionado] }
      : prev);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipoEmpresaPreseleccionado, initialData]);

  const generarSiguienteNumCliente = () => {
    if (registros.length === 0) return 'EMP-001';
    const numeros = registros.map(reg => {
      const numStr = (reg.numCliente || '').replace('EMP-', '');
      const num = parseInt(numStr, 10);
      return isNaN(num) ? 0 : num;
    });
    const maxNum = Math.max(...numeros);
    return `EMP-${String(maxNum + 1).padStart(3, '0')}`;
  };

  useEffect(() => {
    if (initialData) {
      const data = { ...initialData };
      if (data.tiposEmpresa && !Array.isArray(data.tiposEmpresa)) data.tiposEmpresa = [data.tiposEmpresa];
      else if (!data.tiposEmpresa) data.tiposEmpresa = [];
      
      if (data.tiposServicio && !Array.isArray(data.tiposServicio)) {
         if(data.tiposServicio === 'Cliente (Mercancía)' || data.tiposServicio === 'Cliente (Paga)') {
           if(!data.tiposEmpresa.includes(data.tiposServicio)) data.tiposEmpresa = [...data.tiposEmpresa, data.tiposServicio];
         }
         data.tiposServicio = []; 
      } else if (!data.tiposServicio) {
        data.tiposServicio = [];
      }
      // ✅ V00268: direcciones por tipo (empresas viejas no traen el campo)
      if (!Array.isArray(data.direccionesPorTipo)) data.direccionesPorTipo = [];

      // ✅ Compatibilidad: convertir el cliente relacionado único (formato viejo)
      // a los nuevos arreglos de selección múltiple.
      if (!Array.isArray(data.clienteRelacionadoIds)) {
        if (data.clienteRelacionadoId) {
          data.clienteRelacionadoIds = [data.clienteRelacionadoId];
          data.clienteRelacionadoNombres = data.clienteRelacionadoNombre ? [data.clienteRelacionadoNombre] : [];
        } else {
          data.clienteRelacionadoIds = [];
          data.clienteRelacionadoNombres = [];
        }
      }
      if (!Array.isArray(data.clienteRelacionadoNombres)) {
        data.clienteRelacionadoNombres = [];
      }

      setFormData(data as any);
    } else {
      setFormData(prev => ({ ...prev, numCliente: generarSiguienteNumCliente() }));
    }
  }, [initialData, registros]);

  // ✅ V00140: este formulario respeta Autorizaciones (campos bloqueados + acciones)
  const aut = useAutorizacionesCampos('empresas');
  // ✅ V00326: el hook conoce el registro abierto — así "Agregar libre"
  //   deja capturar la Moneda (u otro campo) al CREAR y la bloquea al EDITAR.
  const setValoresAut = aut.setValoresActuales;
  useEffect(() => { setValoresAut(initialData ? { ...initialData } : {}); }, [initialData, setValoresAut]);
  // ✅ V00331: la autorización SOLO mira los campos que el USUARIO tocó — lo
  //   que el formulario recalcula solo (catálogos, normalizaciones) no cuenta.
  const camposTocadosRef = React.useRef<Set<string>>(new Set());
  useEffect(() => { camposTocadosRef.current = new Set(); }, [initialData]);
  const tocarCampoAut = (clave: string) => { camposTocadosRef.current.add(clave); };
  // ✅ V00329: helpers del velo de Autorizaciones — el componente BloqueoAut
  //   vive FUERA (identidad estable): definido adentro (V00327) se remontaba en
  //   cada render y los inputs envueltos perdían el foco tras cada letra.
  const autBloq = (k: string) => aut.campoBloqueado(k);
  const autTituloBloq = (k: string) => `"${aut.etiquetas[k] || k}" está bloqueado por Autorizaciones para tu rol — clic para solicitar acceso temporal`;
  const autSolicitar = (k: string) => aut.abrirSolicitudAcceso(k, { docId: String(initialData?.id || ''), referencia: String(formData?.nombre || '') });
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const claveAut = NAME_A_CLAVE_AUT[(e.target as any).name] || (e.target as any).name; // ✅ V00331
    if (aut.campoBloqueado(claveAut)) { aut.abrirSolicitudAcceso(claveAut); return; }
    tocarCampoAut(claveAut); // ✅ V00331
    const { name, value } = e.target;
    
    setFormData(prev => {
      const newData = { ...prev, [name]: value };
      if (name === 'moneda') newData.tipoFactura = '';
      if (name === 'status' && value !== 'Baja') {
        newData.fechaBaja = '';
        newData.observacionesBaja = '';
      }
      return newData;
    });
  };

  const handleTiposEmpresaChange = (nuevosValores: string[]) => {
    setFormData(prev => {
      const newData = { ...prev, tiposEmpresa: nuevosValores };
      if (!nuevosValores.includes('Cliente (Mercancía)')) {
        newData.clienteRelacionadoIds = [];
        newData.clienteRelacionadoNombres = [];
      }
      if (!nuevosValores.includes('Proveedor (Servicios)')) {
        newData.tiposServicio = [];
      }
      return newData;
    });
  };

  const handleTiposServicioChange = (nuevosValores: string[]) => {
    setFormData(prev => ({ ...prev, tiposServicio: nuevosValores }));
  };

  const handleCondicionPagoChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    tocarCampoAut('creditoContado'); // ✅ V00331
    const value = e.target.value;
    setFormData(prev => ({
      ...prev,
      condicionPago: value,
      diasCredito: value === 'Contado' ? 0 : prev.diasCredito,
      limiteCredito: value === 'Contado' ? 0 : prev.limiteCredito
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    // ✅ V00140: reglas de acción (crear/editar) de Autorizaciones
    // ✅ V00331: a la verificación de Autorizaciones van SOLO los campos que el
    //   USUARIO tocó Y cuyo valor realmente cambió respecto del inicial. Lo que
    //   el formulario recalcula por su cuenta jamás dispara autorización.
    const baseAut = (formInicialRef.current || initialData || {}) as Record<string, unknown>;
    const camposModAut = initialData?.id
      ? [...camposTocadosRef.current].filter(k => {
          const camposForm = CAMPOS_FORM_DE_CLAVE_AUT[k] || [k];
          return camposForm.some(c => JSON.stringify((formData as Record<string, unknown>)[c] ?? '') !== JSON.stringify(baseAut[c] ?? ''));
        })
      : Object.keys(formData || {});
    if (!aut.verificarAccion(initialData?.id ? 'editar' : 'crear', camposModAut)) return;
    e.preventDefault();

    if (!formData.nombre || !formData.rfcTaxId) {
      alert("Faltan campos obligatorios en Información General.");
      setActiveTab('general');
      return;
    }

    if (formData.tiposEmpresa.length === 0) {
      alert("Debes seleccionar al menos un Tipo de Empresa.");
      setActiveTab('general');
      return;
    }

    // ✅ NUEVO (V00117) — REGLA OBLIGATORIA: Cliente (Paga) y Proveedor
    //   (Transporte) DEBEN tener moneda y tipo de factura (vienen de los
    //   catálogos de Moneda y Tipo de Facturas). Sin ellos no se guarda.
    const tiposNombres = (formData.tiposEmpresa || []).map((v: string) => nombreTipoEmpresaDeId(String(v)));
    const exigeMonedaFactura = tiposNombres.includes('Cliente (Paga)') || tiposNombres.includes('Proveedor (Transporte)');
    if (exigeMonedaFactura && (!formData.moneda || !formData.tipoFactura)) {
      alert('Los Clientes (Paga) y Proveedores (Transporte) deben tener OBLIGATORIAMENTE Moneda y Tipo de Factura.\n\nComplétalos en la pestaña Fiscal / Facturación antes de guardar.');
      setActiveTab('fiscal');
      return;
    }

    // ✅ Si es Cliente (Mercancía), exige al menos un cliente que paga relacionado.
    if (formData.tiposEmpresa.includes('Cliente (Mercancía)') && formData.clienteRelacionadoIds.length === 0) {
      alert("Debes relacionar al menos un Cliente que Paga.");
      setActiveTab('general');
      return;
    }

    if (formData.status === 'Baja' && (!formData.fechaBaja || !formData.observacionesBaja)) {
      alert("Si la empresa está dada de Baja, debes especificar la fecha y las observaciones.");
      setActiveTab('general');
      return;
    }

    setCargando(true);
    try {
      // ✅ En Firestore los tipos se guardan como IDs del catálogo (el formato
      //   que filtran los buscadores de Operaciones: Cliente Mercancía, Cliente
      //   Paga, Proveedores, etc.). La interfaz trabaja con nombres, así que
      //   aquí se convierten justo antes de guardar. Si algún nombre no está
      //   en el catálogo, se conserva tal cual para no perder información.
      const payload = {
        ...formData,
        tiposEmpresa: (formData.tiposEmpresa || []).map(n => idTipoEmpresaDeNombre(String(n))),
        tiposServicio: (formData.tiposServicio || []).map(n => idTipoServicioDeNombre(String(n))),
        // ✅ V00268: cada dirección viaja con el ID del tipo y el ID de la
        //   dirección del Directorio (el nombre es caché regenerable).
        direccionesPorTipo: (formData.direccionesPorTipo || []).map((dt) => ({
          tipoId: idTipoEmpresaDeNombre(String(dt.tipoNombre)),
          tipoNombre: String(dt.tipoNombre),
          direccionId: String(dt.direccionId),
          direccionNombre: String(dt.direccionNombre),
        })),
      };

      if (initialData && initialData.id) {
        await actualizarRegistro('empresas', initialData.id, payload);
        await registrarLog('Empresas', 'Edición', `Actualizó los datos de la empresa: ${formData.nombre}`);
        // ✅ V00148: si la MONEDA cambió, se propaga AUTOMÁTICAMENTE en cascada:
        //   convenios (cliente/proveedor) → operaciones (Facturado En) →
        //   facturación de clientes/proveedores (las facturas que usa Pagos).
        if (String(formData.moneda || '') !== String(initialData.moneda || initialData.monedaId || '')) {
          try {
            const r = await propagarMonedaEmpresa(String(initialData.id));
            await registrarLog('Empresas', 'Edición', `Propagó la nueva moneda "${r.monedaNombre}" de ${formData.nombre}: convenios ${r.conveniosClientes + r.conveniosProveedores}, operaciones ${r.opsCliente + r.opsProveedor}, facturas ${r.facturasClientes + r.facturasProveedores}.`);
            alert(`Moneda "${r.monedaNombre}" propagada automáticamente. ✅\n\n· Convenios: ${r.conveniosClientes + r.conveniosProveedores}\n· Operaciones (Facturado En): ${r.opsCliente + r.opsProveedor}\n· Facturas (clientes/proveedores): ${r.facturasClientes + r.facturasProveedores}`);
          } catch (eMon) {
            console.error('Propagación de moneda:', eMon);
            alert('La empresa se guardó, pero la propagación de la moneda no terminó completa. Puedes reintentarla con el botón 💱 de la tabla de Empresas.');
          }
        }
        // ✅ NUEVO (V00109) — PROPAGACIÓN DEL NOMBRE: las operaciones guardan
        //   una copia del nombre de la empresa (clienteNombre, origenNombre,
        //   destinoNombre, etc.) para pintar la tabla sin leer catálogos. Si
        //   el nombre cambió, se actualizan esas copias en lote para que las
        //   tablas dejen de mostrar el nombre viejo.
        if (String(formData.nombre || '') !== String(initialData.nombre || '')) {
          try {
            const REFS_OPERACIONES: Array<[string, string]> = [
              ['cliente', 'clienteNombre'],
              ['origen', 'origenNombre'],
              ['destino', 'destinoNombre'],
              ['clienteMercancia', 'clienteMercanciaNombre'],
              ['proveedorUnidad', 'proveedorUnidadNombre'],
              ['provServicios', 'provServiciosNombre'],
            ];
            let propagados = 0;
            for (const [campoId, campoNombre] of REFS_OPERACIONES) {
              const snap = await getDocs(query(collection(db, 'operaciones'), where(campoId, '==', initialData.id)));
              for (let i = 0; i < snap.docs.length; i += 400) {
                const lote = snap.docs.slice(i, i + 400);
                const batch = writeBatch(db);
                lote.forEach((d) => batch.update(d.ref, { [campoNombre]: formData.nombre }));
                await batch.commit();
                propagados += lote.length;
              }
            }
            if (propagados > 0) {
              await registrarLog('Empresas', 'Edición', `Propagó el nuevo nombre de la empresa a ${propagados} operación(es)`);
            }
          } catch (ePropagar) {
            console.error('No se pudo propagar el nombre de la empresa a operaciones:', ePropagar);
          }
        }
      } else {
        const correlativoFinal = generarSiguienteNumCliente();
        await agregarRegistro('empresas', { ...payload, numCliente: correlativoFinal });
        await registrarLog('Empresas', 'Creación', `Agregó la nueva empresa: ${formData.nombre} (${correlativoFinal})`);
      }
      onClose();
    } catch (error) {
      console.error("Error al guardar:", error);
      alert('Error al guardar. Revisa tu conexión a internet.');
    } finally {
      setCargando(false);
    }
  };

  const tabStyle = (isActive: boolean) => ({
    padding: '12px 20px', background: 'none', border: 'none',
    borderBottom: isActive ? '2px solid #D84315' : '2px solid transparent',
    color: isActive ? '#f0f6fc' : '#8b949e', cursor: 'pointer',
    fontWeight: isActive ? '600' : 'normal', fontSize: '0.9rem',
    transition: 'all 0.2s ease', outline: 'none'
  });

  const monedaSeleccionadaString = monedas.find(m => m.id === formData.moneda)?.moneda || formData.moneda;
  // ✅ V00127: el catálogo "Tipo de Facturas" guarda la moneda como texto sin
  //   acento ("Dolares") y el catálogo de Monedas la tiene con acento
  //   ("Dólares"); la comparación exacta dejaba el selector VACÍO. Ahora se
  //   compara sin acentos ni mayúsculas, y también se acepta que el tipo de
  //   factura tenga guardado el ID de la moneda.
  const normMoneda = (t: unknown) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  const monedaObjetivo = normMoneda(monedaSeleccionadaString);
  const tiposFacturasFiltrados = tiposFacturas.filter(tf => {
    const tfMon = String(tf.moneda ?? '');
    if (!monedaObjetivo) return true;
    if (normMoneda(tfMon) === monedaObjetivo) return true;
    if (tfMon && String(formData.moneda) === tfMon) return true; // guardado como id de moneda
    const monCat = monedas.find(m => m.id === tfMon)?.moneda;
    return normMoneda(monCat) === monedaObjetivo;
  });
  
  // ✅ CORRECCIÓN: el campo tiposEmpresa puede venir guardado como el ID del
  //    catálogo ('7eec9cbb') o como el texto ('Cliente (Paga)'). Antes solo se
  //    comparaba contra el texto, por eso el selector de "Cliente(s) que Paga
  //    (Relacionados)" salía vacío ("No se encontraron coincidencias"). Ahora
  //    aceptamos AMBOS formatos para que sí aparezcan los clientes que pagan.
  const esClientePaga = (r: any) =>
    Array.isArray(r.tiposEmpresa) &&
    (r.tiposEmpresa.includes('Cliente (Paga)') || r.tiposEmpresa.includes(ID_TIPO_CLIENTE_PAGA));
  const clientesPaga = registros.filter(esClientePaga);
  const opcionesClientesPaga = clientesPaga.map(c => ({ id: c.id, label: c.nombre }));

  return (
    <>
      {/* ✅ V00141: modal de acceso a campo bloqueado */}
      <ModalAccesoCampo aut={aut} />
      <div className={`modal-overlay ${estado === 'minimizado' ? 'minimized' : ''}`} style={{ zIndex: 1050 }}>
        <div className="form-card fe-x26">
          
          <div className="form-header fe-x27">
            <h2 className="fe-x28">
              {estado === 'minimizado' ? 'Editando...' : (initialData ? `Editar Empresa` : 'Nueva Empresa')}
            </h2>
            <div className="header-actions fe-x29">
              <button
                type="button"
                onClick={() => { if (!initialData) { alert('Guarda la empresa primero para poder subir documentos.'); return; } setMostrarSubirDoc(true); }}
                title={initialData ? 'Subir documentos de la empresa' : 'Guarda la empresa primero para subir documentos'}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '7px 14px', borderRadius: '6px', border: 'none', backgroundColor: initialData ? '#D84315' : '#21262d', color: initialData ? '#fff' : '#6e7681', cursor: initialData ? 'pointer' : 'not-allowed', fontWeight: 600, fontSize: '0.82rem' }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                Subir Documentos
              </button>
              {estado === 'abierto' ? (
                <button type="button" onClick={onMinimize} className="btn-window fe-x30">🗕</button>
              ) : (
                <button type="button" onClick={onRestore} className="btn-window restore fe-x30">🗖</button>
              )}
              <button type="button" onClick={onClose} className="btn-window close fe-x30">✕</button>
            </div>
          </div>

          <div style={{ display: estado === 'minimizado' ? 'none' : 'block' }}>
            
            <div className="fe-x31">
              <button type="button" onClick={() => setActiveTab('general')} style={tabStyle(activeTab === 'general')}>Información General</button>
              <button type="button" onClick={() => setActiveTab('fiscal')} style={tabStyle(activeTab === 'fiscal')}>Comercial / Fiscal</button>
              <button type="button" onClick={() => setActiveTab('contacto')} style={tabStyle(activeTab === 'contacto')}>Contacto</button>
            </div>

            <form className="fe-x32" onSubmit={handleSubmit}>
              <div className="fe-x33">
                
                {/* --- PESTAÑA 1: INFORMACIÓN GENERAL --- */}
                <div style={{ display: activeTab === 'general' ? 'block' : 'none', animation: 'fadeIn 0.3s ease' }}>
                  <div className="form-grid fe-x34">
                    <div className="form-group fe-x35">
                      <label className="form-label orange fe-x36"># de Empresa (Automático)</label>
                      <input type="text" className="form-control fe-x37" value={formData.numCliente} disabled />
                    </div>

                    <div className="form-group">
                      <label className="form-label fe-x38">Razón Social <span className="fe-x39">*</span></label>
                      <BloqueoAut bloqueado={autBloq('nombre')} titulo={autTituloBloq('nombre')} onSolicitar={() => autSolicitar('nombre')}><input type="text" name="nombre" className="form-control fe-x40" value={formData.nombre} onChange={handleChange} required /></BloqueoAut>
                    </div>

                    <div className="form-group">
                      <label className="form-label fe-x38">Nombre Corto / Alias</label>
                      <input type="text" name="nombreCorto" className="form-control fe-x40" value={formData.nombreCorto} onChange={handleChange} />
                    </div>

                    <div className="form-group fe-x35">
                      <label className="form-label fe-x38">Tipo(s) de Empresa <span className="fe-x39">*</span></label>
                      <BloqueoAut bloqueado={autBloq('tiposEmpresa')} titulo={autTituloBloq('tiposEmpresa')} onSolicitar={() => autSolicitar('tiposEmpresa')}><MultiSelectCheckbox 
                        options={catalogoTiposEmpresa} 
                        selectedValues={formData.tiposEmpresa} 
                        onChange={(vals: string[]) => { tocarCampoAut('tiposEmpresa'); handleTiposEmpresaChange(vals); }} 
                        placeholder="Seleccionar tipos..."
                      /></BloqueoAut>
                    </div>

                    {formData.tiposEmpresa.includes('Proveedor (Servicios)') && (
                      <div className="form-group fe-x41">
                        <label className="form-label fe-x36">Servicios que Ofrece (Solo para Proveedores de Servicios)</label>
                        <MultiSelectCheckbox 
                          options={catalogoTiposServicio} 
                          selectedValues={formData.tiposServicio} 
                          onChange={handleTiposServicioChange} 
                          placeholder="Seleccionar servicios..."
                        />
                      </div>
                    )}

                    {formData.tiposEmpresa.includes('Cliente (Mercancía)') && (
                      <div className="form-group fe-x42">
                        <label className="form-label fe-x43">Cliente(s) que Paga (Relacionados) *</label>
                        <MultiSearchableSelect 
                          options={opcionesClientesPaga}
                          selectedIds={formData.clienteRelacionadoIds}
                          onChange={(ids, labels) => setFormData(prev => ({ ...prev, clienteRelacionadoIds: ids, clienteRelacionadoNombres: labels }))}
                          placeholder="Buscar y seleccionar clientes que pagan..."
                        />
                      </div>
                    )}

                    <div className="form-group">
                      <label className="form-label fe-x38">RFC / Tax ID <span className="fe-x39">*</span></label>
                      <BloqueoAut bloqueado={autBloq('rfc')} titulo={autTituloBloq('rfc')} onSolicitar={() => autSolicitar('rfc')}><input type="text" name="rfcTaxId" className="form-control font-mono fe-x40" value={formData.rfcTaxId} onChange={handleChange} required /></BloqueoAut>
                    </div>

                    <div className="form-group">
                      <label className="form-label fe-x38">Status</label>
                      <BloqueoAut bloqueado={autBloq('status')} titulo={autTituloBloq('status')} onSolicitar={() => autSolicitar('status')}><select name="status" className="form-control fe-x40" value={formData.status} onChange={handleChange}>
                        <option value="Activa">Activa</option>
                        <option value="Inactiva">Inactiva</option>
                        <option value="Baja">Baja</option>
                      </select></BloqueoAut>
                    </div>

                    {formData.status === 'Baja' && (
                      <div className="fe-x44">
                        <div className="form-group fe-x45">
                          <label className="form-label fe-x46">Fecha de Baja *</label>
                          <input type="date" name="fechaBaja" className="form-control fe-x40" value={formData.fechaBaja} onChange={handleChange} required />
                        </div>
                        <div className="form-group fe-x45">
                          <label className="form-label fe-x46">Observaciones de Baja *</label>
                          <input type="text" name="observacionesBaja" className="form-control fe-x40" value={formData.observacionesBaja} onChange={handleChange} placeholder="Motivo de la baja..." required />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* --- PESTAÑA 2: INFORMACIÓN FISCAL Y COMERCIAL --- */}
                <div style={{ display: activeTab === 'fiscal' ? 'block' : 'none', animation: 'fadeIn 0.3s ease' }}>
                  <div className="form-grid fe-x34">
                    
                    <div className="form-group fe-x47">
                      <label className="form-label fe-x43">Régimen Fiscal (Buscar en Catálogo)</label>
                      <BloqueoAut bloqueado={autBloq('regimenFiscal')} titulo={autTituloBloq('regimenFiscal')} onSolicitar={() => autSolicitar('regimenFiscal')}><div className="fe-x48">
                        <div className="fe-x49">
                          <SearchableSelect 
                            options={regimenesFiscales}
                            value={formData.regimenFiscalId}
                            onChange={(id, label) => { tocarCampoAut('regimenFiscal'); setFormData(prev => ({ ...prev, regimenFiscalId: id, regimenFiscalLabel: label })); }}
                            placeholder="Buscar Régimen Fiscal..."
                          />
                        </div>
                        <button type="button" className="btn btn-outline fe-x50" onClick={() => setModalRegimenAbierto(true)}>
                          + Nuevo
                        </button>
                      </div></BloqueoAut>
                    </div>

                    <div className="form-group">
                      <label className="form-label fe-x38">Moneda</label>
                      <BloqueoAut bloqueado={autBloq('moneda')} titulo={autTituloBloq('moneda')} onSolicitar={() => autSolicitar('moneda')}><select name="moneda" className="form-control fe-x40" value={formData.moneda} onChange={handleChange}>
                        <option value="">Seleccione Moneda...</option>
                        {monedas.map(mon => (
                          <option key={mon.id} value={mon.id}>{mon.moneda}</option>
                        ))}
                      </select></BloqueoAut>
                    </div>

                    <div className="form-group">
                      <label className="form-label fe-x38">Tipo de Factura</label>
                      <BloqueoAut bloqueado={autBloq('tipoFactura')} titulo={autTituloBloq('tipoFactura')} onSolicitar={() => autSolicitar('tipoFactura')}><select 
                        name="tipoFactura" 
                        className="form-control" 
                        value={formData.tipoFactura} 
                        onChange={handleChange}
                        disabled={!formData.moneda}
                        style={{ 
                          width: '100%', padding: '10px', border: '1px solid #30363d', borderRadius: '4px', boxSizing: 'border-box',
                          opacity: formData.moneda ? 1 : 0.5,
                          backgroundColor: '#010409',
                          color: formData.moneda ? '#c9d1d9' : '#8b949e'
                        }}
                      >
                        <option value="">{formData.moneda ? 'Seleccione Tipo de Factura...' : 'Primero seleccione Moneda'}</option>
                        {tiposFacturasFiltrados.map(tf => (
                          <option key={tf.id} value={tf.id}>{tf.nombre}</option>
                        ))}
                      </select></BloqueoAut>
                    </div>

                    <div className="form-group">
                      <label className="form-label fe-x43">Crédito / Contado</label>
                      <BloqueoAut bloqueado={autBloq('creditoContado')} titulo={autTituloBloq('creditoContado')} onSolicitar={() => autSolicitar('creditoContado')}><select name="condicionPago" className="form-control fe-x40" value={formData.condicionPago} onChange={handleCondicionPagoChange}>
                        <option value="Crédito">Crédito</option>
                        <option value="Contado">Contado</option>
                      </select></BloqueoAut>
                    </div>

                    <div className="form-group">
                      <label className="form-label" style={{ color: formData.condicionPago === 'Contado' ? '#484f58' : '#c9d1d9', display: 'block', marginBottom: '8px' }}>Días de Crédito</label>
                      <BloqueoAut bloqueado={autBloq('diasCredito')} titulo={autTituloBloq('diasCredito')} onSolicitar={() => autSolicitar('diasCredito')}><input type="number" name="diasCredito" className="form-control" value={formData.diasCredito} onChange={(e) => { tocarCampoAut('diasCredito'); setFormData(prev => ({ ...prev, diasCredito: parseInt(e.target.value) || 0 })); }} disabled={formData.condicionPago === 'Contado'} style={{ width: '100%', padding: '10px', backgroundColor: '#010409', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '4px', boxSizing: 'border-box', opacity: formData.condicionPago === 'Contado' ? 0.5 : 1 }} /></BloqueoAut>
                    </div>

                    <div className="form-group">
                      <label className="form-label" style={{ color: formData.condicionPago === 'Contado' ? '#484f58' : '#c9d1d9', display: 'block', marginBottom: '8px' }}>Límite de Crédito ($)</label>
                      <BloqueoAut bloqueado={autBloq('limiteCredito')} titulo={autTituloBloq('limiteCredito')} onSolicitar={() => autSolicitar('limiteCredito')}><input type="number" step="0.01" name="limiteCredito" className="form-control" value={formData.limiteCredito} onChange={(e) => { tocarCampoAut('limiteCredito'); setFormData(prev => ({ ...prev, limiteCredito: parseFloat(e.target.value) || 0 })); }} disabled={formData.condicionPago === 'Contado'} style={{ width: '100%', padding: '10px', backgroundColor: '#010409', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '4px', boxSizing: 'border-box', opacity: formData.condicionPago === 'Contado' ? 0.5 : 1 }} /></BloqueoAut>
                    </div>
                  </div>
                </div>

                {/* --- PESTAÑA 3: CONTACTO Y DIRECCIÓN --- */}
                <div style={{ display: activeTab === 'contacto' ? 'block' : 'none', animation: 'fadeIn 0.3s ease' }}>
                  <div className="form-grid fe-x34">
                    
                    <div className="form-group fe-x47">
                      <label className="form-label fe-x43">Dirección de la Empresa (Buscar en Base de Datos)</label>
                      <div className="fe-x48">
                        <div className="fe-x49">
                          <SearchableSelect 
                            options={direccionesDB}
                            value={formData.direccionId}
                            onChange={(id, label) => setFormData(prev => ({ ...prev, direccionId: id, direccionLabel: label, direccion: label }))}
                            placeholder="Buscar dirección guardada..."
                          />
                        </div>
                        <button type="button" className="btn btn-outline fe-x50" onClick={() => setModalDireccionAbierto(true)}>
                          + Añadir Nueva
                        </button>
                      </div>
                      {/* Desglose de la dirección seleccionada (campos del catálogo de
                          direcciones, SOLO LECTURA: se editan desde el catálogo). */}
                      {(() => {
                        const dirSel = direccionesDB.find((d: any) => String(d.id) === String(formData.direccionId));
                        if (!dirSel) return null;
                        const v = (x: any) => String(x ?? '').trim() || '—';
                        const campoDir = (etiqueta: string, valor: any) => (
                          <div>
                            <label className="fe-x51">{etiqueta}</label>
                            <input type="text" readOnly disabled value={v(valor)} className="form-control fe-x52" />
                          </div>
                        );
                        return (
                          <div className="fe-x53">
                            {campoDir('País', dirSel.paisNombre)}
                            {campoDir('Estado', dirSel.estadoNombre)}
                            {campoDir('Municipio', dirSel.municipioNombre)}
                            {campoDir('Colonia', dirSel.coloniaNombre)}
                            {campoDir('Calle', dirSel.calleNombre)}
                            {campoDir('# Exterior', dirSel.numExterior)}
                            {campoDir('# Interior', dirSel.numInterior)}
                            {campoDir('Código Postal', dirSel.cpNombre)}
                          </div>
                        );
                      })()}
                    </div>

                    {/* ✅ V00268: DIRECCIONES POR TIPO DE EMPRESA — un bloque por
                        cada tipo seleccionado en Información General; se pueden
                        AGREGAR VARIAS direcciones del Directorio en cada uno. */}
                    {(formData.tiposEmpresa || []).length > 0 && (
                      <div className="form-group fe-x47 fe-dirtipo">
                        <label className="form-label fe-x43">Direcciones por tipo de empresa</label>
                        <div className="fe-dirtipo__nota">Cada tipo seleccionado tiene su propia lista — agrega tantas como necesites desde el Directorio de Direcciones (Bases de Datos → Direcciones).</div>
                        {(formData.tiposEmpresa || []).map((tipoNombre: string) => {
                          const deEsteTipo = (formData.direccionesPorTipo || []).filter(d => d.tipoNombre === tipoNombre);
                          const sel = dirTipoSeleccion[tipoNombre] || { id: '', label: '' };
                          return (
                            <div key={tipoNombre} className="fe-dirtipo__bloque">
                              <div className="fe-dirtipo__titulo">Dirección {tipoNombre} <span className="fe-dirtipo__conteo">({deEsteTipo.length})</span></div>
                              {deEsteTipo.map((d) => (
                                <div key={`${tipoNombre}_${d.direccionId}`} className="fe-dirtipo__fila">
                                  <span className="fe-dirtipo__nombre" title={d.direccionNombre}>{d.direccionNombre}</span>
                                  <button type="button" className="fe-dirtipo__quitar" title="Quitar esta dirección" onClick={() => quitarDireccionTipo(tipoNombre, d.direccionId)}>✕</button>
                                </div>
                              ))}
                              <div className="fe-x48">
                                <div className="fe-x49">
                                  <SearchableSelect
                                    options={direccionesDB}
                                    value={sel.id}
                                    onChange={(id, label) => setDirTipoSeleccion(prev => ({ ...prev, [tipoNombre]: { id, label } }))}
                                    placeholder={`Buscar dirección para ${tipoNombre}…`}
                                  />
                                </div>
                                <button type="button" className="btn btn-outline fe-x50" disabled={!sel.id} onClick={() => agregarDireccionTipo(tipoNombre)}>
                                  + Agregar
                                </button>
                              </div>
                            </div>
                          );
                        })}
                        <div className="fe-dirtipo__nota">¿La dirección no existe todavía? Créala con "+ Añadir Nueva" (arriba) y luego agrégala aquí.</div>
                      </div>
                    )}

                    <div className="form-group fe-x35">
                      <label className="form-label fe-x38">Google Maps (URL)</label>
                      <div className="fe-x48">
                        <input type="url" name="maps" className="form-control fe-x54" value={formData.maps} onChange={handleChange} placeholder="https://maps.app.goo.gl/..." />
                        {formData.maps && (
                          <a href={formData.maps} target="_blank" rel="noopener noreferrer" className="btn btn-outline fe-x55">
                            Abrir Mapa
                          </a>
                        )}
                      </div>
                    </div>

                    {/* LOS CAMPOS RESTANTES DE CONTACTO */}
                    <div className="form-group">
                      <label className="form-label fe-x38">Teléfono</label>
                      <input type="text" name="telefono" className="form-control fe-x40" value={formData.telefono} onChange={handleChange} />
                    </div>

                    <div className="form-group">
                      <label className="form-label fe-x38">Correo Electrónico</label>
                      <input type="email" name="correo" className="form-control fe-x40" value={formData.correo} onChange={handleChange} />
                    </div>

                  </div>
                </div>
              </div>

              {/* BOTONES DEL FORMULARIO */}
              <div className="form-actions fe-x56">
                <button type="button" onClick={onClose} className="btn btn-outline fe-x24">Cancelar</button>
                <button type="submit" className="btn btn-primary fe-x57" disabled={cargando}>{cargando ? 'Guardando...' : 'Guardar Empresa'}</button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <ModalNuevoRegimen isOpen={modalRegimenAbierto} onClose={() => setModalRegimenAbierto(false)} />
      
      {modalDireccionAbierto && (
        <FormularioDireccion 
          estado="abierto"
          onClose={() => setModalDireccionAbierto(false)}
          onMinimize={() => {}}
          onRestore={() => {}}
        />
      )}

      <DocumentoUploadModal
        isOpen={mostrarSubirDoc}
        onClose={() => setMostrarSubirDoc(false)}
        coleccionOrigen="empresas"
        registroId={(initialData as any)?.id || ''}
        registroNombre={formData.nombre || ''}
        tiposDocumento={TIPOS_DOCUMENTO_EMPRESA}
      />
    </>
  );
};