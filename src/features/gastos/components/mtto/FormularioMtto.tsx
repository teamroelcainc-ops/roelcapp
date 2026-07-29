// src/features/gastos/components/mtto/FormularioMtto.tsx
import { useState, useEffect, useRef } from 'react';
// ✅ IMPORTAMOS 'doc' y 'updateDoc' DE FIREBASE
import { collection, getDocs, query, limit, orderBy, doc, updateDoc } from 'firebase/firestore';
import { db } from '../../../../config/firebase';
import { guardarMttoSeguro } from '../services/mttoService';
import './FormularioMtto.css';

// ✅ Helpers de folio (mismo formato que el dashboard: MTTO-DDMMYY-NNN).
//    Se usan solo para MOSTRAR el folio normalizado al editar registros viejos;
//    el valor guardado en Firestore no se altera.
const consecutivoDe = (m: any): number => {
  const parte = String(m?.numeroGasto || '').split('-').pop() || '';
  const n = parseInt(parte.replace(/\D/g, ''), 10);
  return isNaN(n) ? 0 : n;
};
const partesFechaISO = (v: any): { yyyy: string; mm: string; dd: string } | null => {
  const s = String(v || '').slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { yyyy: m[1], mm: m[2], dd: m[3] };
};
const formatearFolio = (m: any): string => {
  const consStr = String(consecutivoDe(m)).padStart(3, '0');
  const p = partesFechaISO(m?.fecha) || partesFechaISO(m?.createdAt);
  if (p) return `MTTO-${p.dd}${p.mm}${p.yyyy.slice(2)}-${consStr}`;
  const original = String(m?.numeroGasto || '').trim();
  if (!original) return '-';
  const partes = original.split('-');
  if (partes.length >= 3) return `MTTO-${partes[1]}-${consStr}`;
  return original;
};

interface FormProps {
  estado: 'abierto' | 'minimizado' | 'cerrado';
  catalogos: any;
  initialData?: any;
  onClose: () => void;
  onSave?: (data: any) => void;
}

type TabType = 'general' | 'finanzas' | 'documentos';

