// src/features/gastos/components/mtto/FormularioMtto.tsx
import { useState, useEffect, useRef } from 'react';
// ✅ IMPORTAMOS 'doc' y 'updateDoc' DE FIREBASE
import { collection, getDocs, query, limit, orderBy, doc, updateDoc } from 'firebase/firestore';
import { db } from '../../../../config/firebase';
import { guardarMttoSeguro } from '../services/mttoService';

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
        await guardarMttoSeguro(dataLista);
        alert("Gasto guardado con éxito.");
        if (onSave) onSave({ id: Date.now().toString(), ...dataLista });
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

  const RequeridoMark = () => <span style={{ color: '#f85149', marginLeft: '4px' }}>*</span>;

  return (
    <div className="modal-overlay" onClick={() => setShowServicios(false)}>
      <div className="form-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '1200px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
        
        {/* ENCABEZADO */}
        <div className="form-header" style={{ padding: '16px 24px', borderBottom: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <h2 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '12px' }}>
            {initialData ? `Editar Gasto ${folioDisplay}` : 'Nuevo Gasto (MTTO)'}
          </h2>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <button type="button" onClick={() => setShowConfig(true)} title="Configuración de Formulario" style={{ background: '#21262d', border: '1px solid #30363d', color: '#c9d1d9', cursor: 'pointer', padding: '6px 12px', borderRadius: '6px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px', transition: 'all 0.2s ease' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#30363d'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#21262d'}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
              Configurar Formulario
            </button>
            <div style={{ width: '1px', height: '24px', backgroundColor: '#30363d' }}></div>
            <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem', padding: '4px' }}>✕</button>
          </div>
        </div>

        {/* BARRA DE PESTAÑAS */}
        <div style={{ display: 'flex', borderBottom: '1px solid #30363d', padding: '0 24px', overflowX: 'auto', flexShrink: 0 }}>
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
        <form onSubmit={handleSubmit} style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
          
          {/* PESTAÑA 1: INFORMACIÓN GENERAL */}
          {pestañaActiva === 'general' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', animation: 'fadeIn 0.2s ease' }}>
              <div className="form-group">
                <label style={{ display: 'block', marginBottom: '8px', color: '#8b949e', fontSize: '0.85rem' }}># de Gasto</label>
                <input type="text" readOnly value={folioDisplay} style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '6px', color: '#8b949e' }} />
              </div>
              <div className="form-group">
                <label style={{ display: 'block', marginBottom: '8px', color: '#c9d1d9', fontSize: '0.85rem' }}># de Invoice {configuracion.requeridos.invoice && <RequeridoMark />}</label>
                <input type="text" name="invoice" required={configuracion.requeridos.invoice} value={formData.invoice} onChange={handleChange} style={{ width: '100%', padding: '10px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9' }} />
              </div>
              <div className="form-group">
                <label style={{ display: 'block', marginBottom: '8px', color: '#8b949e', fontSize: '0.85rem' }}>Estatus</label>
                <input type="text" readOnly value={formData.estatus} style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '6px', color: formData.estatus === 'Facturado' ? '#3fb950' : '#f85149', fontWeight: 'bold' }} />
              </div>
              <div className="form-group">
                <label style={{ display: 'block', marginBottom: '8px', color: '#D84315', fontSize: '0.85rem', fontWeight: 'bold' }}>Fecha <RequeridoMark /></label>
                <input type="date" name="fecha" value={formData.fecha} onChange={handleChange} required style={{ width: '100%', padding: '10px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9' }} />
              </div>
              <div className="form-group">
                <label style={{ display: 'block', marginBottom: '8px', color: '#c9d1d9', fontSize: '0.85rem' }}>Tipo de Gasto <RequeridoMark /></label>
                <select name="tipoGasto" value={formData.tipoGasto} onChange={handleChange} required style={{ width: '100%', padding: '10px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9' }}>
                  <option value="" style={{ backgroundColor: '#0d1117', color: '#c9d1d9' }}>-- Seleccionar --</option>
                  <option value="Gastos de Oficina" style={{ backgroundColor: '#0d1117', color: '#c9d1d9' }}>Gastos de Oficina</option>
                  <option value="Gastos de Operación" style={{ backgroundColor: '#0d1117', color: '#c9d1d9' }}>Gastos de Operación</option>
                </select>
              </div>
              
              <div className="form-group" style={{ position: 'relative' }}>
                <label style={{ display: 'block', marginBottom: '8px', color: '#c9d1d9', fontSize: '0.85rem' }}>Unidad {configuracion.requeridos.unidad && <RequeridoMark />}</label>
                <input type="text" required={configuracion.requeridos.unidad && !formData.unidadId} value={searchUnidad} onChange={(e) => { setSearchUnidad(e.target.value); setShowUnidad(true); if (formData.unidadId) setFormData(prev => ({ ...prev, unidadId: '' })); }} onFocus={() => setShowUnidad(true)} readOnly={formData.tipoGasto === 'Gastos de Oficina'} style={{ width: '100%', padding: '10px', backgroundColor: formData.tipoGasto === 'Gastos de Oficina' ? '#161b22' : '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9' }} placeholder={formData.tipoGasto === 'Gastos de Oficina' ? '' : 'Buscar unidad...'} />
                {showUnidad && formData.tipoGasto !== 'Gastos de Oficina' && searchUnidad && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#161b22', border: '1px solid #30363d', zIndex: 10, maxHeight: '150px', overflowY: 'auto' }}>
                    {unidadesFiltro.length === 0 ? <div style={{ padding: '8px', color: '#8b949e', fontSize: '0.85rem' }}>Sin resultados</div> : unidadesFiltro.map((u:any) => (
                      <div key={u.id} style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid #21262d' }} onClick={() => { setFormData(prev => ({...prev, unidadId: u.id})); setSearchUnidad(u.unidad || u.numeroEconomico || u.nombre); setShowUnidad(false); }}>
                        <div style={{ fontWeight: 'bold', color: '#c9d1d9' }}>{u.unidad || u.numeroEconomico || u.nombre}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="form-group" style={{ position: 'relative' }}>
                <label style={{ display: 'block', marginBottom: '8px', color: '#c9d1d9', fontSize: '0.85rem' }}>Operador {configuracion.requeridos.operador && <RequeridoMark />}</label>
                <input type="text" required={configuracion.requeridos.operador && !formData.operadorId} value={searchOperador} onChange={(e) => { setSearchOperador(e.target.value); setShowOperador(true); if (formData.operadorId) setFormData(prev => ({ ...prev, operadorId: '', operadorNombre: '' })); }} onFocus={() => setShowOperador(true)} readOnly={formData.tipoGasto === 'Gastos de Oficina'} style={{ width: '100%', padding: '10px', backgroundColor: formData.tipoGasto === 'Gastos de Oficina' ? '#161b22' : '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9' }} placeholder={formData.tipoGasto === 'Gastos de Oficina' ? '' : 'Buscar empleado...'} />
                {showOperador && formData.tipoGasto !== 'Gastos de Oficina' && searchOperador && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#161b22', border: '1px solid #30363d', zIndex: 10, maxHeight: '150px', overflowY: 'auto' }}>
                    {operadoresFiltro.length === 0 ? <div style={{ padding: '8px', color: '#8b949e', fontSize: '0.85rem' }}>Sin resultados</div> : operadoresFiltro.map((e:any) => {
                      const fullName = `${e.firstName || ''} ${e.lastNamePaternal || ''}`.trim();
                      return (
                        <div key={e.id} style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid #21262d' }} onClick={() => { setFormData(prev => ({...prev, operadorId: e.id, operadorNombre: fullName, operador: fullName})); setSearchOperador(fullName); setShowOperador(false); }}>
                          <div style={{ fontWeight: 'bold', color: '#c9d1d9' }}>{fullName}</div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* ✅ DESCRIPCIÓN GENERAL: AHORA ADMITE SALTOS DE LÍNEA (TEXTAREA) */}
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', marginBottom: '8px', color: '#c9d1d9', fontSize: '0.85rem' }}>Descripción General {configuracion.requeridos.descripcion && <RequeridoMark />}</label>
                <textarea
                  name="descripcion"
                  required={configuracion.requeridos.descripcion}
                  value={formData.descripcion}
                  onChange={handleChange}
                  rows={4}
                  placeholder="Escribe la descripción. Presiona Enter para agregar saltos de línea..."
                  style={{ width: '100%', padding: '10px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', minHeight: '90px', resize: 'vertical', fontFamily: 'inherit', fontSize: '0.9rem', lineHeight: '1.5', boxSizing: 'border-box' }}
                />
              </div>
            </div>
          )}

          {/* PESTAÑA 2: DETALLES FINANCIEROS */}
          {pestañaActiva === 'finanzas' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', animation: 'fadeIn 0.2s ease' }}>
              
              <div className="form-group" style={{ position: 'relative' }}>
                <label style={{ display: 'block', marginBottom: '8px', color: '#c9d1d9', fontSize: '0.85rem' }}>Proveedor {configuracion.requeridos.proveedor && <RequeridoMark />}</label>
                <input type="text" required={configuracion.requeridos.proveedor && !formData.proveedorId} value={searchProveedor} onChange={(e) => { setSearchProveedor(e.target.value); setShowProveedor(true); }} onFocus={() => setShowProveedor(true)} placeholder="Buscar proveedor..." style={{ width: '100%', padding: '10px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9' }} />
                {showProveedor && searchProveedor && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#161b22', border: '1px solid #30363d', zIndex: 10, maxHeight: '150px', overflowY: 'auto' }}>
                    {proveedoresFiltro.map((p:any) => {
                      const dirProveedor = p.direccion || p.domicilio || p.direccionFiscal || p.direccion_fiscal || p.calle || p.ubicacion || '';
                      return (
                      <div 
                        key={p.id} 
                        style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid #21262d' }} 
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
                        <div style={{ fontWeight: 'bold', color: '#c9d1d9' }}>{p.nombre}</div>
                        {dirProveedor && <div style={{ fontSize: '0.8rem', color: '#8b949e', marginTop: '2px', whiteSpace: 'normal' }}>{dirProveedor}</div>}
                      </div>
                      );
                    })}
                  </div>
                )}
              </div>
              
              {/* ENUMLIST: TIPO DE SERVICIO */}
              <div className="form-group" style={{ position: 'relative' }}>
                <label style={{ display: 'block', marginBottom: '8px', color: '#c9d1d9', fontSize: '0.85rem' }}>Tipo de Servicio {configuracion.requeridos.tipoServicio && <RequeridoMark />}</label>
                
                <div 
                  onClick={() => { if(formData.proveedorId) setShowServicios(!showServicios); }} 
                  style={{ width: '100%', padding: '8px 10px', backgroundColor: formData.proveedorId ? '#0d1117' : '#161b22', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', cursor: formData.proveedorId ? 'pointer' : 'not-allowed', minHeight: '40px', display: 'flex', flexWrap: 'wrap', gap: '6px', boxSizing: 'border-box' }}
                >
                  {formData.tipoServicioId.length === 0 && <span style={{ color: '#8b949e', marginTop: '2px' }}>{formData.proveedorId ? '-- Seleccionar Servicios --' : 'Selecciona un proveedor primero'}</span>}
                  
                  {formData.tipoServicioId.map(idSel => {
                    const nombreServicio = opcionesServicios.find((o:any) => o.id === idSel)?.nombre || idSel;
                    return (
                      <span key={idSel} style={{ backgroundColor: '#21262d', padding: '4px 8px', borderRadius: '16px', fontSize: '0.8rem', border: '1px solid #30363d', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {nombreServicio}
                        <span onClick={(e) => { e.stopPropagation(); toggleServicio(idSel); }} style={{ color: '#f85149', fontWeight: 'bold', cursor: 'pointer', fontSize: '1rem', lineHeight: '10px' }}>×</span>
                      </span>
                    )
                  })}
                </div>

                {showServicios && formData.proveedorId && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#161b22', border: '1px solid #30363d', zIndex: 20, maxHeight: '200px', overflowY: 'auto', borderRadius: '6px', marginTop: '4px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
                    {opcionesServicios.length === 0 ? (
                      <div style={{ padding: '12px', color: '#8b949e', fontSize: '0.85rem', textAlign: 'center' }}>Este proveedor no tiene servicios vinculados.</div>
                    ) : (
                      opcionesServicios.map((op:any) => (
                        <label key={op.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid #21262d', color: '#c9d1d9', fontSize: '0.9rem', transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = '#21262d'} onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                          <input type="checkbox" checked={formData.tipoServicioId.includes(op.id)} onChange={() => toggleServicio(op.id)} style={{ accentColor: '#D84315', width: '16px', height: '16px' }} />
                          {op.nombre}
                        </label>
                      ))
                    )}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label style={{ display: 'block', marginBottom: '8px', color: '#c9d1d9', fontSize: '0.85rem' }}>Condición de Pago {configuracion.requeridos.condicionPago && <RequeridoMark />}</label>
                <select name="condicionPago" required={configuracion.requeridos.condicionPago} value={formData.condicionPago} onChange={handleChange} style={{ width: '100%', padding: '10px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9' }}>
                  <option value="" style={{ backgroundColor: '#0d1117', color: '#c9d1d9' }}>-- Seleccionar --</option>
                  <option value="Crédito" style={{ backgroundColor: '#0d1117', color: '#c9d1d9' }}>Crédito</option>
                  <option value="Contado" style={{ backgroundColor: '#0d1117', color: '#c9d1d9' }}>Contado</option>
                </select>
              </div>

              {/* CAMPO CONDICIONAL DE PLAZO */}
              {formData.condicionPago === 'Crédito' && (
                <div className="form-group" style={{ animation: 'fadeIn 0.2s ease' }}>
                  <label style={{ display: 'block', marginBottom: '8px', color: '#c9d1d9', fontSize: '0.85rem' }}>Plazo (Días) {configuracion.requeridos.plazo && <RequeridoMark />}</label>
                  <input type="number" name="plazo" placeholder="Ej. 15, 30" required={configuracion.requeridos.plazo} value={formData.plazo} onChange={handleChange} style={{ width: '100%', padding: '10px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9' }} />
                </div>
              )}

              <div className="form-group">
                <label style={{ display: 'block', marginBottom: '8px', color: '#c9d1d9', fontSize: '0.85rem' }}>Moneda {configuracion.requeridos.moneda && <RequeridoMark />}</label>
                <select name="monedaId" required={configuracion.requeridos.moneda} value={formData.monedaId} onChange={handleChange} style={{ width: '100%', padding: '10px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9' }}>
                  <option value="" style={{ backgroundColor: '#0d1117', color: '#c9d1d9' }}>-- Seleccionar --</option>
                  {listaMonedasLocal.map((m:any) => (
                    <option key={m.id} value={m.id} style={{ backgroundColor: '#0d1117', color: '#c9d1d9' }}>
                      {m.moneda || m.nombre || m.clave}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ gridColumn: '1 / -1' }}><hr style={{ borderColor: '#30363d' }} /></div>

              <div className="form-group">
                <label style={{ display: 'block', marginBottom: '8px', color: '#58a6ff', fontSize: '0.85rem', fontWeight: 'bold' }}>Importe (Monto Base) {configuracion.requeridos.importe && <RequeridoMark />}</label>
                <input type="number" step="0.01" name="importe" required={configuracion.requeridos.importe} value={formData.importe} onChange={handleChange} style={{ width: '100%', padding: '10px', backgroundColor: '#0d1117', border: '1px solid #58a6ff', borderRadius: '6px', color: '#58a6ff', fontWeight: 'bold' }} />
              </div>
              <div className="form-group">
                <label style={{ display: 'block', marginBottom: '8px', color: '#c9d1d9', fontSize: '0.85rem' }}>IVA (%)</label>
                <select name="ivaPorcentaje" value={formData.ivaPorcentaje} onChange={handleChange} style={{ width: '100%', padding: '10px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9' }}>
                  <option value="0" style={{ backgroundColor: '#0d1117', color: '#c9d1d9' }}>0%</option>
                  <option value="8" style={{ backgroundColor: '#0d1117', color: '#c9d1d9' }}>8%</option>
                  <option value="16" style={{ backgroundColor: '#0d1117', color: '#c9d1d9' }}>16%</option>
                </select>
              </div>
              <div className="form-group">
                <label style={{ display: 'block', marginBottom: '8px', color: '#8b949e', fontSize: '0.85rem' }}>IVA ($) Calculado (+)</label>
                <input type="text" readOnly value={`$ ${formData.ivaMonto.toFixed(2)}`} style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '6px', color: '#8b949e' }} />
              </div>
              <div className="form-group">
                <label style={{ display: 'block', marginBottom: '8px', color: '#c9d1d9', fontSize: '0.85rem' }}>RET IVA ($) (-)</label>
                <input type="number" step="0.01" name="retIva" value={formData.retIva} onChange={handleChange} style={{ width: '100%', padding: '10px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#f85149' }} />
              </div>
              <div className="form-group">
                <label style={{ display: 'block', marginBottom: '8px', color: '#c9d1d9', fontSize: '0.85rem' }}>RET ISR ($) (-)</label>
                <input type="number" step="0.01" name="retIsr" value={formData.retIsr} onChange={handleChange} style={{ width: '100%', padding: '10px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#f85149' }} />
              </div>

              <div className="form-group" style={{ gridColumn: 'span 2', backgroundColor: '#161b22', padding: '16px', borderRadius: '8px', border: '1px solid #3fb950' }}>
                <label style={{ display: 'block', marginBottom: '8px', color: '#8b949e', fontSize: '0.85rem', textTransform: 'uppercase' }}>TOTAL FINAL</label>
                <div style={{ color: '#3fb950', fontSize: '1.8rem', fontWeight: 'bold' }}>$ {formData.total.toFixed(2)}</div>
              </div>
            </div>
          )}

          {/* PESTAÑA 3: DOCUMENTOS Y CIERRE */}
          {pestañaActiva === 'documentos' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', animation: 'fadeIn 0.2s ease' }}>
              <div className="form-group">
                <label style={{ display: 'block', marginBottom: '8px', color: '#c9d1d9', fontSize: '0.85rem' }}>Factura (Texto) {configuracion.requeridos.facturaTexto && <RequeridoMark />}</label>
                <input type="text" name="facturaTexto" required={configuracion.requeridos.facturaTexto} value={formData.facturaTexto} onChange={handleChange} style={{ width: '100%', padding: '10px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9' }} />
              </div>
              <div className="form-group">
                <label style={{ display: 'block', marginBottom: '8px', color: '#c9d1d9', fontSize: '0.85rem' }}>Fecha de Factura {configuracion.requeridos.fechaFactura && <RequeridoMark />}</label>
                <input type="date" name="fechaFactura" required={configuracion.requeridos.fechaFactura} value={formData.fechaFactura} onChange={handleChange} style={{ width: '100%', padding: '10px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9' }} />
              </div>
              <div className="form-group">
                <label style={{ display: 'block', marginBottom: '8px', color: '#c9d1d9', fontSize: '0.85rem' }}>Descripción Factura {configuracion.requeridos.descripcionFactura && <RequeridoMark />}</label>
                <input type="text" name="descripcionFactura" required={configuracion.requeridos.descripcionFactura} value={formData.descripcionFactura} onChange={handleChange} style={{ width: '100%', padding: '10px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9' }} />
              </div>
              <div className="form-group">
                <label style={{ display: 'block', marginBottom: '8px', color: '#c9d1d9', fontSize: '0.85rem' }}>Archivo (PDF) {configuracion.requeridos.archivoPdf && <RequeridoMark />}</label>
                <input type="file" accept=".pdf" required={configuracion.requeridos.archivoPdf && !initialData?.archivoPdfUrl} onChange={handleFileChange} style={{ width: '100%', padding: '10px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9' }} />
              </div>
              <div className="form-group">
                <label style={{ display: 'block', marginBottom: '8px', color: '#c9d1d9', fontSize: '0.85rem' }}>Fecha de Pago {configuracion.requeridos.fechaPago && <RequeridoMark />}</label>
                <input type="date" name="fechaPago" required={configuracion.requeridos.fechaPago} value={formData.fechaPago} onChange={handleChange} style={{ width: '100%', padding: '10px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9' }} />
              </div>
              <div className="form-group">
                <label style={{ display: 'block', marginBottom: '8px', color: '#c9d1d9', fontSize: '0.85rem' }}>Forma de Pago {configuracion.requeridos.formaPago && <RequeridoMark />}</label>
                <select name="formaPagoId" required={configuracion.requeridos.formaPago} value={formData.formaPagoId} onChange={handleChange} style={{ width: '100%', padding: '10px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9' }}>
                  <option value="" style={{ backgroundColor: '#0d1117', color: '#c9d1d9' }}>-- Seleccionar --</option>
                  {listaFormasPagoLocal.map((f:any) => <option key={f.id} value={f.id} style={{ backgroundColor: '#0d1117', color: '#c9d1d9' }}>{f.forma_pago || f.nombre || f.clave}</option>)}
                </select>
              </div>
              
              <div className="form-group">
                <label style={{ display: 'block', marginBottom: '8px', color: '#c9d1d9', fontSize: '0.85rem' }}>Autorizado Por <span style={{ fontSize: '0.7rem', color: '#8b949e' }}>(Por Configuración)</span></label>
                <input type="text" readOnly value={formData.autorizadoPor || configuracion.autorizadorNombreFijo || 'No asignado en configuración'} style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', cursor: 'not-allowed' }} />
              </div>

              <div className="form-group" style={{ position: 'relative', gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', marginBottom: '8px', color: '#c9d1d9', fontSize: '0.85rem' }}>Asignar a Operación {configuracion.requeridos.operacionAsignada && <RequeridoMark />}</label>
                <input type="text" required={configuracion.requeridos.operacionAsignada && !formData.operacionAsignadaId} value={searchOperacion} onChange={(e) => { setSearchOperacion(e.target.value); setShowOperacion(true); }} onFocus={() => setShowOperacion(true)} placeholder="Buscar # Referencia..." style={{ width: '100%', padding: '10px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9' }} />
                {showOperacion && searchOperacion && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#161b22', border: '1px solid #30363d', zIndex: 10, maxHeight: '150px', overflowY: 'auto' }}>
                    {operacionesFiltro.map((o:any) => (
                      <div key={o.id} style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid #21262d' }} onClick={() => { setFormData(prev => ({...prev, operacionAsignadaId: o.id})); setSearchOperacion(o.ref || o.id); setShowOperacion(false); }}>{o.ref || o.id}</div>
                    ))}
                  </div>
                )}
              </div>
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', marginBottom: '8px', color: '#c9d1d9', fontSize: '0.85rem' }}>Observaciones {configuracion.requeridos.observaciones && <RequeridoMark />}</label>
                <textarea name="observaciones" required={configuracion.requeridos.observaciones} value={formData.observaciones} onChange={handleChange} style={{ width: '100%', padding: '10px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', minHeight: '80px', resize: 'vertical' }} />
              </div>
            </div>
          )}
          
        </form>

        {/* PIE DEL MODAL PRINCIPAL */}
        <div className="form-actions" style={{ padding: '16px 24px', display: 'flex', justifyContent: 'flex-end', gap: '12px', backgroundColor: '#161b22', borderTop: '1px solid #30363d', borderBottomLeftRadius: '8px', borderBottomRightRadius: '8px', flexShrink: 0 }}>
          <button type="button" onClick={onClose} disabled={cargando} style={{ padding: '10px 20px', borderRadius: '6px', backgroundColor: 'transparent', border: '1px solid #8b949e', color: '#c9d1d9', cursor: 'pointer', transition: 'all 0.2s' }}>Cancelar</button>
          <button onClick={handleSubmit} disabled={cargando} style={{ padding: '10px 20px', borderRadius: '6px', backgroundColor: '#D84315', border: 'none', color: '#fff', fontWeight: 'bold', cursor: cargando ? 'not-allowed' : 'pointer', transition: 'all 0.2s' }}>{cargando ? 'Guardando...' : (initialData ? 'Actualizar Gasto' : 'Guardar Gasto')}</button>
        </div>

      </div>

      {/* MODAL SUPERPUESTO DE CONFIGURACIÓN */}
      {showConfig && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', width: '500px', maxWidth: '90%', padding: '24px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
            <h3 style={{ margin: '0 0 20px 0', color: '#f0f6fc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              Configuración del Formulario
              <button onClick={() => setShowConfig(false)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </h3>
            
            <div style={{ marginBottom: '24px' }}>
              <h4 style={{ color: '#58a6ff', margin: '0 0 12px 0', fontSize: '0.95rem' }}>Autorizador por Defecto</h4>
              <p style={{ fontSize: '0.8rem', color: '#8b949e', margin: '0 0 12px 0' }}>Este empleado se asignará automáticamente en el campo "Autorizado Por" de todos los nuevos gastos.</p>
              
              <div style={{ position: 'relative' }}>
                <input type="text" placeholder="Buscar empleado..." value={searchAutorizadorConfig} onChange={(e) => { setSearchAutorizadorConfig(e.target.value); setShowAutorizadorConfig(true); }} onFocus={() => setShowAutorizadorConfig(true)} style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9' }} />
                {showAutorizadorConfig && searchAutorizadorConfig && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#21262d', border: '1px solid #30363d', zIndex: 10, maxHeight: '150px', overflowY: 'auto', borderRadius: '6px', marginTop: '4px' }}>
                    {listaEmpleadosLocal.filter((e:any) => {
                      const fName = `${e.firstName || ''} ${e.lastNamePaternal || ''}`.trim();
                      return fName.toLowerCase().includes(searchAutorizadorConfig.toLowerCase());
                    }).map((e:any) => {
                      const fName = `${e.firstName || ''} ${e.lastNamePaternal || ''}`.trim();
                      return (
                        <div key={e.id} style={{ padding: '10px', cursor: 'pointer', borderBottom: '1px solid #30363d', color: '#c9d1d9' }} onClick={() => { guardarConfiguracion({ ...configuracion, autorizadorFijo: e.id, autorizadorNombreFijo: fName }); setSearchAutorizadorConfig(fName); setShowAutorizadorConfig(false); }}>
                          {fName}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            <div>
              <h4 style={{ color: '#58a6ff', margin: '0 0 12px 0', fontSize: '0.95rem' }}>Campos Obligatorios</h4>
              <p style={{ fontSize: '0.8rem', color: '#8b949e', margin: '0 0 12px 0' }}>Selecciona qué campos no pueden dejarse en blanco al guardar.</p>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                {Object.keys(configuracion.requeridos).map((key) => (
                  <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#c9d1d9', fontSize: '0.85rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={configuracion.requeridos[key]} onChange={() => toggleRequerido(key)} style={{ accentColor: '#D84315', width: '16px', height: '16px' }} />
                    {key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1')}
                  </label>
                ))}
              </div>
            </div>

            <div style={{ marginTop: '24px', textAlign: 'right' }}>
              <button onClick={() => setShowConfig(false)} style={{ padding: '8px 24px', borderRadius: '6px', backgroundColor: '#D84315', border: 'none', color: '#fff', fontWeight: 'bold', cursor: 'pointer' }}>Hecho</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};