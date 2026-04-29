// src/features/operaciones/components/FormularioOperacion.tsx
import { useState, useEffect } from 'react';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { guardarOperacionSegura } from '../services/operacionesService';
import { calcularStatusDinamico } from '../config/statusRules';

interface FormProps {
  estado: 'abierto' | 'minimizado';
  initialData?: any;
  onClose: () => void;
  onMinimize: () => void;
  onRestore: () => void;
  catalogosCacheados: any;
  onSave?: (opNueva: any) => void; 
}

type TabType = 'general' | 'pedimento' | 'manifiesto' | 'unidad' | 'cobrar';

const ID_USD = '7dca62b3';
const ID_MXN = 'f95d8894';

export const FormularioOperacion = ({ estado, initialData, onClose, onMinimize, onRestore, catalogosCacheados, onSave }: FormProps) => {
  const [pestañaActiva, setPestañaActiva] = useState<TabType>('general');
  const [cargando, setCargando] = useState(false);

  const [statusPreview, setStatusPreview] = useState<string>('');
  const [statusError, setStatusError] = useState<string | null>(null);

  const {
    empresas = [],
    tiposOperacion = [],
    embalajes = [],
    remolques = [],
    tarifas = [],
    conveniosProv = [],
    catalogoTC = [],
    catalogoConvClientes = [],
    catalogoConvDetalles = [],
    catalogoConvProvDetalles = [],
    unidades = [],      
    empleados = [], 
    unidadesProveedor = catalogosCacheados?.unidades_proveedor || [],
    proveedoresUnidad = catalogosCacheados?.proveedores_unidad || []
  } = catalogosCacheados || {};

  const [listaEmpleadosLocal, setListaEmpleadosLocal] = useState<any[]>(empleados);
  const [listaUniProvLocal, setListaUniProvLocal] = useState<any[]>(unidadesProveedor);
  const [listaOpeProvLocal, setListaOpeProvLocal] = useState<any[]>(proveedoresUnidad);

  const [listaConveniosCliente, setListaConveniosCliente] = useState<any[]>([]);
  const [listaConveniosProveedor, setListaConveniosProveedor] = useState<any[]>([]);
  
  const [tipoCambioDia, setTipoCambioDia] = useState<number | null>(null);
  const [buscandoTC, setBuscandoTC] = useState(false);

  const [searchOrigen, setSearchOrigen] = useState('');
  const [showDropdownOrigen, setShowDropdownOrigen] = useState(false);
  const [searchDestino, setSearchDestino] = useState('');
  const [showDropdownDestino, setShowDropdownDestino] = useState(false);
  const [searchClientePaga, setSearchClientePaga] = useState('');
  const [showDropdownClientePaga, setShowDropdownClientePaga] = useState(false);
  const [searchRemolque, setSearchRemolque] = useState('');
  const [showDropdownRemolque, setShowDropdownRemolque] = useState(false);
  const [searchClienteMercancia, setSearchClienteMercancia] = useState('');
  const [showDropdownClienteMercancia, setShowDropdownClienteMercancia] = useState(false);
  const [searchProvServicios, setSearchProvServicios] = useState('');
  const [showDropdownProvServicios, setShowDropdownProvServicios] = useState(false);
  const [searchProvTransporte, setSearchProvTransporte] = useState('');
  const [showDropdownProvTransporte, setShowDropdownProvTransporte] = useState(false);
  const [searchUnidad, setSearchUnidad] = useState('');
  const [showDropdownUnidad, setShowDropdownUnidad] = useState(false);
  
  const [searchOperador, setSearchOperador] = useState('');
  const [showDropdownOperador, setShowDropdownOperador] = useState(false);
  const [searchUnidadProveedor, setSearchUnidadProveedor] = useState('');
  const [showDropdownUnidadProveedor, setShowDropdownUnidadProveedor] = useState(false);
  const [searchOperadorProveedor, setSearchOperadorProveedor] = useState('');
  const [showDropdownOperadorProveedor, setShowDropdownOperadorProveedor] = useState(false);

  const [formData, setFormData] = useState({
    tipoServicio: '', trafico: '', carga: '',
    
    tipoOperacionId: '',
    fechaServicio: new Date().toISOString().split('T')[0],
    fechaCita: '',
    clientePaga: '', convenio: '', convenioNombre: '', numeroRemolque: '', refCliente: '',
    origen: '', destino: '', observacionesEjecutivo: '',
    
    clienteMercancia: '', descripcionMercancia: '', cantidad: '', embalaje: '',
    pesoKg: '', numDoda: '', fechaEmisionDoda: '',
    pdfCartaPorte: null as File | null, pdfDoda: null as File | null,
    
    numeroEntrys: '', cantEntrys: 0, numManifiesto: '', provServicios: '', montoManifiesto: 0,
    pdfManifiesto: null as File | null, pdfsEntrys: [] as (File | null)[],
    
    proveedorUnidad: '', facturadoEnUnidad: '', convenioProveedor: '', monedaConvenioProv: '',
    totalAPagarProv: 0, cargosAdicionalesProv: 0, subtotalProv: 0, 
    dolaresProv: 0, pesosProv: 0, conversionProv: 0,
    
    unidad: '', operador: '', sueldoOperador: 0, sueldoExtra: 0, sueldoTotal: 0, 
    combustible: 0, combustibleExtra: 0, combustibleTotal: 0,
    
    unidadProveedor: '', operadorProveedor: '', observacionesUnidad: '', observacionesCobrar: '',

    totalGastos: 0,

    facturadoEnCobrar: '', monedaConvenioCliente: '', montoConvenioCliente: 0,
    cargosAdicionales: 0, subtotalCliente: 0,
    dolaresCliente: 0, pesosCliente: 0, conversionCliente: 0,
    utilidadEstimada: 0, tipoCambioAprobado: 0
  });

  useEffect(() => {
    const cargarFaltantes = async () => {
      try {
        if (!empleados || empleados.length === 0) {
          const snap = await getDocs(collection(db, 'empleados'));
          setListaEmpleadosLocal(snap.docs.map(d => ({id: d.id, ...d.data()})));
        }
        if (!unidadesProveedor || unidadesProveedor.length === 0) {
          const snap = await getDocs(collection(db, 'unidades_proveedor'));
          setListaUniProvLocal(snap.docs.map(d => ({id: d.id, ...d.data()})));
        }
        if (!proveedoresUnidad || proveedoresUnidad.length === 0) {
          const snap = await getDocs(collection(db, 'proveedores_unidad'));
          setListaOpeProvLocal(snap.docs.map(d => ({id: d.id, ...d.data()})));
        }
      } catch (error) {
        console.warn("Fallo cargando catálogos faltantes locales:", error);
      }
    };
    cargarFaltantes();
  }, [empleados, unidadesProveedor, proveedoresUnidad]);

  const buildConfigId = () => {
    let tipoOpText = tiposOperacion?.find((op: any) => op.id === formData.tipoOperacionId)?.tipo_operacion || 'N/A';
    
    if (tipoOpText.toLowerCase() === 'logistica') {
      tipoOpText = 'Logística';
    } else if (tipoOpText !== 'N/A') {
      tipoOpText = tipoOpText.charAt(0).toUpperCase() + tipoOpText.slice(1).toLowerCase();
    }

    const formatTitleCase = (str: string) => {
      if (!str || str === 'N/A') return 'N/A';
      return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
    };

    return `${tipoOpText}_${formatTitleCase(formData.trafico)}_${formatTitleCase(formData.carga)}`;
  };

  useEffect(() => {
    const timerId = setTimeout(async () => {
      const configId = buildConfigId();
      
      if (!configId || configId.includes('N/A') || configId === '__' || !formData.tipoOperacionId) {
        setStatusPreview('');
        setStatusError('Para conocer el Estatus de la operación, primero selecciona el Tipo de Operación, un Cliente y un Convenio válido.');
        return;
      }

      try {
        const statusCalculado = await calcularStatusDinamico(configId, formData, initialData?.status);
        setStatusPreview(statusCalculado);
        setStatusError(null);
      } catch (error: any) {
        setStatusPreview('');
        const msjLimpio = error.message.replace('⛔ BLOQUEO: ', '').replace('⛔ ', '');
        setStatusError(msjLimpio);
      }
    }, 800);

    return () => clearTimeout(timerId);
  }, [formData, initialData, tiposOperacion]);

  useEffect(() => {
    const sOp = Number(formData.sueldoOperador) || 0;
    const sExt = Number(formData.sueldoExtra) || 0;
    setFormData(prev => ({ ...prev, sueldoTotal: sOp + sExt }));
  }, [formData.sueldoOperador, formData.sueldoExtra]);

  useEffect(() => {
    const cBase = Number(formData.combustible) || 0;
    const cExt = Number(formData.combustibleExtra) || 0;
    setFormData(prev => ({ ...prev, combustibleTotal: cBase + cExt }));
  }, [formData.combustible, formData.combustibleExtra]);

  useEffect(() => {
    const manifiesto = Number(formData.montoManifiesto) || 0;
    const sueldo = Number(formData.sueldoTotal) || 0;
    setFormData(prev => ({ ...prev, totalGastos: manifiesto + sueldo }));
  }, [formData.montoManifiesto, formData.sueldoTotal]);

  useEffect(() => {
    if (initialData && empresas && remolques) {
      const safeInitialData = {
        ...initialData,
        fechaCita: initialData.fechaCita || '',
        pdfsEntrys: initialData.pdfsEntrys || [],
        numeroEntrys: initialData.numeroEntrys || '', 
        cantEntrys: Number(initialData.cantEntrys) || 0,
        montoManifiesto: Number(initialData.montoManifiesto) || 0, 
        totalAPagarProv: Number(initialData.totalAPagarProv) || 0,
        cargosAdicionalesProv: Number(initialData.cargosAdicionalesProv) || 0,
        cargosAdicionales: Number(initialData.cargosAdicionales) || 0,
        sueldoOperador: Number(initialData.sueldoOperador) || 0, 
        sueldoExtra: Number(initialData.sueldoExtra) || 0,       
        combustible: Number(initialData.combustible) || 0,       
        combustibleExtra: Number(initialData.combustibleExtra) || 0,  
        unidadProveedor: initialData.unidadProveedor || '',
        operadorProveedor: initialData.operadorProveedor || '',
        observacionesUnidad: initialData.observacionesUnidad || '',
        observacionesCobrar: initialData.observacionesCobrar || '',     
        totalGastos: Number(initialData.totalGastos) || 0,
      };

      setFormData(prev => ({ ...prev, ...safeInitialData }));

      const getNombre = (id: string, catalogo: any[], campo = 'nombre') => {
        if (!id || !catalogo || !Array.isArray(catalogo)) return '';
        const item = catalogo.find(e => e.id === id);
        return item ? (item[campo] || item.descripcion || item.nombre || '') : '';
      };

      setSearchClientePaga(getNombre(initialData.clientePaga, empresas) || '');
      setSearchOrigen(getNombre(initialData.origen, empresas) || '');
      setSearchDestino(getNombre(initialData.destino, empresas) || '');
      setSearchRemolque(getNombre(initialData.numeroRemolque, remolques, 'placa') || getNombre(initialData.numeroRemolque, remolques, 'nombre') || ''); 
      setSearchClienteMercancia(getNombre(initialData.clienteMercancia, empresas) || '');
      setSearchProvServicios(getNombre(initialData.provServicios, empresas) || '');
      setSearchProvTransporte(getNombre(initialData.proveedorUnidad, empresas) || '');
      setSearchUnidad(getNombre(initialData.unidad, unidades, 'unidad') || getNombre(initialData.unidad, unidades, 'numeroEconomico') || getNombre(initialData.unidad, unidades, 'nombre') || '');
      
      const op = listaEmpleadosLocal.find((e: any) => e.id === initialData.operador);
      if (op) {
        setSearchOperador(`${op.firstName || op.nombres || op.nombre || ''} ${op.lastNamePaternal || op.apellidoPaterno || op.apPaterno || ''}`.trim());
      } else {
        setSearchOperador(initialData.operador || '');
      }

      const uProv = listaUniProvLocal.find((e: any) => e.id === initialData.unidadProveedor);
      if (uProv) {
        setSearchUnidadProveedor(uProv.numeroUnidad || uProv.numero_unidad || uProv.unidad || uProv.placas || initialData.unidadProveedor || '');
      } else {
        setSearchUnidadProveedor(initialData.unidadProveedor || '');
      }

      const opProv = listaOpeProvLocal.find((e: any) => e.id === initialData.operadorProveedor);
      if (opProv) {
        setSearchOperadorProveedor(opProv.nombre || opProv.nombres || opProv.nombreCompleto || initialData.operadorProveedor || '');
      } else {
        setSearchOperadorProveedor(initialData.operadorProveedor || '');
      }
    }
  }, [initialData, empresas, remolques, unidades, listaEmpleadosLocal, listaUniProvLocal, listaOpeProvLocal]);


  useEffect(() => {
    if (!formData.fechaServicio || !catalogoTC || catalogoTC.length === 0) return;
    setBuscandoTC(true);

    const [y, m, d] = formData.fechaServicio.split('-');
    const fechaLatina = `${d}/${m}/${y}`; 
    const fechaUS = `${m}/${d}/${y}`; 
    const fechaISO = `${y}-${m}-${d}`; 

    let tcEncontrado = null;

    for (const tc of catalogoTC) {
      const valoresFila = Object.values(tc).map((v: any) => String(v).trim());

      if (valoresFila.includes(fechaLatina) || valoresFila.includes(fechaUS) || valoresFila.includes(fechaISO)) {
        const keys = Object.keys(tc);
        const valKey = keys.find((k: any) => String(k).toLowerCase().includes('dof') || String(k).toLowerCase().includes('valor') || String(k).toLowerCase() === 'tc' || String(k).toLowerCase().includes('cambio'));
        if (valKey) tcEncontrado = Number(String(tc[valKey]).replace(/[^0-9.-]+/g, ""));
        else {
          const posiblesRates = valoresFila.map((v: any) => parseFloat(v.replace(/[^0-9.-]+/g, ""))).filter((n: any) => !isNaN(n) && n > 15 && n < 25);
          if (posiblesRates.length > 0) tcEncontrado = posiblesRates[0];
        }
        break;
      }
    }

    setTipoCambioDia(tcEncontrado);
    if(tcEncontrado && (!initialData || formData.fechaServicio !== initialData.fechaServicio)) {
       setFormData(prev => ({...prev, tipoCambioAprobado: tcEncontrado}));
    }
    setBuscandoTC(false);
  }, [formData.fechaServicio, catalogoTC, initialData]);

  // ✅ MAPEO DE CONVENIOS DE CLIENTE CON PRIORIDAD A LA DESCRIPCION DEL CATÁLOGO DE TARIFAS
  useEffect(() => {
    let clientId = formData.clientePaga;
    if (!clientId && searchClientePaga && empresas) {
       const emp = empresas.find((e:any) => e.nombre?.toLowerCase().trim() === searchClientePaga.toLowerCase().trim());
       if (emp) clientId = emp.id;
    }
    if (!clientId || !catalogoConvClientes || !Array.isArray(catalogoConvClientes)) return setListaConveniosCliente([]);

    const maestros = catalogoConvClientes.filter((c:any) => {
      const refVal = String(c.clienteId || c.cliente || c.Cliente || c.CLIENTE || c.id_cliente || c.empresa || '').trim();
      return refVal === clientId;
    });

    if (maestros.length > 0) {
      const mIds = maestros.map((m:any) => String(m.id).trim());
      const mNames = maestros.map((m:any) => String(m['# de Convenio'] || m.numeroConvenio || m.nombre || m.id).trim());
      
      const detalles = catalogoConvDetalles?.filter((d:any) => {
        const convRef = String(d.convenioId || d.convenio || d.id_convenio || d.Convenio || d.CONVENIO || '').trim();
        return mIds.includes(convRef) || mNames.includes(convRef);
      }) || [];

      const mapped = detalles.map((d:any) => {
        const tarifaId = d.tipoConvenioId || d.tipo_convenio_id || d.tipoConvenio || d.tipo_convenio || d['TIPO DE CONVENIO'];
        const tObj = tarifas?.find((t:any) => String(t.id).trim() === String(tarifaId).trim());
        const maestroAsociado = maestros.find((m:any) => m.id === d.convenioId || m.id === d.convenio || m.numeroConvenio === d.convenio || m['# de Convenio'] === d.convenio);

        return {
          id: d.id, 
          tarifaBaseId: tarifaId,
          // Prioridad absoluta a la 'descripcion' de la tabla catalogo_tarifas_referencia
          descripcion: tObj?.descripcion || tObj?.nombre || d.tipoConvenioNombre || (tarifaId ? `Desconocido (${tarifaId})` : 'Sin Asignar'),
          monedaMaestro: d.moneda || maestroAsociado?.moneda || ID_USD,
          tarifaMonto: Number(d.tarifa || d.monto || d.precio || 0),
          ...d
        };
      });
      setListaConveniosCliente(mapped);
    } else setListaConveniosCliente([]);
  }, [formData.clientePaga, searchClientePaga, catalogoConvClientes, catalogoConvDetalles, tarifas, empresas]);

  // ✅ MAPEO DE CONVENIOS DE PROVEEDOR CON PRIORIDAD A LA DESCRIPCION DEL CATÁLOGO DE TARIFAS
  useEffect(() => {
    const procesarConveniosProveedor = async () => {
      let provId = formData.proveedorUnidad;
      
      if (!provId && searchProvTransporte && empresas) {
         const prov = empresas.find((e:any) => e.nombre?.toLowerCase().trim() === searchProvTransporte.toLowerCase().trim());
         if (prov) provId = prov.id;
      }

      if (!provId || !conveniosProv || !Array.isArray(conveniosProv)) {
        return setListaConveniosProveedor([]);
      }

      const maestrosAsociados = conveniosProv.filter((c:any) => String(c.proveedorId || c.proveedor || c.id_proveedor || '').trim() === String(provId).trim());
      
      if (maestrosAsociados.length === 0) {
        return setListaConveniosProveedor([]); 
      }

      const maestroIds = maestrosAsociados.map((m:any) => String(m.id).trim());
      let detallesAsociados = [];

      if (catalogoConvProvDetalles && catalogoConvProvDetalles.length > 0) {
        detallesAsociados = catalogoConvProvDetalles.filter((d:any) => {
          const convRef = String(d.convenioId || d.convenio || d.id_convenio || '').trim();
          return maestroIds.includes(convRef);
        });
      } else {
        try {
          const detallesSnap = await getDocs(collection(db, 'convenios_proveedores_detalles'));
          const todosLosDetalles = detallesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          detallesAsociados = todosLosDetalles.filter((d:any) => maestroIds.includes(String(d.convenioId).trim()));
        } catch (error) {
          console.error("Error consultando convenios de proveedores:", error);
        }
      }

      const mapped = detallesAsociados.map((d:any) => {
        const tarifaId = d.tipoConvenioId || d.tipo_convenio || d.tarifaId || d['TIPO DE CONVENIO'];
        const tObj = tarifas?.find((t:any) => String(t.id).trim() === String(tarifaId).trim());
        const maestroParent = maestrosAsociados.find((m:any) => String(m.id).trim() === String(d.convenioId).trim());

        // Prioridad absoluta a la 'descripcion' de la tabla catalogo_tarifas_referencia
        let nombreFinal = tObj?.descripcion || tObj?.nombre || d.tipoConvenioNombre || 'Concepto sin nombre';

        return {
          id: d.id, 
          tarifaBaseId: tarifaId,
          tipoConvenioNombre: nombreFinal, 
          monedaBase: maestroParent?.monedaId || maestroParent?.moneda || d.moneda || ID_USD,
          tarifaMonto: Number(d.tarifa || d.monto || d.precio || 0)
        };
      });
      
      setListaConveniosProveedor(mapped);
    };

    procesarConveniosProveedor();
  }, [formData.proveedorUnidad, searchProvTransporte, conveniosProv, catalogoConvProvDetalles, tarifas, empresas]);

  useEffect(() => {
    const resolverFlujo = async () => {
      if (!formData.convenio) return;
      try {
        const detalleElegido = listaConveniosCliente.find((c:any) => c.id === formData.convenio);
        if (!detalleElegido) return;

        setFormData(prev => ({ 
            ...prev, 
            monedaConvenioCliente: detalleElegido.monedaMaestro, 
            montoConvenioCliente: detalleElegido.tarifaMonto 
        }));

        const tarifaObj = tarifas?.find((t:any) => t.id === detalleElegido.tarifaBaseId);
        if (tarifaObj) {
          const tipoRef = doc(db, 'catalogo_tipos_tarifarios', String(tarifaObj.tipo_operacion));
          const tipoSnap = await getDoc(tipoRef);
          if (tipoSnap.exists()) {
            setFormData(prev => ({
              ...prev,
              tipoServicio: tipoSnap.data().descripcion || 'N/A',
              trafico: tipoSnap.data().movimiento || 'N/A',
              carga: tarifaObj.estado_carga || 'N/A'
            }));
          }
        }
      } catch (error) { console.error("Error", error); }
    };
    if(!initialData) resolverFlujo();
  }, [formData.convenio, listaConveniosCliente, tarifas, initialData]);

  useEffect(() => {
    const fact = formData.facturadoEnUnidad; 
    const tc = Number(formData.tipoCambioAprobado || tipoCambioDia) || 0; 
    const subtotal = Number(formData.totalAPagarProv || 0) + Number(formData.cargosAdicionalesProv || 0);
    
    let dol = 0; let pes = 0; let conv = 0;
    
    if (fact === ID_USD) {
      dol = subtotal;
      pes = 0;
      conv = subtotal * tc;
    } else if (fact === ID_MXN) {
      dol = 0;
      pes = subtotal;
      conv = subtotal;
    }

    setFormData(prev => ({ ...prev, subtotalProv: subtotal, dolaresProv: dol, pesosProv: pes, conversionProv: conv }));
  }, [formData.facturadoEnUnidad, formData.totalAPagarProv, formData.cargosAdicionalesProv, tipoCambioDia, formData.tipoCambioAprobado]);

  useEffect(() => {
    const fact = formData.facturadoEnCobrar; 
    const tc = Number(formData.tipoCambioAprobado || tipoCambioDia) || 0; 
    const subtotal = Number(formData.montoConvenioCliente || 0) + Number(formData.cargosAdicionales || 0);
    
    let dol = 0; let pes = 0; let conv = 0;

    if (fact === ID_USD) {
      dol = subtotal;
      pes = 0;
      conv = subtotal * tc;
    } else if (fact === ID_MXN) {
      dol = 0;
      pes = subtotal;
      conv = subtotal;
    }

    const utilidad = conv - Number(formData.conversionProv || 0); 
    setFormData(prev => ({ 
      ...prev, subtotalCliente: subtotal, dolaresCliente: dol, pesosCliente: pes, conversionCliente: conv, utilidadEstimada: utilidad 
    }));
  }, [formData.facturadoEnCobrar, formData.montoConvenioCliente, formData.cargosAdicionales, tipoCambioDia, formData.conversionProv, formData.tipoCambioAprobado]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, field: string, index?: number) => {
    const file = e.target.files?.[0] || null;
    if (index !== undefined) {
      const nuevosPdfs = [...(formData.pdfsEntrys || [])]; 
      nuevosPdfs[index] = file;
      setFormData(prev => ({ ...prev, pdfsEntrys: nuevosPdfs }));
    } else {
      setFormData(prev => ({ ...prev, [field]: file }));
    }
  };

  const filClientesPaga = empresas?.filter((e:any) => e.tiposEmpresa?.includes('7eec9cbb')) || [];
  const filClientesMercancia = empresas?.filter((e:any) => e.tiposEmpresa?.includes('51246232')) || [];
  const filProveedoresServicios = empresas?.filter((e:any) => e.tiposEmpresa?.includes('11894dfd')) || [];
  const filOrigenesDestinos = empresas?.filter((e:any) => e.tiposEmpresa?.includes('6e7af5ab')) || [];
  const filProveedoresTransporte = empresas?.filter((e:any) => e.tiposEmpresa?.includes('ca21ab07')) || []; 

  const sOrigen = (searchOrigen || '').toLowerCase();
  const sDestino = (searchDestino || '').toLowerCase();
  const sClientePaga = (searchClientePaga || '').toLowerCase();
  const sRemolque = (searchRemolque || '').toLowerCase();
  const sClienteMerc = (searchClienteMercancia || '').toLowerCase();
  const sProvServicios = (searchProvServicios || '').toLowerCase();
  const sProvTransp = (searchProvTransporte || '').toLowerCase();
  const sUnidad = (searchUnidad || '').toLowerCase();
  
  const sOperador = (searchOperador || '').toLowerCase();
  const sUnidadProv = (searchUnidadProveedor || '').toLowerCase();
  const sOperadorProv = (searchOperadorProveedor || '').toLowerCase();

  const resultadosOrigen = filOrigenesDestinos.filter((e:any) => (e.nombre || '').toLowerCase().includes(sOrigen) || (e.direccion || '').toLowerCase().includes(sOrigen));
  const resultadosDestino = filOrigenesDestinos.filter((e:any) => (e.nombre || '').toLowerCase().includes(sDestino) || (e.direccion || '').toLowerCase().includes(sDestino));
  const resultadosClientePaga = filClientesPaga.filter((e:any) => (e.nombre || '').toLowerCase().includes(sClientePaga));
  const resultadosRemolque = remolques?.filter((e:any) => (e.placa || '').toLowerCase().includes(sRemolque) || (e.nombre || '').toLowerCase().includes(sRemolque)) || [];
  const resultadosClienteMercancia = filClientesMercancia.filter((e:any) => (e.nombre || '').toLowerCase().includes(sClienteMerc));
  const resultadosProvServicios = filProveedoresServicios.filter((e:any) => (e.nombre || '').toLowerCase().includes(sProvServicios));
  const resultadosProvTransporte = filProveedoresTransporte.filter((e:any) => (e.nombre || '').toLowerCase().includes(sProvTransp));
  const resultadosUnidad = unidades?.filter((u:any) => (u.unidad || u.numeroEconomico || u.nombre || '').toLowerCase().includes(sUnidad)) || [];
  
  const resultadosOperador = listaEmpleadosLocal.filter((o:any) => {
    const nombreCompleto = `${o.firstName || o.nombres || o.nombre || ''} ${o.lastNamePaternal || o.apellidoPaterno || o.apPaterno || ''}`.trim();
    return nombreCompleto.toLowerCase().includes(sOperador);
  });

  const resultadosUnidadProveedor = listaUniProvLocal.filter((u:any) => {
    const stringUnidad = String(u.numeroUnidad || u.numero_unidad || u.unidad || u.placas || u.placa || '');
    return stringUnidad.toLowerCase().includes(sUnidadProv);
  });

  const resultadosOperadorProveedor = listaOpeProvLocal.filter((o:any) => {
    const nombreOp = String(o.nombre || o.nombreCompleto || o.nombres || '');
    return nombreOp.toLowerCase().includes(sOperadorProv);
  });

  const tipoOpTextNormalizado = (tiposOperacion?.find((op: any) => op.id === formData.tipoOperacionId)?.tipo_operacion || '').toLowerCase();
  const isTransfer = tipoOpTextNormalizado.includes('transfer');
  const isLogistica = tipoOpTextNormalizado.includes('logistica') || tipoOpTextNormalizado.includes('logística');
  const isFletes = tipoOpTextNormalizado.includes('fletes') || tipoOpTextNormalizado.includes('flete');
  const isRoelca = searchProvTransporte.toLowerCase().includes('roelca');

  const showInternalFleet = isTransfer || ((isLogistica || isFletes) && isRoelca);
  const showExternalFleet = (isLogistica || isFletes) && !isRoelca;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCargando(true);
    
    try {
      const configId = buildConfigId();
      const statusCalculado = await calcularStatusDinamico(configId, formData, initialData?.status);
      const detalleDoc = listaConveniosCliente.find((c:any) => c.id === formData.convenio);
      const { pdfCartaPorte, pdfDoda, pdfManifiesto, pdfsEntrys, ...datosLimpios } = formData;
      
      const operacionData: any = { 
        ...datosLimpios, 
        convenioNombre: detalleDoc?.descripcion || formData.convenioNombre || 'Sin descripción', 
        status: statusCalculado || 'Pendiente', 
        tienePdfDoda: !!pdfDoda, 
        cantPdfsEntrys: (pdfsEntrys || []).filter(Boolean).length 
      };

      Object.keys(operacionData).forEach(key => {
        if (operacionData[key] === undefined) {
          delete operacionData[key];
        }
      });
      
      if (initialData) {
        alert(`Operación actualizada correctamente.`);
        if (onSave) onSave({ id: initialData.id, ...operacionData });
      } else {
        await guardarOperacionSegura(operacionData); 
        alert('Operación guardada exitosamente'); 
        if (onSave) onSave({ id: Date.now().toString(), ...operacionData });
      }
      onClose();
    } catch (error: any) { 
      console.error("🔥 Error crítico al guardar en Firebase:", error);
      alert(`Error al guardar: ${error.message || 'Revisa la consola (F12)'}`); 
    } finally { 
      setCargando(false); 
    }
  };

  if (!catalogosCacheados || !catalogosCacheados.empresas) return <div className={`modal-overlay`}><div className="form-card" style={{ padding: '40px', textAlign: 'center', color: '#8b949e' }}>Cargando catálogos de Roelca...</div></div>;

  return (
    <div className={`modal-overlay ${estado === 'minimizado' ? 'minimized' : ''}`}>
      <div className="form-card" style={{ maxWidth: '1000px' }}>
        <div className="form-header">
          <h2>{estado === 'minimizado' ? 'Operación en curso...' : (initialData ? `Editar Operación ${initialData.ref || initialData.id?.substring(0,6)}` : 'Nueva Operación')}</h2>
          <div className="header-actions">
            {estado === 'abierto' ? <button type="button" onClick={onMinimize} className="btn-window">🗕</button> : <button type="button" onClick={onRestore} className="btn-window restore">🗖</button>}
            <button type="button" onClick={onClose} className="btn-window close">✕</button>
          </div>
        </div>

        <div style={{ display: estado === 'minimizado' ? 'none' : 'block' }}>

          <div className="tabs-container" style={{ overflowX: 'auto', whiteSpace: 'nowrap' }}>
            <button type="button" className={`tab-button ${pestañaActiva === 'general' ? 'active' : ''}`} onClick={() => setPestañaActiva('general')}>Información General</button>
            <button type="button" className={`tab-button ${pestañaActiva === 'pedimento' ? 'active' : ''}`} onClick={() => setPestañaActiva('pedimento')}>Pedimento y CT</button>
            <button type="button" className={`tab-button ${pestañaActiva === 'manifiesto' ? 'active' : ''}`} onClick={() => setPestañaActiva('manifiesto')}>Entry's y Manifiestos</button>
            <button type="button" className={`tab-button ${pestañaActiva === 'unidad' ? 'active' : ''}`} onClick={() => setPestañaActiva('unidad')}>Unidad y Operador</button>
            <button type="button" className={`tab-button ${pestañaActiva === 'cobrar' ? 'active' : ''}`} onClick={() => setPestañaActiva('cobrar')}>Por Cobrar</button>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="tab-content" style={{ maxHeight: '60vh', overflowY: 'auto', paddingRight: '12px' }}>

              {pestañaActiva === 'general' && (
                 <div className="form-grid">
                 <div className="form-group"><label className="form-label orange">Tipo de Operación (tipoOperacionId)</label><select name="tipoOperacionId" className="form-control" value={formData.tipoOperacionId || ''} onChange={handleChange} required><option value="">-- Seleccionar --</option>{tiposOperacion?.map((op:any) => <option key={op.id} value={op.id}>{op.tipo_operacion}</option>)}</select></div>
                 <div className="form-group"><label className="form-label orange">Fecha de Servicio (fechaServicio)</label><input type="date" name="fechaServicio" className="form-control" value={formData.fechaServicio || ''} onChange={handleChange} required />{buscandoTC ? <small style={{ color: '#58a6ff' }}>Buscando TC...</small> : <small style={{ color: (formData.tipoCambioAprobado || tipoCambioDia) ? '#3fb950' : '#f85149', fontWeight: 'bold' }}>TC Oficial: {(formData.tipoCambioAprobado || tipoCambioDia) ? `$${(formData.tipoCambioAprobado || tipoCambioDia)}` : 'Sin Registro'}</small>}</div>
                 
                 {isFletes && (
                   <div className="form-group">
                     <label className="form-label orange">Fecha de Cita (fechaCita)</label>
                     <input type="datetime-local" name="fechaCita" className="form-control" value={formData.fechaCita || ''} onChange={handleChange} />
                   </div>
                 )}
                 
                 <div className="form-group" style={{ position: 'relative' }}>
                  <label className="form-label">Cliente (Paga) (clientePaga)</label>
                  <input type="text" className="form-control" placeholder="Escriba para buscar cliente..." required={!formData.clientePaga && !searchClientePaga} value={searchClientePaga} 
                  onChange={e => { setSearchClientePaga(e.target.value); setShowDropdownClientePaga(true); if (formData.clientePaga) setFormData(prev => ({ ...prev, clientePaga: '', convenio: '' })); }} 
                  onFocus={() => setShowDropdownClientePaga(true)} />
                  {showDropdownClientePaga && searchClientePaga && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#161b22', border: '1px solid #30363d', zIndex: 10, maxHeight: '200px', overflowY: 'auto' }}>
                      {resultadosClientePaga.length === 0 ? <div style={{ padding: '8px', color: '#8b949e' }}>Sin resultados</div> : resultadosClientePaga.map((c:any) => (
                        <div key={c.id} style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid #21262d' }} 
                        onClick={() => { 
                          const monedaDefault = c.monedaId || c.moneda || '';
                          setFormData(prev => ({ ...prev, clientePaga: c.id, convenio: '', facturadoEnCobrar: monedaDefault })); 
                          setSearchClientePaga(c.nombre); setShowDropdownClientePaga(false); 
                        }}>
                          <div style={{ fontWeight: 'bold', color: '#c9d1d9' }}>{c.nombre}</div>
                        </div>
                      ))}
                    </div>
                  )}
                 </div>

                 <div className="form-group"><label className="form-label">Convenio (Tarifa) (convenio)</label><select name="convenio" className="form-control" value={formData.convenio || ''} onChange={handleChange} required disabled={listaConveniosCliente.length === 0}><option value="">-- Seleccione un Convenio --</option>{listaConveniosCliente.map((c:any) => (<option key={c.id} value={c.id}>{c.descripcion}</option>))}</select>{listaConveniosCliente.length === 0 && searchClientePaga && <small style={{ color: '#8b949e' }}>Este cliente no tiene convenios asignados</small>}</div>
                 <div className="form-group" style={{ position: 'relative' }}>
                  <label className="form-label"># de Remolque (numeroRemolque)</label>
                  <input type="text" className="form-control" placeholder="Buscar remolque..." value={searchRemolque} onChange={e => { setSearchRemolque(e.target.value); setShowDropdownRemolque(true); if (formData.numeroRemolque) setFormData(prev => ({ ...prev, numeroRemolque: '' })); }} onFocus={() => setShowDropdownRemolque(true)} />
                  {showDropdownRemolque && searchRemolque && (<div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#161b22', border: '1px solid #30363d', zIndex: 10, maxHeight: '200px', overflowY: 'auto' }}>{resultadosRemolque.length === 0 ? <div style={{ padding: '8px', color: '#8b949e' }}>Sin resultados</div> : resultadosRemolque.map((r:any) => (<div key={r.id} style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid #21262d' }} onClick={() => { setFormData(prev => ({ ...prev, numeroRemolque: r.id })); setSearchRemolque(r.placa || r.nombre); setShowDropdownRemolque(false); }}><div style={{ fontWeight: 'bold', color: '#c9d1d9' }}>{r.placa || r.nombre}</div></div>))}</div>)}
                 </div>
                 <div className="form-group"><label className="form-label">Ref Cliente (refCliente)</label><input type="text" name="refCliente" className="form-control" value={formData.refCliente || ''} onChange={handleChange} /></div>
                 <div className="form-group" style={{ position: 'relative' }}><label className="form-label orange">Origen (origen)</label><input type="text" className="form-control" placeholder="Buscar origen..." value={searchOrigen} onChange={e => { setSearchOrigen(e.target.value); setShowDropdownOrigen(true); }} onFocus={() => setShowDropdownOrigen(true)} />{showDropdownOrigen && searchOrigen && (<div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#161b22', border: '1px solid #30363d', zIndex: 10, maxHeight: '200px', overflowY: 'auto' }}>{resultadosOrigen.map((o:any) => (<div key={o.id} style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid #21262d' }} onClick={() => { setFormData(prev => ({ ...prev, origen: o.id })); setSearchOrigen(o.nombre); setShowDropdownOrigen(false); }}><div style={{ fontWeight: 'bold', color: '#c9d1d9' }}>{o.nombre}</div><div style={{ fontSize: '0.8rem', color: '#8b949e' }}>{o.direccion}</div></div>))}</div>)}</div>
                 <div className="form-group" style={{ position: 'relative' }}><label className="form-label orange">Destino (destino)</label><input type="text" className="form-control" placeholder="Buscar destino..." value={searchDestino} onChange={e => { setSearchDestino(e.target.value); setShowDropdownDestino(true); }} onFocus={() => setShowDropdownDestino(true)} />{showDropdownDestino && searchDestino && (<div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#161b22', border: '1px solid #30363d', zIndex: 10, maxHeight: '200px', overflowY: 'auto' }}>{resultadosDestino.map((d:any) => (<div key={d.id} style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid #21262d' }} onClick={() => { setFormData(prev => ({ ...prev, destino: d.id })); setSearchDestino(d.nombre); setShowDropdownDestino(false); }}><div style={{ fontWeight: 'bold', color: '#c9d1d9' }}>{d.nombre}</div><div style={{ fontSize: '0.8rem', color: '#8b949e' }}>{d.direccion}</div></div>))}</div>)}</div>
                 <div className="form-group" style={{ gridColumn: 'span 2' }}><label className="form-label">Observaciones Ejecutivo (observacionesEjecutivo)</label><input type="text" name="observacionesEjecutivo" className="form-control" value={formData.observacionesEjecutivo || ''} onChange={handleChange} /></div>
               </div>
              )}

              {pestañaActiva === 'pedimento' && (
                <div className="form-grid">
                  <div className="form-group" style={{ position: 'relative', gridColumn: 'span 2' }}><label className="form-label">Cliente (Mercancía) (clienteMercancia)</label><input type="text" className="form-control" placeholder="Escriba para buscar cliente mercancía..." value={searchClienteMercancia} onChange={e => { setSearchClienteMercancia(e.target.value); setShowDropdownClienteMercancia(true); if (formData.clienteMercancia) setFormData(prev => ({ ...prev, clienteMercancia: '' })); }} onFocus={() => setShowDropdownClienteMercancia(true)} />{showDropdownClienteMercancia && searchClienteMercancia && (<div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#161b22', border: '1px solid #30363d', zIndex: 10, maxHeight: '200px', overflowY: 'auto' }}>{resultadosClienteMercancia.length === 0 ? <div style={{ padding: '8px', color: '#8b949e' }}>Sin resultados</div> : resultadosClienteMercancia.map((c:any) => (<div key={c.id} style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid #21262d' }} onClick={() => { setFormData(prev => ({ ...prev, clienteMercancia: c.id })); setSearchClienteMercancia(c.nombre); setShowDropdownClienteMercancia(false); }}><div style={{ fontWeight: 'bold', color: '#c9d1d9' }}>{c.nombre}</div></div>))}</div>)}</div>
                  <div className="form-group"><label className="form-label">Descripción de la Mercancía (descripcionMercancia)</label><input type="text" name="descripcionMercancia" className="form-control" value={formData.descripcionMercancia || ''} onChange={handleChange} /></div>
                  <div className="form-group"><label className="form-label">Cantidad (Enteros) (cantidad)</label><input type="number" step="1" name="cantidad" className="form-control" value={formData.cantidad || ''} onChange={handleChange} /></div>
                  <div className="form-group"><label className="form-label">Embalaje (embalaje)</label><select name="embalaje" className="form-control" value={formData.embalaje || ''} onChange={handleChange}><option value="">-- Seleccionar --</option>{embalajes?.map((e:any) => <option key={e.id} value={e.id}>{e.clave || e.nombre}</option>)}</select></div>
                  <div className="form-group"><label className="form-label">Peso (Kg) Decimales (pesoKg)</label><input type="number" step="0.01" name="pesoKg" className="form-control" value={formData.pesoKg || ''} onChange={handleChange} /></div>
                  <div className="form-group"><label className="form-label">PDF - Carta Porte (pdfCartaPorte)</label><input type="file" accept=".pdf" className="form-control" onChange={(e) => handleFileChange(e, 'pdfCartaPorte')} /></div>
                  <div className="form-group"><label className="form-label"># DODA (numDoda)</label><input type="text" name="numDoda" className="form-control" value={formData.numDoda || ''} onChange={handleChange} /></div>
                  <div className="form-group"><label className="form-label">Fecha de Emisión (fechaEmisionDoda)</label><input type="date" name="fechaEmisionDoda" className="form-control" value={formData.fechaEmisionDoda || ''} onChange={handleChange} /></div>
                  <div className="form-group"><label className="form-label">PDF - DODA (pdfDoda)</label><input type="file" accept=".pdf" className="form-control" onChange={(e) => handleFileChange(e, 'pdfDoda')} /></div>
                </div>
              )}

              {pestañaActiva === 'manifiesto' && (
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label"># de Entry's (numeroEntrys)</label>
                    <input type="text" name="numeroEntrys" className="form-control" value={formData.numeroEntrys || ''} onChange={handleChange} />
                  </div>
                  
                  <div className="form-group"><label className="form-label">Cantidad de Entry's (Max 10) (cantEntrys)</label><input type="number" max="10" min="0" name="cantEntrys" className="form-control" value={formData.cantEntrys || 0} onChange={(e) => { const val = Math.min(10, Math.max(0, parseInt(e.target.value) || 0)); setFormData(prev => ({ ...prev, cantEntrys: val, pdfsEntrys: new Array(val).fill(null) })); }} /></div>
                  
                  {Array.from({ length: Number(formData.cantEntrys) || 0 }).map((_, i) => (<div className="form-group" key={i}><label className="form-label">PDF Entry #{i + 1} (pdfsEntrys)</label><input type="file" accept=".pdf" className="form-control" onChange={(e) => handleFileChange(e, '', i)} /></div>))}
                  <div className="form-group" style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d' }} /></div>
                  
                  <div className="form-group"><label className="form-label"># Manifiesto (numManifiesto)</label><input type="text" name="numManifiesto" className="form-control" value={formData.numManifiesto || ''} onChange={handleChange} /></div>
                  <div className="form-group" style={{ position: 'relative' }}><label className="form-label">Proveedor de Servicios (provServicios)</label><input type="text" className="form-control" placeholder="Escriba para buscar proveedor..." value={searchProvServicios} onChange={e => { setSearchProvServicios(e.target.value); setShowDropdownProvServicios(true); if (formData.provServicios) setFormData(prev => ({ ...prev, provServicios: '' })); }} onFocus={() => setShowDropdownProvServicios(true)} />{showDropdownProvServicios && searchProvServicios && (<div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#161b22', border: '1px solid #30363d', zIndex: 10, maxHeight: '200px', overflowY: 'auto' }}>{resultadosProvServicios.length === 0 ? <div style={{ padding: '8px', color: '#8b949e' }}>Sin resultados</div> : resultadosProvServicios.map((c:any) => (<div key={c.id} style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid #21262d' }} onClick={() => { setFormData(prev => ({ ...prev, provServicios: c.id })); setSearchProvServicios(c.nombre); setShowDropdownProvServicios(false); }}><div style={{ fontWeight: 'bold', color: '#c9d1d9' }}>{c.nombre}</div></div>))}</div>)}</div>
                  
                  <div className="form-group">
                    <label className="form-label">Costo Manifiesto ($) (montoManifiesto)</label>
                    <input type="number" step="0.01" name="montoManifiesto" className="form-control" value={formData.montoManifiesto || ''} onChange={handleChange} />
                  </div>
                  
                  <div className="form-group"><label className="form-label">PDF Manifiesto (pdfManifiesto)</label><input type="file" accept=".pdf" className="form-control" onChange={(e) => handleFileChange(e, 'pdfManifiesto')} /></div>
                </div>
              )}

              {pestañaActiva === 'unidad' && (
                <div className="form-grid">
                  <div className="form-group" style={{ position: 'relative', gridColumn: 'span 3' }}>
                    <label className="form-label">Proveedor de Transporte (proveedorUnidad)</label>
                    <input type="text" className="form-control" placeholder="Escriba para buscar proveedor de transporte..." value={searchProvTransporte} 
                    onChange={e => { setSearchProvTransporte(e.target.value); setShowDropdownProvTransporte(true); if (formData.proveedorUnidad) setFormData(prev => ({ ...prev, proveedorUnidad: '', convenioProveedor: '' })); }} 
                    onFocus={() => setShowDropdownProvTransporte(true)} />
                    {showDropdownProvTransporte && searchProvTransporte && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#161b22', border: '1px solid #30363d', zIndex: 10, maxHeight: '200px', overflowY: 'auto' }}>
                        {resultadosProvTransporte.length === 0 ? <div style={{ padding: '8px', color: '#8b949e' }}>Sin resultados</div> : resultadosProvTransporte.map((p:any) => (
                          <div key={p.id} style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid #21262d' }} 
                          onClick={() => { 
                            const monedaDefault = p.monedaId || p.moneda || '';
                            setFormData(prev => ({ ...prev, proveedorUnidad: p.id, convenioProveedor: '', facturadoEnUnidad: monedaDefault })); 
                            setSearchProvTransporte(p.nombre); setShowDropdownProvTransporte(false); 
                          }}>
                            <div style={{ fontWeight: 'bold', color: '#c9d1d9' }}>{p.nombre}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', gridColumn: '1 / -1', marginBottom: '16px' }}>
                    <div className="form-group">
                      <label className="form-label">Facturado En: (facturadoEnUnidad)</label>
                      <select name="facturadoEnUnidad" className="form-control" value={formData.facturadoEnUnidad || ''} onChange={handleChange}>
                        <option value="">-- Seleccionar --</option>
                        <option value={ID_USD}>USD ($)</option>
                        <option value={ID_MXN}>MXN ($)</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Convenio Proveedor (convenioProveedor)</label>
                      <select 
                        name="convenioProveedor" 
                        className="form-control" 
                        value={formData.convenioProveedor || ''} 
                        onChange={e => { 
                          const val = e.target.value; 
                          const conv = listaConveniosProveedor.find(c => String(c.id) === val); 
                          setFormData(prev => ({ 
                            ...prev, 
                            convenioProveedor: val, 
                            monedaConvenioProv: conv ? conv.monedaBase : '',
                            totalAPagarProv: conv ? conv.tarifaMonto : 0 
                          })); 
                        }}
                        disabled={listaConveniosProveedor.length === 0}
                      >
                        <option value="">-- Seleccionar --</option>
                        {listaConveniosProveedor.map((c:any) => <option key={c.id} value={c.id}>{c.tipoConvenioNombre}</option>)}
                      </select>
                      {listaConveniosProveedor.length === 0 && searchProvTransporte && <small style={{ color: '#8b949e' }}>Este proveedor no tiene convenios registrados</small>}
                    </div>
                    <div className="form-group"><label className="form-label">Moneda del Convenio (Base) (monedaConvenioProv)</label><input type="text" className="form-control" readOnly value={formData.monedaConvenioProv === ID_USD ? 'USD' : (formData.monedaConvenioProv === ID_MXN ? 'MXN' : 'Sin Asignar')} /></div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', gridColumn: '1 / -1', marginBottom: '16px' }}>
                    <div className="form-group"><label className="form-label">Monto a Pagar (Base) (totalAPagarProv)</label><input type="number" name="totalAPagarProv" className="form-control" value={formData.totalAPagarProv || ''} onChange={handleChange} /></div>
                    <div className="form-group"><label className="form-label">Costos Adicionales (cargosAdicionalesProv)</label><input type="number" name="cargosAdicionalesProv" className="form-control" value={formData.cargosAdicionalesProv || ''} onChange={handleChange} /></div>
                    <div className="form-group"><label className="form-label orange">Subtotal (Convenio + Costos) (subtotalProv)</label><div style={{ color: '#f0f6fc', fontSize: '1.2rem', fontWeight: 'bold', padding: '8px 12px', backgroundColor: '#161b22', borderRadius: '6px', border: '1px solid #30363d' }}>${(Number(formData.subtotalProv) || 0).toFixed(2)}</div></div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', gridColumn: '1 / -1', paddingTop: '16px', borderTop: '1px solid #30363d' }}>
                    <div className="form-group"><label className="form-label">Tipo de Cambio del Día (tipoCambioAprobado)</label><input type="text" className="form-control" readOnly value={formData.tipoCambioAprobado || tipoCambioDia || 'No encontrado'} /></div>
                    <div className="form-group"><label className="form-label">Dólares (dolaresProv)</label><div style={{ color: '#3fb950', fontSize: '1.2rem', fontWeight: 'bold' }}>${(Number(formData.dolaresProv) || 0).toFixed(2)}</div></div>
                    <div className="form-group"><label className="form-label">Pesos (pesosProv)</label><div style={{ color: '#58a6ff', fontSize: '1.2rem', fontWeight: 'bold' }}>${(Number(formData.pesosProv) || 0).toFixed(2)}</div></div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', gridColumn: '1 / -1', paddingTop: '16px' }}>
                    <div className="form-group" style={{ gridColumn: '3' }}><label className="form-label orange">Conversión Final (Contabilidad) (conversionProv)</label><div style={{ color: '#f85149', fontSize: '1.2rem', fontWeight: 'bold' }}>${(Number(formData.conversionProv) || 0).toFixed(2)}</div></div>
                  </div>
                  
                  <div className="form-group" style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d' }} /></div>

                  {showInternalFleet && (
                    <>
                      <div className="form-group" style={{ position: 'relative' }}>
                        <label className="form-label">Unidad (unidad)</label>
                        <input type="text" className="form-control" placeholder="Buscar unidad..." value={searchUnidad} onChange={e => { setSearchUnidad(e.target.value); setShowDropdownUnidad(true); if (formData.unidad) setFormData(prev => ({ ...prev, unidad: '' })); }} onFocus={() => setShowDropdownUnidad(true)} />
                        {showDropdownUnidad && searchUnidad && (
                          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#161b22', border: '1px solid #30363d', zIndex: 10, maxHeight: '200px', overflowY: 'auto' }}>
                            {resultadosUnidad.map((u:any) => (
                              <div key={u.id} style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid #21262d' }} onClick={() => { setFormData(prev => ({ ...prev, unidad: u.id })); setSearchUnidad(u.unidad || u.numeroEconomico || u.nombre); setShowDropdownUnidad(false); }}>
                                <div style={{ fontWeight: 'bold', color: '#c9d1d9' }}>{u.unidad || u.numeroEconomico || u.nombre}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      
                      <div className="form-group" style={{ position: 'relative' }}>
                        <label className="form-label">Operador (operador)</label>
                        <input type="text" className="form-control" placeholder="Buscar operador..." value={searchOperador} 
                        onChange={e => { setSearchOperador(e.target.value); setShowDropdownOperador(true); if (formData.operador) setFormData(prev => ({ ...prev, operador: '' })); }} 
                        onFocus={() => setShowDropdownOperador(true)} />
                        {showDropdownOperador && searchOperador && (
                          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#161b22', border: '1px solid #30363d', zIndex: 10, maxHeight: '200px', overflowY: 'auto' }}>
                            {resultadosOperador.length === 0 ? <div style={{ padding: '8px', color: '#8b949e', fontSize: '0.85rem', textAlign: 'center' }}>Sin resultados</div> : resultadosOperador.map((o:any) => {
                              const nombreCompleto = `${o.firstName || o.nombres || o.nombre || ''} ${o.lastNamePaternal || o.apellidoPaterno || o.apPaterno || ''}`.trim();
                              return (
                                <div key={o.id} style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid #21262d' }} 
                                onClick={() => { 
                                  setFormData(prev => ({ ...prev, operador: o.id })); 
                                  setSearchOperador(nombreCompleto); 
                                  setShowDropdownOperador(false); 
                                }}>
                                  <div style={{ fontWeight: 'bold', color: '#c9d1d9' }}>{nombreCompleto}</div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      <div className="form-group">
                        <label className="form-label">Sueldo del Operador (sueldoOperador)</label>
                        <input type="number" step="0.01" name="sueldoOperador" className="form-control" value={formData.sueldoOperador || ''} onChange={handleChange} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Sueldo Extra (sueldoExtra)</label>
                        <input type="number" step="0.01" name="sueldoExtra" className="form-control" value={formData.sueldoExtra || ''} onChange={handleChange} />
                      </div>
                      <div className="form-group">
                        <label className="form-label orange">Sueldo Total (sueldoTotal)</label>
                        <div style={{ color: '#f0f6fc', fontSize: '1.2rem', fontWeight: 'bold', padding: '8px 12px', backgroundColor: '#161b22', borderRadius: '6px', border: '1px solid #30363d' }}>
                          ${(Number(formData.sueldoTotal) || 0).toFixed(2)}
                        </div>
                      </div>

                      <div className="form-group" style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d' }} /></div>
                      
                      <div className="form-group">
                        <label className="form-label">Combustible (combustible)</label>
                        <input type="number" step="0.01" name="combustible" className="form-control" value={formData.combustible || ''} onChange={handleChange} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Combustible Extra (combustibleExtra)</label>
                        <input type="number" step="0.01" name="combustibleExtra" className="form-control" value={formData.combustibleExtra || ''} onChange={handleChange} />
                      </div>
                      <div className="form-group">
                        <label className="form-label orange">Total Combustible (combustibleTotal)</label>
                        <div style={{ color: '#f0f6fc', fontSize: '1.2rem', fontWeight: 'bold', padding: '8px 12px', backgroundColor: '#161b22', borderRadius: '6px', border: '1px solid #30363d' }}>
                          ${(Number(formData.combustibleTotal) || 0).toFixed(2)}
                        </div>
                      </div>
                    </>
                  )}

                  {showExternalFleet && (
                    <>
                      <div className="form-group" style={{ position: 'relative', gridColumn: 'span 1' }}>
                        <label className="form-label" style={{ color: '#58a6ff' }}>Unidad del Proveedor (unidadProveedor)</label>
                        <input type="text" className="form-control" style={{ border: '1px solid #58a6ff' }} placeholder="Buscar unidad externa..."
                          value={searchUnidadProveedor}
                          onChange={e => { 
                              setSearchUnidadProveedor(e.target.value); 
                              setShowDropdownUnidadProveedor(true); 
                              setFormData(prev => ({ ...prev, unidadProveedor: e.target.value })); 
                          }}
                          onFocus={() => setShowDropdownUnidadProveedor(true)} />
                        {showDropdownUnidadProveedor && searchUnidadProveedor && (
                          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#161b22', border: '1px solid #30363d', zIndex: 10, maxHeight: '200px', overflowY: 'auto' }}>
                            {resultadosUnidadProveedor.length === 0 ? <div style={{ padding: '8px', color: '#8b949e', fontSize: '0.85rem' }}>Sin resultados (Se guardará como texto)</div> : resultadosUnidadProveedor.map((u:any) => {
                              const valorUnidad = u.numeroUnidad || u.numero_unidad || u.unidad || u.placas || u.placa || 'Sin Número';
                              return (
                                <div key={u.id} style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid #21262d' }} 
                                onClick={() => { 
                                    setFormData(prev => ({ ...prev, unidadProveedor: u.id })); 
                                    setSearchUnidadProveedor(valorUnidad); 
                                    setShowDropdownUnidadProveedor(false); 
                                }}>
                                  <div style={{ fontWeight: 'bold', color: '#c9d1d9' }}>{valorUnidad}</div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      <div className="form-group" style={{ position: 'relative', gridColumn: 'span 2' }}>
                        <label className="form-label" style={{ color: '#58a6ff' }}>Operador del Proveedor (operadorProveedor)</label>
                        <input type="text" className="form-control" style={{ border: '1px solid #58a6ff' }} placeholder="Buscar operador externo..."
                          value={searchOperadorProveedor}
                          onChange={e => { 
                              setSearchOperadorProveedor(e.target.value); 
                              setShowDropdownOperadorProveedor(true); 
                              setFormData(prev => ({ ...prev, operadorProveedor: e.target.value })); 
                          }}
                          onFocus={() => setShowDropdownOperadorProveedor(true)} />
                        {showDropdownOperadorProveedor && searchOperadorProveedor && (
                          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#161b22', border: '1px solid #30363d', zIndex: 10, maxHeight: '200px', overflowY: 'auto' }}>
                            {resultadosOperadorProveedor.length === 0 ? <div style={{ padding: '8px', color: '#8b949e', fontSize: '0.85rem' }}>Sin resultados (Se guardará como texto)</div> : resultadosOperadorProveedor.map((o:any) => {
                              const valorNombre = o.nombre || o.nombres || o.nombreCompleto || 'Sin Nombre';
                              return (
                                <div key={o.id} style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid #21262d' }} 
                                onClick={() => { 
                                    setFormData(prev => ({ ...prev, operadorProveedor: o.id })); 
                                    setSearchOperadorProveedor(valorNombre); 
                                    setShowDropdownOperadorProveedor(false); 
                                }}>
                                  <div style={{ fontWeight: 'bold', color: '#c9d1d9' }}>{valorNombre}</div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  <div className="form-group" style={{ gridColumn: '1 / -1', marginTop: '20px' }}>
                    <div style={{ backgroundColor: '#0d1117', border: '1px solid #f85149', padding: '20px', borderRadius: '8px', textAlign: 'center' }}>
                      <div style={{ color: '#8b949e', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>Total Gastos [Sueldos + Manifiesto] (totalGastos)</div>
                      <div style={{ color: '#f85149', fontSize: '2rem', fontWeight: 'bold' }}>${(Number(formData.totalGastos) || 0).toFixed(2)}</div>
                    </div>
                  </div>

                  <div className="form-group" style={{ gridColumn: '1 / -1', marginTop: '16px' }}>
                    <label className="form-label">Observaciones (observacionesUnidad)</label>
                    <textarea name="observacionesUnidad" className="form-control" value={formData.observacionesUnidad || ''} onChange={handleChange} placeholder="Notas adicionales sobre la unidad o proveedor..." style={{ minHeight: '80px', resize: 'vertical', width: '100%', backgroundColor: '#010409', border: '1px solid #30363d', color: '#c9d1d9', padding: '8px 12px', borderRadius: '6px' }} />
                  </div>

                </div>
              )}

              {pestañaActiva === 'cobrar' && (
                <div className="form-grid">
                  <div className="form-group"><label className="form-label">Facturado En: (facturadoEnCobrar)</label><select name="facturadoEnCobrar" className="form-control" value={formData.facturadoEnCobrar || ''} onChange={handleChange}><option value="">-- Seleccionar Moneda --</option><option value={ID_USD}>USD ($)</option><option value={ID_MXN}>MXN ($)</option></select></div>
                  <div className="form-group"><label className="form-label">Moneda Convenio (Cliente) (monedaConvenioCliente)</label><input type="text" className="form-control" readOnly value={formData.monedaConvenioCliente === ID_USD ? 'USD' : (formData.monedaConvenioCliente === ID_MXN ? 'MXN' : 'Sin Asignar')} /></div>
                  <div className="form-group"><label className="form-label">Convenio Seleccionado (Monto Base) (montoConvenioCliente)</label><input type="number" className="form-control" readOnly value={formData.montoConvenioCliente || 0} /></div>
                  <div className="form-group"><label className="form-label">Cargos Adicionales (cargosAdicionales)</label><input type="number" name="cargosAdicionales" className="form-control" value={formData.cargosAdicionales || ''} onChange={handleChange} /></div>
                  <div className="form-group"><label className="form-label orange">Subtotal (Convenio + Cargos) (subtotalCliente)</label><div style={{ color: '#f0f6fc', fontSize: '1.2rem', fontWeight: 'bold', padding: '8px 12px', backgroundColor: '#161b22', borderRadius: '6px', border: '1px solid #30363d' }}>${(Number(formData.subtotalCliente) || 0).toFixed(2)}</div></div>
                  <div className="form-group"><label className="form-label">Tipo de Cambio del Día (tipoCambioAprobado)</label><input type="text" className="form-control" readOnly value={formData.tipoCambioAprobado || tipoCambioDia || 'No encontrado'} /></div>
                  <div className="form-group" style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d' }} /></div>
                  <div className="form-group"><label className="form-label">Dólares (Cliente) (dolaresCliente)</label><div style={{ color: '#3fb950', fontSize: '1.2rem', fontWeight: 'bold' }}>${(Number(formData.dolaresCliente) || 0).toFixed(2)}</div></div>
                  <div className="form-group"><label className="form-label">Pesos (Cliente) (pesosCliente)</label><div style={{ color: '#58a6ff', fontSize: '1.2rem', fontWeight: 'bold' }}>${(Number(formData.pesosCliente) || 0).toFixed(2)}</div></div>
                  <div className="form-group"><label className="form-label orange">Conversión Final (Ingreso) (conversionCliente)</label><div style={{ color: '#f85149', fontSize: '1.2rem', fontWeight: 'bold', border: '1px solid #f85149', padding: '4px 8px', borderRadius: '4px' }}>${(Number(formData.conversionCliente) || 0).toFixed(2)}</div></div>
                  
                  <div className="form-group" style={{ gridColumn: 'span 3', marginTop: '20px' }}>
                    <div style={{ backgroundColor: '#0d1117', border: '1px solid #3fb950', padding: '20px', borderRadius: '8px', textAlign: 'center' }}>
                      <div style={{ color: '#8b949e', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>UTILIDAD ESTIMADA DE LA OPERACIÓN (utilidadEstimada)</div>
                      <div style={{ color: '#3fb950', fontSize: '2rem', fontWeight: 'bold' }}>${(Number(formData.utilidadEstimada) || 0).toFixed(2)}</div>
                    </div>
                  </div>

                  <div className="form-group" style={{ gridColumn: '1 / -1', marginTop: '16px' }}>
                    <label className="form-label">Observaciones (observacionesCobrar)</label>
                    <textarea name="observacionesCobrar" className="form-control" value={formData.observacionesCobrar || ''} onChange={handleChange} placeholder="Notas o justificaciones de cobranza..." style={{ minHeight: '80px', resize: 'vertical', width: '100%', backgroundColor: '#010409', border: '1px solid #30363d', color: '#c9d1d9', padding: '8px 12px', borderRadius: '6px' }} />
                  </div>

                </div>
              )}

            </div>
            
            <div style={{ backgroundColor: statusError ? 'rgba(248, 81, 73, 0.1)' : 'rgba(46, 160, 67, 0.1)', borderTop: '1px solid #30363d', borderBottom: '1px solid #30363d', padding: '12px 24px', display: 'flex', alignItems: 'center', gap: '12px' }}>
              {statusError ? (
                <>
                  <div style={{ fontSize: '1.5rem' }}>⚠️</div>
                  <div>
                    <div style={{ color: '#f85149', fontWeight: 'bold', fontSize: '0.9rem' }}>Atención Requerida</div>
                    <div style={{ color: '#ff7b72', fontSize: '0.85rem', whiteSpace: 'pre-wrap' }}>{statusError}</div>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: '1.5rem' }}>✅</div>
                  <div>
                    <div style={{ color: '#3fb950', fontWeight: 'bold', fontSize: '0.9rem' }}>Flujo Configurado Exitosamente</div>
                    <div style={{ color: '#7ee787', fontSize: '0.85rem' }}>Al guardar, la operación pasará al estatus: <span style={{ fontWeight: 'bold', color: '#fff', backgroundColor: '#2ea043', padding: '2px 8px', borderRadius: '12px', marginLeft: '4px' }}>{statusPreview}</span></div>
                  </div>
                </>
              )}
            </div>

            <div className="form-actions" style={{ padding: '16px 24px', display: 'flex', justifyContent: 'flex-end', gap: '12px', backgroundColor: '#0d1117' }}>
              <button type="button" className="btn btn-outline" onClick={onClose} disabled={cargando}>Cancelar</button>
              <button type="submit" className="btn btn-primary" disabled={cargando || !!statusError} style={{ opacity: !!statusError ? 0.5 : 1, cursor: !!statusError ? 'not-allowed' : 'pointer' }}>
                {cargando ? 'Guardando...' : (initialData ? 'Actualizar Operación' : 'Guardar Operación')}
              </button>
            </div>
          </form>

        </div>
      </div>
    </div>
  );
};