export const FormularioMtto = ({ estado, catalogos, initialData, onClose, onSave }: FormProps) => {
  const [cargando, setCargando] = useState(false);
  const [pestañaActiva, setPestañaActiva] = useState<TabType>('general');

  // MOTOR DE CONFIGURACIÓN LOCAL
  const [showConfig, setShowConfig] = useState(false);
  const [configuracion, setConfiguracion] = useState(() => {
    const guardado = localStorage.getItem('mtto_form_config');
    return guardado ? JSON.parse(guardado) : {
      requeridos: {
        invoice: false, unidad: true, operador: true, descripcion: false,
        proveedor: true, tipoServicio: true, condicionPago: true, plazo: true, moneda: true, importe: true,
        facturaTexto: false, fechaFactura: false, descripcionFactura: false, archivoPdf: false,
        fechaPago: false, formaPago: false, operacionAsignada: false, observaciones: false
      },
      autorizadorFijo: '',
      autorizadorNombreFijo: ''
    };
  });

  // ESTADOS PARA EL BUSCADOR DE LA CONFIGURACIÓN
  const [searchAutorizadorConfig, setSearchAutorizadorConfig] = useState(configuracion.autorizadorNombreFijo || '');
  const [showAutorizadorConfig, setShowAutorizadorConfig] = useState(false);

  // Estados locales de auto-reparación
  const [listaEmpleadosLocal, setListaEmpleadosLocal] = useState<any[]>(catalogos?.empleados || []);
  const [listaUnidadesLocal, setListaUnidadesLocal] = useState<any[]>(catalogos?.unidades || []);
  const [listaMonedasLocal, setListaMonedasLocal] = useState<any[]>(catalogos?.catalogo_moneda || catalogos?.monedas || []);
  const [listaFormasPagoLocal, setListaFormasPagoLocal] = useState<any[]>(catalogos?.catalogo_formas_pago || catalogos?.formasPago || []);
  const [listaTiposServicioLocal, setListaTiposServicioLocal] = useState<any[]>(catalogos?.catalogo_tipo_servicio || catalogos?.tiposServicio || []);

  // Estados visuales de búsqueda principal
  const [searchUnidad, setSearchUnidad] = useState('');
  const [searchProveedor, setSearchProveedor] = useState('');
  const [searchOperacion, setSearchOperacion] = useState('');
  const [searchOperador, setSearchOperador] = useState('');
  
  const [showUnidad, setShowUnidad] = useState(false);
  const [showProveedor, setShowProveedor] = useState(false);
  const [showOperacion, setShowOperacion] = useState(false);
  const [showOperador, setShowOperador] = useState(false);
  
  // Estado para el EnumList de Servicios
  const [showServicios, setShowServicios] = useState(false);

  const [formData, setFormData] = useState({
    numeroGasto: 'Generando...', 
    invoice: '',
    estatus: 'No facturado',
    fecha: new Date().toISOString().split('T')[0],
    tipoGasto: '',
    unidadId: '',
    operadorId: '',
    operadorNombre: '',
    descripcion: '',
    proveedorId: '',
    proveedorNombre: '',
    tipoServicioId: [] as string[],
    autorizadoPor: configuracion.autorizadorNombreFijo || '',
    autorizadoPorId: configuracion.autorizadorFijo || '',
    condicionPago: '',
    plazo: '', 
    monedaId: '',
    importe: '',
    ivaPorcentaje: '0',
    ivaMonto: 0,
    retIva: '',
    retIsr: '',
    total: 0,
    facturaTexto: '',
    fechaFactura: '',
    descripcionFactura: '',
    archivoPdf: null as File | null,
    fechaPago: '',
    formaPagoId: '',
    observaciones: '',
    operacionAsignadaId: ''
  });

  const guardarConfiguracion = (nuevaConfig: any) => {
    setConfiguracion(nuevaConfig);
    localStorage.setItem('mtto_form_config', JSON.stringify(nuevaConfig));
    if (!initialData) {
      setFormData(prev => ({ ...prev, autorizadoPor: nuevaConfig.autorizadorNombreFijo, autorizadoPorId: nuevaConfig.autorizadorFijo }));
    }
  };

  const toggleRequerido = (campo: string) => {
    const nueva = { ...configuracion, requeridos: { ...configuracion.requeridos, [campo]: !configuracion.requeridos[campo] } };
    guardarConfiguracion(nueva);
  };

  // DESCARGA FORZADA DE COLECCIONES FALTANTES
  useEffect(() => {
    const cargarCatalogosFaltantes = async () => {
      try {
        if (!catalogos?.empleados || catalogos.empleados.length === 0) {
          const snap = await getDocs(collection(db, 'empleados'));
          setListaEmpleadosLocal(snap.docs.map(d => ({id: d.id, ...d.data()})));
        }

        if (!catalogos?.unidades || catalogos.unidades.length === 0) {
          const snapUni = await getDocs(collection(db, 'unidades'));
          setListaUnidadesLocal(snapUni.docs.map(d => ({id: d.id, ...d.data()})));
        }

        if (!(catalogos?.catalogo_moneda || catalogos?.monedas)?.length) {
          const snapMon = await getDocs(collection(db, 'catalogo_moneda'));
          setListaMonedasLocal(snapMon.docs.map(d => ({id: d.id, ...d.data()})));
        }

        if (!(catalogos?.catalogo_formas_pago || catalogos?.formasPago)?.length) {
          const snapFP = await getDocs(collection(db, 'catalogo_formas_pago'));
          setListaFormasPagoLocal(snapFP.docs.map(d => ({id: d.id, ...d.data()})));
        }

        if (!(catalogos?.catalogo_tipo_servicio || catalogos?.tiposServicio)?.length) {
          const snapTS = await getDocs(collection(db, 'catalogo_tipo_servicio'));
          setListaTiposServicioLocal(snapTS.docs.map(d => ({id: d.id, ...d.data()})));
        }
      } catch (error) {
        console.warn("Error cargando colecciones de respaldo", error);
      }
    };
    cargarCatalogosFaltantes();
  }, [catalogos]);

  useEffect(() => {
    const predecirConsecutivo = async () => {
      if (initialData && initialData.numeroGasto) {
        setFormData(prev => ({ ...prev, numeroGasto: initialData.numeroGasto }));
        return;
      }
      // ✅ FORMATO DDMMYY -> Ej: 2026-06-26 = "260626" (se parsea el string para evitar el
      // desfase de zona horaria que provoca new Date('YYYY-MM-DD') en husos negativos como MX)
      const fechaStr = formData.fecha || new Date().toISOString().split('T')[0];
      const [yyyyStr = '', mmStr = '', ddStr = ''] = String(fechaStr).split('-');
      const yyyy = yyyyStr || String(new Date().getFullYear());
      const mm = (mmStr || '01').padStart(2, '0');
      const dd = (ddStr || '01').padStart(2, '0');
      const yy = yyyy.slice(-2);
      const dateString = `${dd}${mm}${yy}`;

      try {
        // Se revisan los gastos más recientes y se toma el consecutivo MÁS ALTO del mismo día
        const q = query(collection(db, 'gastos_mtto'), orderBy('createdAt', 'desc'), limit(50));
        const snap = await getDocs(q);
        let maxConsecutivo = 0;
        const prefijoHoy = `MTTO-${dateString}-`;
        snap.docs.forEach((docu: any) => {
          const ref = docu.data().numeroGasto;
          if (ref && String(ref).startsWith(prefijoHoy)) {
            const seq = parseInt(String(ref).split('-')[2], 10);
            if (!isNaN(seq) && seq > maxConsecutivo) maxConsecutivo = seq;
          }
        });
        const proximoNumero = maxConsecutivo + 1;
        const paddedCorrelativo = String(proximoNumero).padStart(3, '0');
        setFormData(prev => ({ ...prev, numeroGasto: `MTTO-${dateString}-${paddedCorrelativo}` }));
      } catch (error) {
        setFormData(prev => ({ ...prev, numeroGasto: `MTTO-${dateString}-XXX` }));
      }
    };
    predecirConsecutivo();
  }, [formData.fecha, initialData]);

  useEffect(() => {
    if (initialData && catalogos) {
      
      let safeTipos = [];
      if (initialData.tipoServicioId) {
        safeTipos = Array.isArray(initialData.tipoServicioId) ? initialData.tipoServicioId : String(initialData.tipoServicioId).split(',').map(s => s.trim()).filter(Boolean);
      }

      const safeInitialData = {
        ...initialData,
        importe: initialData.importe || '',
        ivaPorcentaje: initialData.ivaPorcentaje || '0',
        retIva: initialData.retIva || '',
        retIsr: initialData.retIsr || '',
        plazo: initialData.plazo || '',
        fechaFactura: initialData.fechaFactura || '',
        tipoServicioId: safeTipos,
        autorizadoPor: initialData.autorizadoPor || configuracion.autorizadorNombreFijo || '',
      };
      setFormData(prev => ({ ...prev, ...safeInitialData }));

      if (initialData.unidadId && listaUnidadesLocal.length > 0) {
        const uni = listaUnidadesLocal.find((u:any) => u.id === initialData.unidadId);
        setSearchUnidad(uni ? (uni.unidad || uni.numeroEconomico || uni.nombre) : '');
      } else if (initialData.unidadId === 'Oficina') {
        setSearchUnidad('Oficina');
      }

      if (initialData.proveedorId && catalogos.empresas) {
        const prov = catalogos.empresas.find((e:any) => e.id === initialData.proveedorId);
        setSearchProveedor(prov ? prov.nombre : '');
      }

      if (initialData.operacionAsignadaId && catalogos.operaciones) {
        const op = catalogos.operaciones.find((o:any) => o.id === initialData.operacionAsignadaId);
        setSearchOperacion(op ? (op.ref || op.id) : '');
      }

      if (initialData.operadorId && listaEmpleadosLocal.length > 0) {
        const op = listaEmpleadosLocal.find((e:any) => e.id === initialData.operadorId);
        if(op){
          setSearchOperador(`${op.firstName || ''} ${op.lastNamePaternal || ''}`.trim());
        }
      } else if (initialData.operadorNombre) {
        setSearchOperador(initialData.operadorNombre);
      }
    }
  }, [initialData, catalogos, listaEmpleadosLocal, listaUnidadesLocal]);

  const prevGastoRef = useRef(formData.tipoGasto);
  useEffect(() => {
    if (formData.tipoGasto === 'Gastos de Oficina') {
      const autorizadorNombre = configuracion.autorizadorNombreFijo || 'Oficina';
      const autorizadorId = configuracion.autorizadorFijo || 'Oficina';

      setFormData(prev => ({ 
        ...prev, 
        unidadId: 'Oficina', 
        operadorId: autorizadorId, 
        operadorNombre: autorizadorNombre 
      }));
      setSearchUnidad('Oficina');
      setSearchOperador(autorizadorNombre);
    } 
    else if (formData.tipoGasto === 'Gastos de Operación' && prevGastoRef.current === 'Gastos de Oficina') {
      setFormData(prev => ({ ...prev, unidadId: '', operadorId: '', operadorNombre: '' }));
      setSearchUnidad('');
      setSearchOperador('');
    }
    prevGastoRef.current = formData.tipoGasto;
  }, [formData.tipoGasto, configuracion.autorizadorNombreFijo, configuracion.autorizadorFijo]);

  useEffect(() => {
    setFormData(prev => ({ ...prev, estatus: prev.invoice.trim() ? 'Facturado' : 'No facturado' }));
  }, [formData.invoice]);

  useEffect(() => {
    if (formData.condicionPago !== 'Crédito') {
      setFormData(prev => ({ ...prev, plazo: '' }));
    }
  }, [formData.condicionPago]);

  useEffect(() => {
    const imp = Number(formData.importe) || 0;
    const ivaPct = Number(formData.ivaPorcentaje) || 0;
    const rIva = Number(formData.retIva) || 0;
    const rIsr = Number(formData.retIsr) || 0;
    const calcIva = imp * (ivaPct / 100);
    const totalCalc = imp + calcIva - rIva - rIsr;
    setFormData(prev => ({ ...prev, ivaMonto: calcIva, total: totalCalc }));
  }, [formData.importe, formData.ivaPorcentaje, formData.retIva, formData.retIsr]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, archivoPdf: e.target.files?.[0] || null }));
  };

  const toggleServicio = (idServicio: string) => {
    setFormData(prev => {
      const actuales = [...prev.tipoServicioId];
      if (actuales.includes(idServicio)) {
        return { ...prev, tipoServicioId: actuales.filter(id => id !== idServicio) };
      } else {
        return { ...prev, tipoServicioId: [...actuales, idServicio] };
      }
    });
  };

  // 🔴 LA MAGIA ESTÁ AQUÍ 🔴
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCargando(true);
    try {
      // Separamos el archivo (si lo hay) de los datos de texto
      const { archivoPdf, ...dataLista } = formData;
      
      // ✅ SI ES UNA EDICIÓN, ACTUALIZAMOS DIRECTAMENTE LA FILA EXISTENTE
      if (initialData && initialData.id) {
        const docRef = doc(db, 'gastos_mtto', initialData.id);
        await updateDoc(docRef, dataLista); // Actualización forzada
        
        alert("Gasto actualizado con éxito.");
        if (onSave) onSave({ id: initialData.id, ...dataLista });
        
      } else {
        // ✅ SI ES UN REGISTRO NUEVO, USAMOS TU FUNCIÓN NORMAL
        //    (ahora regresa el id REAL del documento creado en Firestore)
        const nuevoId = await guardarMttoSeguro(dataLista);
        alert("Gasto guardado con éxito.");
        if (onSave) onSave({ id: nuevoId, ...dataLista });
      }

    } catch (error) {
      console.error("Error guardando datos:", error);
      alert("Error al guardar el gasto");
    } finally {
      setCargando(false);
    }
  };

  const proveedoresFiltro = catalogos?.empresas?.filter((e:any) => e.tiposEmpresa?.includes('11894dfd') && (e.nombre || '').toLowerCase().includes(searchProveedor.toLowerCase())) || [];
  
  const unidadesFiltro = listaUnidadesLocal.filter((u:any) => {
    const valUnidad = u.unidad || u.numeroEconomico || u.nombre || '';
    return valUnidad.toLowerCase().includes(searchUnidad.toLowerCase());
  });
  
  const operadoresFiltro = listaEmpleadosLocal.filter((e:any) => {
    const fullName = `${e.firstName || ''} ${e.lastNamePaternal || ''}`.trim();
    return fullName.toLowerCase().includes(searchOperador.toLowerCase());
  });

  const empresaSeleccionada = catalogos?.empresas?.find((e:any) => e.id === formData.proveedorId);
  const rawServiciosIds = empresaSeleccionada?.tiposServicio || [];
  
  const opcionesServicios = rawServiciosIds.map((idServ: string) => {
    const servObj = listaTiposServicioLocal.find((s:any) => s.id === idServ);
    return {
      id: idServ,
      nombre: servObj ? (servObj.nombre || servObj.descripcion || idServ) : idServ
    };
  });

  const operacionesFiltro = catalogos?.operaciones?.filter((o:any) => (o.ref || '').toLowerCase().includes(searchOperacion.toLowerCase())) || [];

  // ✅ Folio que se muestra: al editar se normaliza a MTTO-DDMMYY-NNN (solo visual,
  //    el valor guardado en Firestore se conserva intacto). Al crear, muestra el folio en vivo.
  const folioDisplay = initialData ? formatearFolio(formData) : formData.numeroGasto;

  if (estado === 'cerrado') return null;

  const tabs = [
    { id: 'general', label: 'Información General' },
    { id: 'finanzas', label: 'Detalles Financieros' },
    { id: 'documentos', label: 'Documentos y Cierre' }
  ];

  const RequeridoMark = () => <span className="fm-x1">*</span>;

  return (
    <div className="modal-overlay" onClick={() => setShowServicios(false)}>
      <div className="form-card fm-x2" onClick={(e) => e.stopPropagation()}>
        
        {/* ENCABEZADO */}
        <div className="form-header fm-x3">
          <h2 className="fm-x4">
            {initialData ? `Editar Gasto ${folioDisplay}` : 'Nuevo Gasto (MTTO)'}
          </h2>
          <div className="fm-x5">
            <button className="fm-x6" type="button" onClick={() => setShowConfig(true)} title="Configuración de Formulario" onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#30363d'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#21262d'}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
              Configurar Formulario
            </button>
            <div className="fm-x7"></div>
            <button className="fm-x8" type="button" onClick={onClose}>✕</button>
          </div>
        </div>

        {/* BARRA DE PESTAÑAS */}
        <div className="fm-x9">
          {tabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setPestañaActiva(tab.id as TabType)}
              style={{
                padding: '12px 16px',
                background: 'none',
                border: 'none',
                borderBottom: pestañaActiva === tab.id ? '2px solid #D84315' : '2px solid transparent',
                color: pestañaActiva === tab.id ? '#f0f6fc' : '#8b949e',
                cursor: 'pointer',
                fontWeight: pestañaActiva === tab.id ? '600' : 'normal',
                fontSize: '0.9rem',
                whiteSpace: 'nowrap',
                transition: 'all 0.2s ease'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* CONTENIDO DEL FORMULARIO */}
        <form className="fm-x10" onSubmit={handleSubmit}>
          
          {/* PESTAÑA 1: INFORMACIÓN GENERAL */}
          {pestañaActiva === 'general' && (
            <div className="fm-x11">
              <div className="form-group">
                <label className="fm-x12"># de Gasto</label>
                <input className="fm-x13" type="text" readOnly value={folioDisplay} />
              </div>
              <div className="form-group">
                <label className="fm-x14"># de Invoice {configuracion.requeridos.invoice && <RequeridoMark />}</label>
                <input className="fm-x15" type="text" name="invoice" required={configuracion.requeridos.invoice} value={formData.invoice} onChange={handleChange} />
              </div>
              <div className="form-group">
                <label className="fm-x12">Estatus</label>
                <input type="text" readOnly value={formData.estatus} style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '6px', color: formData.estatus === 'Facturado' ? '#3fb950' : '#f85149', fontWeight: 'bold' }} />
              </div>
              <div className="form-group">
                <label className="fm-x16">Fecha <RequeridoMark /></label>
                <input className="fm-x15" type="date" name="fecha" value={formData.fecha} onChange={handleChange} required />
              </div>
              <div className="form-group">
                <label className="fm-x14">Tipo de Gasto <RequeridoMark /></label>
                <select className="fm-x15" name="tipoGasto" value={formData.tipoGasto} onChange={handleChange} required>
                  <option className="fm-x17" value="">-- Seleccionar --</option>
                  <option className="fm-x17" value="Gastos de Oficina">Gastos de Oficina</option>
                  <option className="fm-x17" value="Gastos de Operación">Gastos de Operación</option>
                </select>
              </div>
              
              <div className="form-group fm-x18">
                <label className="fm-x14">Unidad {configuracion.requeridos.unidad && <RequeridoMark />}</label>
                <input type="text" required={configuracion.requeridos.unidad && !formData.unidadId} value={searchUnidad} onChange={(e) => { setSearchUnidad(e.target.value); setShowUnidad(true); if (formData.unidadId) setFormData(prev => ({ ...prev, unidadId: '' })); }} onFocus={() => setShowUnidad(true)} readOnly={formData.tipoGasto === 'Gastos de Oficina'} style={{ width: '100%', padding: '10px', backgroundColor: formData.tipoGasto === 'Gastos de Oficina' ? '#161b22' : '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9' }} placeholder={formData.tipoGasto === 'Gastos de Oficina' ? '' : 'Buscar unidad...'} />
                {showUnidad && formData.tipoGasto !== 'Gastos de Oficina' && searchUnidad && (
                  <div className="fm-x19">
                    {unidadesFiltro.length === 0 ? <div className="fm-x20">Sin resultados</div> : unidadesFiltro.map((u:any) => (
                      <div className="fm-x21" key={u.id} onClick={() => { setFormData(prev => ({...prev, unidadId: u.id})); setSearchUnidad(u.unidad || u.numeroEconomico || u.nombre); setShowUnidad(false); }}>
                        <div className="fm-x22">{u.unidad || u.numeroEconomico || u.nombre}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="form-group fm-x18">
                <label className="fm-x14">Operador {configuracion.requeridos.operador && <RequeridoMark />}</label>
                <input type="text" required={configuracion.requeridos.operador && !formData.operadorId} value={searchOperador} onChange={(e) => { setSearchOperador(e.target.value); setShowOperador(true); if (formData.operadorId) setFormData(prev => ({ ...prev, operadorId: '', operadorNombre: '' })); }} onFocus={() => setShowOperador(true)} readOnly={formData.tipoGasto === 'Gastos de Oficina'} style={{ width: '100%', padding: '10px', backgroundColor: formData.tipoGasto === 'Gastos de Oficina' ? '#161b22' : '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9' }} placeholder={formData.tipoGasto === 'Gastos de Oficina' ? '' : 'Buscar empleado...'} />
                {showOperador && formData.tipoGasto !== 'Gastos de Oficina' && searchOperador && (
                  <div className="fm-x19">
                    {operadoresFiltro.length === 0 ? <div className="fm-x20">Sin resultados</div> : operadoresFiltro.map((e:any) => {
                      const fullName = `${e.firstName || ''} ${e.lastNamePaternal || ''}`.trim();
                      return (
                        <div className="fm-x21" key={e.id} onClick={() => { setFormData(prev => ({...prev, operadorId: e.id, operadorNombre: fullName, operador: fullName})); setSearchOperador(fullName); setShowOperador(false); }}>
                          <div className="fm-x22">{fullName}</div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* ✅ DESCRIPCIÓN GENERAL: AHORA ADMITE SALTOS DE LÍNEA (TEXTAREA) */}
              <div className="form-group fm-x23">
                <label className="fm-x14">Descripción General {configuracion.requeridos.descripcion && <RequeridoMark />}</label>
                <textarea className="fm-x24"
                  name="descripcion"
                  required={configuracion.requeridos.descripcion}
                  value={formData.descripcion}
                  onChange={handleChange}
                  rows={4}
                  placeholder="Escribe la descripción. Presiona Enter para agregar saltos de línea..."
                />
              </div>
            </div>
          )}

          {/* PESTAÑA 2: DETALLES FINANCIEROS */}
          {pestañaActiva === 'finanzas' && (
            <div className="fm-x11">
              
              <div className="form-group fm-x18">
                <label className="fm-x14">Proveedor {configuracion.requeridos.proveedor && <RequeridoMark />}</label>
                <input className="fm-x15" type="text" required={configuracion.requeridos.proveedor && !formData.proveedorId} value={searchProveedor} onChange={(e) => { setSearchProveedor(e.target.value); setShowProveedor(true); }} onFocus={() => setShowProveedor(true)} placeholder="Buscar proveedor..." />
                {showProveedor && searchProveedor && (
                  <div className="fm-x19">
                    {proveedoresFiltro.map((p:any) => {
                      const dirProveedor = p.direccion || p.domicilio || p.direccionFiscal || p.direccion_fiscal || p.calle || p.ubicacion || '';
                      return (
                      <div className="fm-x21" 
                        key={p.id} 
                        onClick={() => { 
                          const defaultMoneda = p.moneda || p.monedaId || formData.monedaId;
                          setFormData(prev => ({
                            ...prev, 
                            proveedorId: p.id, 
                            proveedorNombre: p.nombre, 
                            tipoServicioId: [],
                            monedaId: defaultMoneda
                          })); 
                          setSearchProveedor(p.nombre); 
                          setShowProveedor(false); 
                        }}
                      >
                        <div className="fm-x22">{p.nombre}</div>
                        {dirProveedor && <div className="fm-x25">{dirProveedor}</div>}
                      </div>
                      );
                    })}
                  </div>
                )}
              </div>
              
              {/* ENUMLIST: TIPO DE SERVICIO */}
              <div className="form-group fm-x18">
                <label className="fm-x14">Tipo de Servicio {configuracion.requeridos.tipoServicio && <RequeridoMark />}</label>
                
                <div 
                  onClick={() => { if(formData.proveedorId) setShowServicios(!showServicios); }} 
                  style={{ width: '100%', padding: '8px 10px', backgroundColor: formData.proveedorId ? '#0d1117' : '#161b22', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', cursor: formData.proveedorId ? 'pointer' : 'not-allowed', minHeight: '40px', display: 'flex', flexWrap: 'wrap', gap: '6px', boxSizing: 'border-box' }}
                >
                  {formData.tipoServicioId.length === 0 && <span className="fm-x26">{formData.proveedorId ? '-- Seleccionar Servicios --' : 'Selecciona un proveedor primero'}</span>}
                  
                  {formData.tipoServicioId.map(idSel => {
                    const nombreServicio = opcionesServicios.find((o:any) => o.id === idSel)?.nombre || idSel;
                    return (
                      <span className="fm-x27" key={idSel}>
                        {nombreServicio}
                        <span className="fm-x28" onClick={(e) => { e.stopPropagation(); toggleServicio(idSel); }}>×</span>
                      </span>
                    )
                  })}
                </div>

                {showServicios && formData.proveedorId && (
                  <div className="fm-x29">
                    {opcionesServicios.length === 0 ? (
                      <div className="fm-x30">Este proveedor no tiene servicios vinculados.</div>
                    ) : (
                      opcionesServicios.map((op:any) => (
                        <label className="fm-x31" key={op.id} onMouseEnter={e => e.currentTarget.style.backgroundColor = '#21262d'} onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                          <input className="fm-x32" type="checkbox" checked={formData.tipoServicioId.includes(op.id)} onChange={() => toggleServicio(op.id)} />
                          {op.nombre}
                        </label>
                      ))
                    )}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="fm-x14">Condición de Pago {configuracion.requeridos.condicionPago && <RequeridoMark />}</label>
                <select className="fm-x15" name="condicionPago" required={configuracion.requeridos.condicionPago} value={formData.condicionPago} onChange={handleChange}>
                  <option className="fm-x17" value="">-- Seleccionar --</option>
                  <option className="fm-x17" value="Crédito">Crédito</option>
                  <option className="fm-x17" value="Contado">Contado</option>
                </select>
              </div>

              {/* CAMPO CONDICIONAL DE PLAZO */}
              {formData.condicionPago === 'Crédito' && (
                <div className="form-group fm-x33">
                  <label className="fm-x14">Plazo (Días) {configuracion.requeridos.plazo && <RequeridoMark />}</label>
                  <input className="fm-x15" type="number" name="plazo" placeholder="Ej. 15, 30" required={configuracion.requeridos.plazo} value={formData.plazo} onChange={handleChange} />
                </div>
              )}

              <div className="form-group">
                <label className="fm-x14">Moneda {configuracion.requeridos.moneda && <RequeridoMark />}</label>
                <select className="fm-x15" name="monedaId" required={configuracion.requeridos.moneda} value={formData.monedaId} onChange={handleChange}>
                  <option className="fm-x17" value="">-- Seleccionar --</option>
                  {listaMonedasLocal.map((m:any) => (
                    <option className="fm-x17" key={m.id} value={m.id}>
                      {m.moneda || m.nombre || m.clave}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group fm-x23"><hr className="fm-x34" /></div>

              <div className="form-group">
                <label className="fm-x35">Importe (Monto Base) {configuracion.requeridos.importe && <RequeridoMark />}</label>
                <input className="fm-x36" type="number" step="0.01" name="importe" required={configuracion.requeridos.importe} value={formData.importe} onChange={handleChange} />
              </div>
              <div className="form-group">
                <label className="fm-x14">IVA (%)</label>
                <select className="fm-x15" name="ivaPorcentaje" value={formData.ivaPorcentaje} onChange={handleChange}>
                  <option className="fm-x17" value="0">0%</option>
                  <option className="fm-x17" value="8">8%</option>
                  <option className="fm-x17" value="16">16%</option>
                </select>
              </div>
              <div className="form-group">
                <label className="fm-x12">IVA ($) Calculado (+)</label>
                <input className="fm-x13" type="text" readOnly value={`$ ${formData.ivaMonto.toFixed(2)}`} />
              </div>
              <div className="form-group">
                <label className="fm-x14">RET IVA ($) (-)</label>
                <input className="fm-x37" type="number" step="0.01" name="retIva" value={formData.retIva} onChange={handleChange} />
              </div>
              <div className="form-group">
                <label className="fm-x14">RET ISR ($) (-)</label>
                <input className="fm-x37" type="number" step="0.01" name="retIsr" value={formData.retIsr} onChange={handleChange} />
              </div>

              <div className="form-group fm-x38">
                <label className="fm-x39">TOTAL FINAL</label>
                <div className="fm-x40">$ {formData.total.toFixed(2)}</div>
              </div>
            </div>
          )}

          {/* PESTAÑA 3: DOCUMENTOS Y CIERRE */}
          {pestañaActiva === 'documentos' && (
            <div className="fm-x11">
              <div className="form-group">
                <label className="fm-x14">Factura (Texto) {configuracion.requeridos.facturaTexto && <RequeridoMark />}</label>
                <input className="fm-x15" type="text" name="facturaTexto" required={configuracion.requeridos.facturaTexto} value={formData.facturaTexto} onChange={handleChange} />
              </div>
              <div className="form-group">
                <label className="fm-x14">Fecha de Factura {configuracion.requeridos.fechaFactura && <RequeridoMark />}</label>
                <input className="fm-x15" type="date" name="fechaFactura" required={configuracion.requeridos.fechaFactura} value={formData.fechaFactura} onChange={handleChange} />
              </div>
              <div className="form-group">
                <label className="fm-x14">Descripción Factura {configuracion.requeridos.descripcionFactura && <RequeridoMark />}</label>
                <input className="fm-x15" type="text" name="descripcionFactura" required={configuracion.requeridos.descripcionFactura} value={formData.descripcionFactura} onChange={handleChange} />
              </div>
              <div className="form-group">
                <label className="fm-x14">Archivo (PDF) {configuracion.requeridos.archivoPdf && <RequeridoMark />}</label>
                <input className="fm-x15" type="file" accept=".pdf" required={configuracion.requeridos.archivoPdf && !initialData?.archivoPdfUrl} onChange={handleFileChange} />
              </div>
              <div className="form-group">
                <label className="fm-x14">Fecha de Pago {configuracion.requeridos.fechaPago && <RequeridoMark />}</label>
                <input className="fm-x15" type="date" name="fechaPago" required={configuracion.requeridos.fechaPago} value={formData.fechaPago} onChange={handleChange} />
              </div>
              <div className="form-group">
                <label className="fm-x14">Forma de Pago {configuracion.requeridos.formaPago && <RequeridoMark />}</label>
                <select className="fm-x15" name="formaPagoId" required={configuracion.requeridos.formaPago} value={formData.formaPagoId} onChange={handleChange}>
                  <option className="fm-x17" value="">-- Seleccionar --</option>
                  {listaFormasPagoLocal.map((f:any) => <option className="fm-x17" key={f.id} value={f.id}>{f.forma_pago || f.nombre || f.clave}</option>)}
                </select>
              </div>
              
              <div className="form-group">
                <label className="fm-x14">Autorizado Por <span className="fm-x41">(Por Configuración)</span></label>
                <input className="fm-x42" type="text" readOnly value={formData.autorizadoPor || configuracion.autorizadorNombreFijo || 'No asignado en configuración'} />
              </div>

              <div className="form-group fm-x43">
                <label className="fm-x14">Asignar a Operación {configuracion.requeridos.operacionAsignada && <RequeridoMark />}</label>
                <input className="fm-x15" type="text" required={configuracion.requeridos.operacionAsignada && !formData.operacionAsignadaId} value={searchOperacion} onChange={(e) => { setSearchOperacion(e.target.value); setShowOperacion(true); }} onFocus={() => setShowOperacion(true)} placeholder="Buscar # Referencia..." />
                {showOperacion && searchOperacion && (
                  <div className="fm-x19">
                    {operacionesFiltro.map((o:any) => (
                      <div className="fm-x21" key={o.id} onClick={() => { setFormData(prev => ({...prev, operacionAsignadaId: o.id})); setSearchOperacion(o.ref || o.id); setShowOperacion(false); }}>{o.ref || o.id}</div>
                    ))}
                  </div>
                )}
              </div>
              <div className="form-group fm-x23">
                <label className="fm-x14">Observaciones {configuracion.requeridos.observaciones && <RequeridoMark />}</label>
                <textarea className="fm-x44" name="observaciones" required={configuracion.requeridos.observaciones} value={formData.observaciones} onChange={handleChange} />
              </div>
            </div>
          )}
          
        </form>

        {/* PIE DEL MODAL PRINCIPAL */}
        <div className="form-actions fm-x45">
          <button className="fm-x46" type="button" onClick={onClose} disabled={cargando}>Cancelar</button>
          <button onClick={handleSubmit} disabled={cargando} style={{ padding: '10px 20px', borderRadius: '6px', backgroundColor: '#D84315', border: 'none', color: '#fff', fontWeight: 'bold', cursor: cargando ? 'not-allowed' : 'pointer', transition: 'all 0.2s' }}>{cargando ? 'Guardando...' : (initialData ? 'Actualizar Gasto' : 'Guardar Gasto')}</button>
        </div>

      </div>

      {/* MODAL SUPERPUESTO DE CONFIGURACIÓN */}
      {showConfig && (
        <div className="fm-x47">
          <div className="fm-x48">
            <h3 className="fm-x49">
              Configuración del Formulario
              <button className="fm-x50" onClick={() => setShowConfig(false)}>✕</button>
            </h3>
            
            <div className="fm-x51">
              <h4 className="fm-x52">Autorizador por Defecto</h4>
              <p className="fm-x53">Este empleado se asignará automáticamente en el campo "Autorizado Por" de todos los nuevos gastos.</p>
              
              <div className="fm-x18">
                <input className="fm-x54" type="text" placeholder="Buscar empleado..." value={searchAutorizadorConfig} onChange={(e) => { setSearchAutorizadorConfig(e.target.value); setShowAutorizadorConfig(true); }} onFocus={() => setShowAutorizadorConfig(true)} />
                {showAutorizadorConfig && searchAutorizadorConfig && (
                  <div className="fm-x55">
                    {listaEmpleadosLocal.filter((e:any) => {
                      const fName = `${e.firstName || ''} ${e.lastNamePaternal || ''}`.trim();
                      return fName.toLowerCase().includes(searchAutorizadorConfig.toLowerCase());
                    }).map((e:any) => {
                      const fName = `${e.firstName || ''} ${e.lastNamePaternal || ''}`.trim();
                      return (
                        <div className="fm-x56" key={e.id} onClick={() => { guardarConfiguracion({ ...configuracion, autorizadorFijo: e.id, autorizadorNombreFijo: fName }); setSearchAutorizadorConfig(fName); setShowAutorizadorConfig(false); }}>
                          {fName}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            <div>
              <h4 className="fm-x52">Campos Obligatorios</h4>
              <p className="fm-x53">Selecciona qué campos no pueden dejarse en blanco al guardar.</p>
              
              <div className="fm-x57">
                {Object.keys(configuracion.requeridos).map((key) => (
                  <label className="fm-x58" key={key}>
                    <input className="fm-x32" type="checkbox" checked={configuracion.requeridos[key]} onChange={() => toggleRequerido(key)} />
                    {key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1')}
                  </label>
                ))}
              </div>
            </div>

            <div className="fm-x59">
              <button className="fm-x60" onClick={() => setShowConfig(false)}>Hecho</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};