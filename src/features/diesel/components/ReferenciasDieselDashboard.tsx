// src/features/diesel/components/ReferenciasDieselDashboard.tsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  collection, 
  onSnapshot, 
  query, 
  getDocs, 
  where, 
  writeBatch, 
  doc, 
  limit,
  orderBy,
  getDoc,
  updateDoc
} from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { useEstadoPersistente } from '../../../hooks/useEstadoPersistente';
import * as XLSX from 'xlsx';
import { generarInstruccionesDieselPDF } from '../../../utils/pdfInstruccionesDiesel';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import './ReferenciasDieselDashboard.css';
import { hoyLocalISO } from '../../../utils/fechaHoraLocal';

// Columnas configurables de la tabla "Asignar Operaciones" (tabla + Excel).
// orden:true -> la cabecera es clicable para ordenar por ese campo.
const COLUMNAS_OPS_DIESEL_BASE = [
  { id: 'ref',           label: 'Ref. Operación', visible: true, orden: true },
  { id: 'fechaServicio', label: 'Fecha Servicio',  visible: true, orden: true },
  { id: 'unidad',        label: 'Unidad',          visible: true, orden: true },
  { id: 'operador',      label: 'Operador',        visible: true, orden: true },
  { id: 'origen',        label: 'Origen',          visible: true, orden: true },
  { id: 'destino',       label: 'Destino',         visible: true, orden: true },
  { id: 'diesel',        label: 'Diesel (Op)',     visible: true, orden: true },
  { id: 'refDiesel',     label: 'Ref. Diesel',     visible: true, orden: true },
];

// Colección de catálogo de donde se resuelven los nombres de Origen/Destino.
// Los campos op.origen / op.destino guardan un ID; aquí buscamos su nombre.
// Si tus orígenes/destinos viven en otra colección, cambia solo este valor.
const COLECCION_LUGARES = 'destinos';

// ──────────────────────────────────────────────────────────────────
// ✅ FILTRO ROBUSTO DE IDS
// Verifica si un campo de Firestore contiene un ID, sin importar si está
// guardado como array, como string separado por comas/espacios, o como
// objeto. Así el filtrado de proveedores funciona aunque el dato venga
// en distintos formatos heredados.
// ──────────────────────────────────────────────────────────────────
const incluyeId = (valor: any, id: string): boolean => {
  if (!valor) return false;
  if (Array.isArray(valor)) return valor.map(String).includes(id);
  if (typeof valor === 'string') return valor.split(/[,\s]+/).map(s => s.trim()).includes(id);
  if (typeof valor === 'object') {
    return Object.values(valor).map(String).includes(id) || Object.keys(valor).includes(id);
  }
  return false;
};

// ──────────────────────────────────────────────────────────────────
// ✅ SELECTOR DE PROVEEDOR BUSCABLE (combobox)
// Reemplaza el <select> nativo que "costaba seleccionar":
//  - Mantiene su propio estado, por lo que NO se cierra cuando el
//    componente padre se re-renderiza (p. ej. al llegar datos de Firestore).
//  - Permite filtrar escribiendo, ideal cuando hay muchos proveedores.
//  - Cierra al hacer clic fuera.
// ──────────────────────────────────────────────────────────────────
interface SelectorProveedorProps {
  proveedores: any[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  resolverNombre?: (id: string) => string;
}

const SelectorProveedorBuscable: React.FC<SelectorProveedorProps> = ({
  proveedores,
  value,
  onChange,
  placeholder = 'Seleccionar proveedor...',
  resolverNombre,
}) => {
  const [abierto, setAbierto] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const contenedorRef = useRef<HTMLDivElement>(null);

  const seleccionado = proveedores.find(p => p.id === value) || null;
  const nombreMostrado = seleccionado
    ? (seleccionado.nombre || seleccionado.id)
    : (value && resolverNombre ? resolverNombre(value) : '');

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (contenedorRef.current && !contenedorRef.current.contains(e.target as Node)) {
        setAbierto(false);
        setBusqueda('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtrados = useMemo(() => {
    const t = busqueda.trim().toLowerCase();
    if (!t) return proveedores;
    return proveedores.filter(p => String(p.nombre || '').toLowerCase().includes(t));
  }, [proveedores, busqueda]);

  return (
    <div className="rdd-x1" ref={contenedorRef}>
      <button className="rdd-x2"
        type="button"
        onClick={() => setAbierto(o => !o)}
      >
        <span style={{ color: nombreMostrado ? '#fff' : '#8b949e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {nombreMostrado || placeholder}
        </span>
        <span className="rdd-x3">{abierto ? '▲' : '▼'}</span>
      </button>

      {abierto && (
        <div className="rdd-x4">
          <div className="rdd-x5">
            <input className="rdd-x6"
              autoFocus
              type="text"
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar proveedor..."
            />
          </div>
          <ul className="rdd-x7">
            {filtrados.length === 0 ? (
              <li className="rdd-x8">Sin resultados</li>
            ) : (
              filtrados.map(p => (
                <li
                  key={p.id}
                  onClick={() => { onChange(p.id); setAbierto(false); setBusqueda(''); }}
                  style={{
                    padding: '10px 12px', cursor: 'pointer', fontSize: '0.9rem',
                    color: p.id === value ? '#fff' : '#c9d1d9',
                    backgroundColor: p.id === value ? 'rgba(216,67,21,0.15)' : 'transparent',
                    borderLeft: p.id === value ? '3px solid #D84315' : '3px solid transparent',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = '#161b22'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = p.id === value ? 'rgba(216,67,21,0.15)' : 'transparent'; }}
                >
                  {p.nombre || p.id}
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
};

// ✅ Atributos de la caja de una operación, detectados desde el nombre del
//   convenio/tarifa (ej. "Importación Caja Cargada Hazmat 240 - NLD"):
//   CARGADA o VACÍA, y si es HAZMAT. Tolerante a acentos y mayúsculas.
const atributosCajaOp = (op: any): { carga: 'CARGADA' | 'VACIA' | ''; hazmat: boolean } => {
  const txt = [op?.convenioNombre, op?.tarifaLabel, op?.tarifarioLabel, op?.tipoServicio, op?.descripcionMercancia]
    .map(x => String(x || '')).join(' ')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const carga = /vaci[ao]/.test(txt) ? 'VACIA' : (/cargad[ao]/.test(txt) ? 'CARGADA' : '');
  const hazmat = /hazmat|peligros/.test(txt);
  return { carga, hazmat };
};

export const ReferenciasDieselDashboard = () => {
  const [activeTab, setActiveTab] = useState<'operaciones' | 'referencias'>('referencias');
  
  const [operacionesGlobales, setOperacionesGlobales] = useState<any[]>([]);
  const [referenciasGlobales, setReferenciasGlobales] = useState<any[]>([]);
  
  // Catálogos
  const [unidadesList, setUnidadesList] = useState<any[]>([]);
  const [operadoresList, setOperadoresList] = useState<any[]>([]);
  const [proveedoresList, setProveedoresList] = useState<any[]>([]);
  // Catálogo de lugares (orígenes/destinos) para resolver IDs a nombres.
  const [lugaresList, setLugaresList] = useState<any[]>([]);

  // ✅ PERSISTENTE: el último filtro de unidad sobrevive recargas.
  const [filtroUnidad, setFiltroUnidad] = useEstadoPersistente('diesel_filtroUnidad', '');
  const [seleccionadas, setSeleccionadas] = useState<string[]>([]);
  // Indicador de carga de operaciones de la unidad seleccionada.
  const [cargandoOps, setCargandoOps] = useState(false);

  // Filtro Pendientes / Cargadas
  const [filtroEstadoOps, setFiltroEstadoOps] = useState<'pendientes' | 'cargadas'>('pendientes');
  // Orden de la tabla de operaciones
  const [ordenOps, setOrdenOps] = useState<{ campo: string; dir: 'asc' | 'desc' }>({ campo: 'fechaServicio', dir: 'desc' });
  // Configurador de columnas + rango de fechas de la tabla "Asignar Operaciones"
  const [modalColumnasOps, setModalColumnasOps] = useState(false);
  const [columnasOps, setColumnasOps] = useState(COLUMNAS_OPS_DIESEL_BASE.map(c => ({ ...c })));
  const [draggedColOpsIndex, setDraggedColOpsIndex] = useState<number | null>(null);
  const [fechaDesdeOps, setFechaDesdeOps] = useState('');
  const [fechaHastaOps, setFechaHastaOps] = useState('');

  const [busquedaRef, setBusquedaRef] = useState('');
  // ✅ NUEVO: panel lateral derecho de filtros + tablas VACÍAS hasta presionar Buscar.
  const [drawerFiltrosAbierto, setDrawerFiltrosAbierto] = useState(false);
  const [busquedaOpsHecha, setBusquedaOpsHecha] = useState(false);
  const [busquedaRefHecha, setBusquedaRefHecha] = useState(false);
  // ✅ NUEVO: rango de fechas del HISTORIAL (filtra por la fecha de la referencia).
  const [fechaDesdeHist, setFechaDesdeHist] = useState('');
  const [fechaHastaHist, setFechaHastaHist] = useState('');
  const [paginaActual, setPaginaActual] = useState(1);
  const registrosPorPagina = 50;
  // ✅ NUEVO: al cambiar la búsqueda o el rango de fechas del historial se
  //   regresa a la página 1 para no quedar en una página vacía.
  useEffect(() => { setPaginaActual(1); }, [busquedaRef, fechaDesdeHist, fechaHastaHist]);

  const [modalAbierto, setModalAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [referenciaViendo, setReferenciaViendo] = useState<any | null>(null);

  const [operacionAEditar, setOperacionAEditar] = useState<any | null>(null);
  const [editCombustibleOp, setEditCombustibleOp] = useState<number | ''>('');
  const [guardandoEdicionOp, setGuardandoEdicionOp] = useState(false);

  // ✅ Edición del registro completo de la referencia (modal)
  const [editandoRef, setEditandoRef] = useState<any | null>(null);
  const [formEditRef, setFormEditRef] = useState<any>({ consecutivo: '', fecha: '', proveedorId: '', galonesExtras: '', galonesCargados: '', costoDiesel: '', observaciones: '' });
  const [guardandoEdicionRef, setGuardandoEdicionRef] = useState(false);

  const [fechaForm, setFechaForm] = useState(hoyLocalISO());
  const [consecutivoForm, setConsecutivoForm] = useState('');
  // ✅ NUEVO: OPERADOR de la referencia. Se precarga automáticamente con el
  //   operador de las operaciones seleccionadas (uno solo -> su nombre;
  //   varios -> "Varios"), pero el usuario lo puede cambiar en el formulario.
  const [operadorForm, setOperadorForm] = useState('');
  // Galones Extras: editable (antes "Galones Autorizados")
  const [galonesExtras, setGalonesExtras] = useState<number | ''>('');
  // ✅ NUEVO: kilometraje REAL capturado al generar la referencia; se compara
  //   contra el kilometraje ESTIMADO que viene de las operaciones.
  const [kilometrajeReal, setKilometrajeReal] = useState<number | ''>('');
  const [galonesCargados, setGalonesCargados] = useState<number | ''>('');
  const [proveedorSeleccionado, setProveedorSeleccionado] = useState('');
  const [costoDieselDiario, setCostoDieselDiario] = useState<number>(0);
  const [observacionesForm, setObservacionesForm] = useState('');

  // ──────────────────────────────────────────────────────────────────
  // ✅ FOTOS DE LA REFERENCIA (subida a Storage: consecutivo/unidad/foto)
  // ──────────────────────────────────────────────────────────────────
  const fotoInputRef = useRef<HTMLInputElement>(null);
  const [fotosSeleccionadas, setFotosSeleccionadas] = useState<File[]>([]);
  const [arrastrandoFoto, setArrastrandoFoto] = useState(false);
  const [subiendoFotos, setSubiendoFotos] = useState(false);
  const dragDepthFoto = useRef(0);

  // Previews locales (se liberan al desmontar / cambiar la lista).
  const previewsFotos = useMemo(
    () => fotosSeleccionadas.map(f => URL.createObjectURL(f)),
    [fotosSeleccionadas]
  );
  useEffect(() => {
    return () => { previewsFotos.forEach(url => URL.revokeObjectURL(url)); };
  }, [previewsFotos]);

  // ✅ NUEVO: AGREGAR FOTOS DESDE LA FICHA (modal de detalle de la referencia).
  //   Mismo esquema que el alta: se suben a Storage (consecutivo/unidad/) y se
  //   anexan al arreglo `fotos` del documento en Firestore.
  const fotoDetalleInputRef = useRef<HTMLInputElement>(null);
  const [fotosNuevasDetalle, setFotosNuevasDetalle] = useState<File[]>([]);
  const [arrastrandoFotoDetalle, setArrastrandoFotoDetalle] = useState(false);
  const [subiendoFotosDetalle, setSubiendoFotosDetalle] = useState(false);
  const dragDepthFotoDetalle = useRef(0);

  const previewsFotosDetalle = useMemo(
    () => fotosNuevasDetalle.map(f => URL.createObjectURL(f)),
    [fotosNuevasDetalle]
  );
  useEffect(() => {
    return () => { previewsFotosDetalle.forEach(url => URL.revokeObjectURL(url)); };
  }, [previewsFotosDetalle]);

  // Al abrir/cambiar de referencia se limpia cualquier selección pendiente.
  useEffect(() => {
    setFotosNuevasDetalle([]);
    setArrastrandoFotoDetalle(false);
    dragDepthFotoDetalle.current = 0;
  }, [referenciaViendo?.id]);

  const agregarFotosDetalle = (files: FileList | File[]) => {
    const nuevas = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (nuevas.length === 0) return;
    setFotosNuevasDetalle(prev => {
      const clave = (f: File) => `${f.name}_${f.size}`;
      const existentes = new Set(prev.map(clave));
      return [...prev, ...nuevas.filter(f => !existentes.has(clave(f)))];
    });
  };
  const handleFotosDetalleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) agregarFotosDetalle(e.target.files);
    e.target.value = '';
  };
  const quitarFotoDetalle = (index: number) => {
    setFotosNuevasDetalle(prev => prev.filter((_, i) => i !== index));
  };
  const handleDragEnterFotoDetalle = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragDepthFotoDetalle.current += 1;
    setArrastrandoFotoDetalle(true);
  };
  const handleDragLeaveFotoDetalle = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragDepthFotoDetalle.current -= 1;
    if (dragDepthFotoDetalle.current <= 0) { dragDepthFotoDetalle.current = 0; setArrastrandoFotoDetalle(false); }
  };
  const handleDragOverFotoDetalle = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); };
  const handleDropFotoDetalle = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragDepthFotoDetalle.current = 0;
    setArrastrandoFotoDetalle(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) agregarFotosDetalle(e.dataTransfer.files);
  };

  // Sube las fotos seleccionadas y las anexa al documento de la referencia.
  const subirFotosDesdeDetalle = async () => {
    if (!referenciaViendo || fotosNuevasDetalle.length === 0 || subiendoFotosDetalle) return;
    setSubiendoFotosDetalle(true);
    try {
      const consecutivo = referenciaViendo.consecutivo || referenciaViendo.id;
      const unidad = referenciaViendo.unidadNombre || referenciaViendo.unidadId || referenciaViendo.unidad || 'unidad';
      const subidas = await subirFotosReferencia(consecutivo, unidad, fotosNuevasDetalle);
      const fotosFinales = [...(Array.isArray(referenciaViendo.fotos) ? referenciaViendo.fotos : []), ...subidas];
      await updateDoc(doc(db, 'referencias_diesel', referenciaViendo.id), { fotos: fotosFinales });
      // Refleja el cambio en la ficha y en la tabla sin recargar.
      setReferenciaViendo((prev: any) => (prev && prev.id === referenciaViendo.id) ? { ...prev, fotos: fotosFinales } : prev);
      setReferenciasGlobales((prev: any[]) => prev.map((r: any) => r.id === referenciaViendo.id ? { ...r, fotos: fotosFinales } : r));
      setFotosNuevasDetalle([]);
    } catch (error) {
      console.error('Error subiendo fotos desde la ficha:', error);
      alert('No se pudieron subir las fotos. Revisa tu conexión o permisos de Storage.');
    } finally {
      setSubiendoFotosDetalle(false);
    }
  };

  // Limpia un segmento de ruta de Storage. Mantiene guiones (para el
  // consecutivo tipo DIESEL-260626-001) y reemplaza lo demás por "_".
  const sanitizarSegmentoRuta = (valor: string): string =>
    String(valor || '')
      .trim()
      .replace(/[^a-zA-Z0-9\-_]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '') || 'sin_dato';

  const sanitizarNombreArchivo = (nombre: string): string =>
    String(nombre || 'foto')
      .trim()
      .replace(/[^a-zA-Z0-9.\-_]+/g, '_')
      .replace(/_+/g, '_');

  // Agrega solo imágenes a la lista (evita duplicados por nombre+tamaño).
  const agregarFotos = (files: FileList | File[]) => {
    const nuevas = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (nuevas.length === 0) return;
    setFotosSeleccionadas(prev => {
      const clave = (f: File) => `${f.name}_${f.size}`;
      const existentes = new Set(prev.map(clave));
      return [...prev, ...nuevas.filter(f => !existentes.has(clave(f)))];
    });
  };

  const handleFotosInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) agregarFotos(e.target.files);
    e.target.value = ''; // permite volver a elegir el mismo archivo
  };

  const quitarFoto = (index: number) => {
    setFotosSeleccionadas(prev => prev.filter((_, i) => i !== index));
  };

  // Drag & drop (patrón dragDepth para que el borde no parpadee).
  const handleDragEnterFoto = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragDepthFoto.current += 1;
    setArrastrandoFoto(true);
  };
  const handleDragLeaveFoto = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragDepthFoto.current -= 1;
    if (dragDepthFoto.current <= 0) { dragDepthFoto.current = 0; setArrastrandoFoto(false); }
  };
  const handleDragOverFoto = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); };
  const handleDropFoto = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragDepthFoto.current = 0;
    setArrastrandoFoto(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) agregarFotos(e.dataTransfer.files);
  };

  // Sube las fotos a Storage en la ruta: consecutivo/unidad/archivo
  // y devuelve los metadatos {url, path, nombre} para guardar en Firestore.
  const subirFotosReferencia = async (
    consecutivo: string,
    unidad: string,
    archivos: File[]
  ): Promise<{ url: string; path: string; nombre: string }[]> => {
    const storage = getStorage();
    const carpetaCons = sanitizarSegmentoRuta(consecutivo);
    const carpetaUni = sanitizarSegmentoRuta(unidad);
    const resultados: { url: string; path: string; nombre: string }[] = [];

    for (let i = 0; i < archivos.length; i++) {
      const file = archivos[i];
      const nombreLimpio = sanitizarNombreArchivo(file.name);
      const path = `${carpetaCons}/${carpetaUni}/${Date.now()}_${i}_${nombreLimpio}`;
      const refFoto = storageRef(storage, path);
      await uploadBytes(refFoto, file);
      const url = await getDownloadURL(refFoto);
      resultados.push({ url, path, nombre: file.name });
    }
    return resultados;
  };

  const formatoMoneda = (monto: any) => {
    const num = parseFloat(monto || 0);
    return isNaN(num) ? '$ 0.00' : `$ ${num.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // ──────────────────────────────────────────────────────────────────
  // ✅ PARSEO DE FECHAS A PRUEBA DE FORMATOS (corrige "Invalid Date")
  // ──────────────────────────────────────────────────────────────────
  const parsearFechaSegura = (valor: any): Date | null => {
    if (valor === null || valor === undefined || valor === '') return null;

    if (typeof valor === 'object') {
      if (typeof valor.toDate === 'function') {
        const d = valor.toDate();
        return isNaN(d.getTime()) ? null : d;
      }
      if (typeof valor.seconds === 'number') {
        const d = new Date(valor.seconds * 1000);
        return isNaN(d.getTime()) ? null : d;
      }
      if (valor instanceof Date) {
        return isNaN(valor.getTime()) ? null : valor;
      }
      return null;
    }

    if (typeof valor === 'number') {
      const d = new Date(valor);
      return isNaN(d.getTime()) ? null : d;
    }

    if (typeof valor === 'string') {
      const s = valor.trim();
      if (!s) return null;

      let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (m) {
        const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        return isNaN(d.getTime()) ? null : d;
      }

      m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
      if (m) {
        let year = Number(m[3]);
        if (year < 100) year += 2000;
        const d = new Date(year, Number(m[2]) - 1, Number(m[1]));
        return isNaN(d.getTime()) ? null : d;
      }

      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d;
    }

    return null;
  };

  // ISO "YYYY-MM-DD" robusto (para comparar rangos de fechas).
  const fechaISO = (valor: any): string => {
    const d = parsearFechaSegura(valor);
    if (!d) return '';
    const y = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${mm}-${dd}`;
  };

  // ✅ 1. CARGAMOS REFERENCIAS Y CATÁLOGOS LIGEROS
  useEffect(() => {
    const qRefs = query(collection(db, 'referencias_diesel'), orderBy('createdAt', 'desc'), limit(400));
    const unSubReferencias = onSnapshot(qRefs, (snap) => {
      const refs = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      refs.sort((a: any, b: any) => {
        const seqA = parseInt((a.consecutivo || '').split('-').pop() || '0', 10);
        const seqB = parseInt((b.consecutivo || '').split('-').pop() || '0', 10);
        return seqB - seqA; 
      });
      setReferenciasGlobales(refs);
    });

    const unSubUnidades = onSnapshot(collection(db, 'unidades'), (snap) => {
      setUnidadesList(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });

    const unSubEmpleados = onSnapshot(collection(db, 'empleados'), (snap) => {
      setOperadoresList(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });

    const unSubEmpresas = onSnapshot(collection(db, 'empresas'), (snap) => {
      setProveedoresList(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });

    const unSubLugares = onSnapshot(collection(db, COLECCION_LUGARES), (snap) => {
      setLugaresList(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });

    return () => { unSubReferencias(); unSubUnidades(); unSubEmpleados(); unSubEmpresas(); unSubLugares(); };
  }, []);

  // ✅ 2. CARGA DE OPERACIONES POR UNIDAD (sin límite global)
  useEffect(() => {
    if (activeTab !== 'operaciones' || !filtroUnidad) return;

    const uniDoc = unidadesList.find(
      u => String(u.unidad || u.nombre || u.numeroEconomico || '').trim() === filtroUnidad.trim()
    );
    const uniId = uniDoc?.id;

    let cancelado = false;
    setCargandoOps(true);

    (async () => {
      try {
        const acumulador = new Map<string, any>();
        const ejecutarConsulta = async (campo: string, valor: string) => {
          if (!valor) return;
          const snap = await getDocs(query(collection(db, 'operaciones'), where(campo, '==', valor)));
          snap.docs.forEach(d => acumulador.set(d.id, { id: d.id, ...(d.data() as any) }));
        };

        await ejecutarConsulta('unidadNombre', filtroUnidad);
        await ejecutarConsulta('unidad', filtroUnidad);
        if (uniId) await ejecutarConsulta('unidadId', uniId);

        if (cancelado) return;

        const ops = Array.from(acumulador.values());
        ops.sort((a: any, b: any) =>
          (parsearFechaSegura(b.fechaServicio || b.createdAt)?.getTime() || 0) -
          (parsearFechaSegura(a.fechaServicio || a.createdAt)?.getTime() || 0)
        );
        setOperacionesGlobales(ops);
      } catch (error) {
        console.error('Error cargando operaciones de la unidad:', error);
      } finally {
        if (!cancelado) setCargandoOps(false);
      }
    })();

    return () => { cancelado = true; };
  }, [activeTab, filtroUnidad, unidadesList]);

  // ✅ 3. OBTENER COSTO DIÉSEL
  useEffect(() => {
    if (!fechaForm || !proveedorSeleccionado || activeTab !== 'operaciones') {
      setCostoDieselDiario(0);
      return;
    }
    
    const fetchCosto = async () => {
      try {
        const q = query(
          collection(db, 'combustibles'), 
          where('fecha', '==', fechaForm),
          where('proveedorId', '==', proveedorSeleccionado)
        );
        const snap = await getDocs(q);
        if (!snap.empty) {
          setCostoDieselDiario(Number(snap.docs[0].data().costo || 0));
        } else {
          setCostoDieselDiario(0);
        }
      } catch (error) {
        console.error("Error obteniendo el costo del diesel:", error);
        setCostoDieselDiario(0);
      }
    };
    fetchCosto();
  }, [fechaForm, proveedorSeleccionado, activeTab]);

  useEffect(() => {
    if (!referenciaViendo || !Array.isArray(referenciaViendo.operacionesIds) || referenciaViendo.operacionesIds.length === 0) return;
    const idsFaltantes = referenciaViendo.operacionesIds.filter(
      (id: string) => !operacionesGlobales.some(o => o.id === id)
    );
    if (idsFaltantes.length === 0) return;

    let cancelado = false;
    (async () => {
      try {
        const snaps = await Promise.all(
          idsFaltantes.map((id: string) => getDoc(doc(db, 'operaciones', id)))
        );
        if (cancelado) return;
        const nuevas = snaps
          .filter(snap => snap.exists())
          .map(snap => ({ id: snap.id, ...(snap.data() as any) }));
        if (nuevas.length > 0) {
          setOperacionesGlobales(prev => {
            const existentes = new Set(prev.map(o => o.id));
            return [...prev, ...nuevas.filter(n => !existentes.has(n.id))];
          });
        }
      } catch (error) {
        console.error('Error cargando las operaciones de la referencia:', error);
      }
    })();

    return () => { cancelado = true; };
  }, [referenciaViendo]);

  const generarConsecutivo = (fechaStr: string) => {
    const [year, month, day] = fechaStr.split('-');
    const aa = year.slice(2);
    const prefix = `DIESEL-${day}${month}${aa}-`;
    const referenciasHoy = referenciasGlobales.filter(r => r.consecutivo?.startsWith(prefix));
    let maxSeq = 0;
    referenciasHoy.forEach(r => {
      const parts = r.consecutivo.split('-');
      if (parts.length === 3) {
        const seq = parseInt(parts[2], 10);
        if (seq > maxSeq) maxSeq = seq;
      }
    });
    return `${prefix}${String(maxSeq + 1).padStart(3, '0')}`;
  };

  // ✅ Genera el siguiente consecutivo CONSULTANDO Firestore (no depende del
  //    límite de 400 en memoria), para evitar números repetidos.
  const obtenerSiguienteConsecutivo = async (fechaStr: string): Promise<string> => {
    const [year, month, day] = fechaStr.split('-');
    const aa = year.slice(2);
    const prefix = `DIESEL-${day}${month}${aa}-`;
    let maxSeq = 0;
    try {
      const snap = await getDocs(query(
        collection(db, 'referencias_diesel'),
        where('consecutivo', '>=', prefix),
        where('consecutivo', '<', prefix + '\uf8ff')
      ));
      snap.forEach(d => {
        const parts = String((d.data() as any).consecutivo || '').split('-');
        if (parts.length === 3) {
          const seq = parseInt(parts[2], 10);
          if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
        }
      });
    } catch (e) {
      return generarConsecutivo(fechaStr);
    }
    return `${prefix}${String(maxSeq + 1).padStart(3, '0')}`;
  };

  // ✅ ¿Ya existe ese consecutivo en otra referencia? (para impedir duplicados)
  const existeConsecutivo = async (consecutivo: string, excluirId?: string): Promise<boolean> => {
    const limpio = String(consecutivo || '').trim();
    if (!limpio) return false;
    try {
      const snap = await getDocs(query(collection(db, 'referencias_diesel'), where('consecutivo', '==', limpio)));
      return snap.docs.some(d => d.id !== excluirId);
    } catch (e) {
      return referenciasGlobales.some(r => r.consecutivo === limpio && r.id !== excluirId);
    }
  };

  const getNombreUnidad = (idOrName: string) => {
    if (!idOrName) return '-';
    const found = unidadesList.find(u => u.id === idOrName || u.unidad === idOrName || u.nombre === idOrName);
    return found ? (found.unidad || found.nombre || found.numeroEconomico || idOrName) : idOrName;
  };

  const getNombreOperador = (idOrName: string) => {
    if (!idOrName) return '-';
    const found = operadoresList.find(o => o.id === idOrName || `${o.firstName} ${o.lastNamePaternal}`.trim() === idOrName.trim());
    return found ? `${found.firstName || ''} ${found.lastNamePaternal || ''}`.trim() : idOrName;
  };

  const getNombreProveedor = (idOrName: string) => {
    if (!idOrName) return '-';
    const found = proveedoresList.find(p => p.id === idOrName || p.nombre === idOrName);
    return found ? found.nombre : idOrName;
  };

  const getDireccionProveedor = (idOrName: string): string => {
    if (!idOrName) return '';
    const found = proveedoresList.find(p => p.id === idOrName || p.nombre === idOrName);
    if (!found) return '';
    const candidatos = [found.direccion, found.domicilio, found.direccionFiscal, found.direccionCompleta, found.calle];
    const directa = candidatos.find((c: any) => typeof c === 'string' && c.trim());
    if (directa) return String(directa).trim();
    if (Array.isArray(found.direcciones) && found.direcciones.length > 0) {
      const d = found.direcciones[0];
      if (typeof d === 'string') return d;
      if (d && typeof d === 'object') return d.label || d.direccion || d.nombre || '';
    }
    return '';
  };

  const getNombreLugar = (idOrName: string): string => {
    if (!idOrName) return '-';
    const fuente = lugaresList.find(l => l.id === idOrName) || proveedoresList.find(p => p.id === idOrName);
    if (!fuente) return idOrName;
    const nombre =
      fuente.nombre ||
      fuente.label ||
      fuente.nombreComercial ||
      fuente.razonSocial ||
      [fuente.ciudad, fuente.estado].filter(Boolean).join(', ') ||
      fuente.direccion ||
      idOrName;
    return String(nombre);
  };

  const construirDatosInstrucciones = (r: any) => ({
    referencia: r.consecutivo || '',
    fecha: r.fecha || '',
    unidadNombre: getNombreUnidad(r.unidadNombre || r.unidadId || r.unidad),
    operadorNombre: getNombreOperador(r.operadorNombre || r.operadorId || r.operador),
    proveedorNombre: r.proveedorNombre || getNombreProveedor(r.proveedorId || r.proveedor),
    proveedorDireccion: getDireccionProveedor(r.proveedorId || r.proveedor),
    galonesAutorizados: r.galonesAutorizados || 0,
  });

  const handleGenerarInstrucciones = (e: React.MouseEvent, r: any) => {
    e.stopPropagation();
    generarInstruccionesDieselPDF(construirDatosInstrucciones(r));
  };

  const formatearFechaSpanish = (valor: any) => {
    const d = parsearFechaSegura(valor);
    if (!d) return '-';
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  const unidadesOptions = useMemo(() => {
    const names = unidadesList
      .map(u => String(u.unidad || u.nombre || u.numeroEconomico || '').trim())
      .filter(Boolean);
    return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  }, [unidadesList]);

  // ✅ Solo proveedores con tipo de empresa "11894dfd" Y tipo de servicio
  //    "189a4573". El filtro es robusto a array/string/objeto y la lista se
  //    ordena alfabéticamente para que sea fácil encontrarlos.
  const proveedoresFiltrados = useMemo(() => {
    return proveedoresList
      .filter(p => incluyeId(p.tiposEmpresa, '11894dfd') && incluyeId(p.tiposServicio, '189a4573'))
      .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es', { sensitivity: 'base' }));
  }, [proveedoresList]);

  const operacionesBaseUnidad = useMemo(() => {
    if (!filtroUnidad) return [];
    return operacionesGlobales.filter(op => {
      const opUnidad = getNombreUnidad(op.unidadNombre || op.unidadId || op.unidad || '');
      return opUnidad === filtroUnidad;
    });
  }, [operacionesGlobales, filtroUnidad, unidadesList]);

  const idsCargadasSet = useMemo(() => {
    const s = new Set<string>();
    referenciasGlobales.forEach(r => {
      if (Array.isArray(r.operacionesIds)) r.operacionesIds.forEach((id: string) => s.add(id));
    });
    return s;
  }, [referenciasGlobales]);

  const refDieselPorOpId = useMemo(() => {
    const m: Record<string, string> = {};
    referenciasGlobales.forEach(r => {
      if (Array.isArray(r.operacionesIds)) {
        r.operacionesIds.forEach((id: string) => { if (!m[id]) m[id] = r.consecutivo; });
      }
    });
    return m;
  }, [referenciasGlobales]);

  const consecutivoNum = (str: string) => {
    const mm = String(str || '').match(/(\d+)\s*$/);
    return mm ? parseInt(mm[1], 10) : 0;
  };

  const fechaOrdenRef = (r: any): string => {
    const iso = fechaISO(r.fecha);
    if (iso) return iso;
    const m = String(r.consecutivo || '').match(/-(\d{2})(\d{2})(\d{2})-/);
    if (m) {
      const [, dd, mes, yy] = m;
      return `20${yy}-${mes}-${dd}`;
    }
    return '';
  };

  const esCargada = (op: any) => !!op.referenciaDieselId || idsCargadasSet.has(op.id);

  const conteoOps = useMemo(() => {
    const pendientes = operacionesBaseUnidad.filter(op => !esCargada(op)).length;
    const cargadas = operacionesBaseUnidad.filter(esCargada).length;
    return { pendientes, cargadas };
  }, [operacionesBaseUnidad, idsCargadasSet]);

  const valorOrdenOp = (op: any, campo: string): string | number => {
    switch (campo) {
      case 'ref': return String(op.ref || op.id || '').toLowerCase();
      case 'fechaServicio': return parsearFechaSegura(op.fechaServicio || op.createdAt)?.getTime() || 0;
      case 'unidad': return getNombreUnidad(op.unidadNombre || op.unidadId || op.unidad).toLowerCase();
      case 'operador': return getNombreOperador(op.operadorNombre || op.operadorId || op.operador).toLowerCase();
      case 'origen': return getNombreLugar(op.origen).toLowerCase();
      case 'destino': return getNombreLugar(op.destino).toLowerCase();
      case 'diesel': return Number(op.combustibleTotal || 0);
      case 'refDiesel': return String(op.referenciaDieselConsecutivo || refDieselPorOpId[op.id] || '').toLowerCase();
      default: return '';
    }
  };

  const dentroRangoFecha = (op: any) => {
    if (!fechaDesdeOps && !fechaHastaOps) return true;
    const f = fechaISO(op.fechaServicio || op.createdAt);
    if (!f) return false;
    if (fechaDesdeOps && f < fechaDesdeOps) return false;
    if (fechaHastaOps && f > fechaHastaOps) return false;
    return true;
  };

  const operacionesMostradas = useMemo(() => {
    if (!filtroUnidad) return [];
    const lista = operacionesBaseUnidad.filter(op =>
      (filtroEstadoOps === 'cargadas' ? esCargada(op) : !esCargada(op)) && dentroRangoFecha(op)
    );
    const dir = ordenOps.dir === 'asc' ? 1 : -1;
    return [...lista].sort((a, b) => {
      const va = valorOrdenOp(a, ordenOps.campo);
      const vb = valorOrdenOp(b, ordenOps.campo);
      let cmp: number;
      if (typeof va === 'number' && typeof vb === 'number') cmp = (va - vb) * dir;
      else cmp = String(va).localeCompare(String(vb)) * dir;
      if (cmp !== 0) return cmp;
      return consecutivoNum(b.ref) - consecutivoNum(a.ref);
    });
  }, [operacionesBaseUnidad, filtroUnidad, filtroEstadoOps, ordenOps, fechaDesdeOps, fechaHastaOps, idsCargadasSet, lugaresList, proveedoresList]);

  const toggleOrdenOps = (campo: string) =>
    setOrdenOps(prev => prev.campo === campo ? { campo, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { campo, dir: 'asc' });

  const flechaOps = (campo: string) => ordenOps.campo === campo ? (ordenOps.dir === 'asc' ? ' ▲' : ' ▼') : '';

  const valorCeldaOps = (op: any, key: string) => {
    switch (key) {
      case 'ref': return op.ref || op.id;
      case 'fechaServicio': return formatearFechaSpanish(op.fechaServicio || op.createdAt);
      case 'unidad': return getNombreUnidad(op.unidadNombre || op.unidadId || op.unidad);
      case 'operador': return getNombreOperador(op.operadorNombre || op.operadorId || op.operador);
      case 'origen': return getNombreLugar(op.origen);
      case 'destino': return getNombreLugar(op.destino);
      case 'diesel': return Number(op.combustibleTotal || 0);
      case 'refDiesel': return op.referenciaDieselConsecutivo || refDieselPorOpId[op.id] || '-';
      default: return '-';
    }
  };

  const renderCeldaOps = (op: any, key: string) => {
    const tdBase: React.CSSProperties = { padding: '16px', color: '#c9d1d9', whiteSpace: 'nowrap' };
    switch (key) {
      case 'ref': return <td className="rdd-x9" key={key}>{op.ref || op.id.substring(0, 6)}</td>;
      case 'fechaServicio': return <td key={key} style={tdBase}>{formatearFechaSpanish(op.fechaServicio || op.createdAt)}</td>;
      case 'unidad': return <td key={key} style={tdBase}>{getNombreUnidad(op.unidadNombre || op.unidadId || op.unidad)}</td>;
      case 'operador': return <td key={key} style={tdBase}>{getNombreOperador(op.operadorNombre || op.operadorId || op.operador)}</td>;
      case 'origen': return <td key={key} style={tdBase}>{getNombreLugar(op.origen)}</td>;
      case 'destino': return <td key={key} style={tdBase}>{getNombreLugar(op.destino)}</td>;
      case 'diesel': return <td className="rdd-x10" key={key}>{Number(op.combustibleTotal || 0).toFixed(2)}</td>;
      case 'refDiesel': {
        const cons = op.referenciaDieselConsecutivo || refDieselPorOpId[op.id] || '';
        return <td key={key} style={{ padding: '16px', whiteSpace: 'nowrap', fontFamily: 'monospace', fontWeight: 'bold', color: cons ? '#10b981' : '#8b949e' }}>{cons || '-'}</td>;
      }
      default: return <td key={key} style={tdBase}>-</td>;
    }
  };

  const handleDragStartOps = (_e: React.DragEvent, index: number) => setDraggedColOpsIndex(index);
  const handleDragEnterOps = (index: number) => {
    if (draggedColOpsIndex === null || draggedColOpsIndex === index) return;
    const nuevas = [...columnasOps];
    const movida = nuevas.splice(draggedColOpsIndex, 1)[0];
    nuevas.splice(index, 0, movida);
    setDraggedColOpsIndex(index);
    setColumnasOps(nuevas);
  };
  const toggleColumnaVisibleOps = (index: number) => {
    const nuevas = [...columnasOps];
    nuevas[index].visible = !nuevas[index].visible;
    setColumnasOps(nuevas);
  };

  const exportarExcelOps = () => {
    if (operacionesMostradas.length === 0) return alert('No hay operaciones para exportar con los filtros actuales.');
    const cols = columnasOps.filter(c => c.visible);
    if (cols.length === 0) return alert('Selecciona al menos una columna para exportar.');
    const datos = operacionesMostradas.map(op => {
      const fila: any = {};
      cols.forEach(col => { fila[col.label] = valorCeldaOps(op, col.id); });
      return fila;
    });
    const ws = XLSX.utils.json_to_sheet(datos);
    const wb = XLSX.utils.book_new();
    const etiqueta = filtroEstadoOps === 'cargadas' ? 'Cargadas' : 'Pendientes';
    XLSX.utils.book_append_sheet(wb, ws, `Ops_${etiqueta}`);
    const uni = (filtroUnidad || 'unidad').replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 30);
    const hoy = hoyLocalISO();
    XLSX.writeFile(wb, `Operaciones_Diesel_${etiqueta}_${uni}_${hoy}.xlsx`);
  };

  const toggleSeleccion = (id: string) => {
    setSeleccionadas(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
  };

  const idsMostradas = useMemo(() => operacionesMostradas.map(o => o.id), [operacionesMostradas]);
  const todasSeleccionadas = operacionesMostradas.length > 0 && idsMostradas.every(id => seleccionadas.includes(id));
  const toggleSeleccionarTodas = () => {
    if (filtroEstadoOps !== 'pendientes') return;
    if (todasSeleccionadas) {
      setSeleccionadas(prev => prev.filter(id => !idsMostradas.includes(id)));
    } else {
      setSeleccionadas(prev => Array.from(new Set([...prev, ...idsMostradas])));
    }
  };

  const resumenSeleccion = useMemo(() => {
    let dieselTotal = 0;
    let kmEstimado = 0; // ✅ NUEVO: suma del kilometraje estimado (de operaciones)
    const refs: string[] = [];
    seleccionadas.forEach(id => {
      const op = operacionesGlobales.find(o => o.id === id);
      if (op) {
        dieselTotal += Number(op.combustibleTotal || 0);
        kmEstimado += Number(op.kilometrajeEstimado || 0);
        refs.push(op.ref || op.id?.substring(0,6));
      }
    });
    return { dieselTotal, kmEstimado, refs };
  }, [seleccionadas, operacionesGlobales]);

  const operadoresSeleccionados = useMemo(() => {
    const set = new Set<string>();
    seleccionadas.forEach(id => {
      const op = operacionesGlobales.find(o => o.id === id);
      if (op) {
        const nom = getNombreOperador(op.operadorNombre || op.operadorId || op.operador || '');
        if (nom && nom !== '-') set.add(nom);
      }
    });
    return Array.from(set);
  }, [seleccionadas, operacionesGlobales, operadoresList]);

  // ✅ NUEVO: valor sugerido del operador según las operaciones seleccionadas.
  const operadorSugerido = useMemo(() => {
    if (operadoresSeleccionados.length === 1) return operadoresSeleccionados[0];
    if (operadoresSeleccionados.length > 1) return 'Varios';
    return '';
  }, [operadoresSeleccionados]);

  // ✅ NUEVO: opciones del select de operador (empleados ordenados + "Varios").
  const operadoresOptions = useMemo(() => {
    const nombres = operadoresList
      .map(o => `${o.firstName || ''} ${o.lastNamePaternal || ''}`.trim())
      .filter(Boolean);
    // Se incluyen también los nombres detectados en las operaciones por si el
    // registro del empleado ya no existe o el nombre no coincide exacto.
    operadoresSeleccionados.forEach(n => nombres.push(n));
    const unicos = Array.from(new Set(nombres)).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
    return unicos;
  }, [operadoresList, operadoresSeleccionados]);

  // ✅ NUEVO: al abrir el modal de Nueva Referencia se precarga el operador
  //   sugerido (el usuario lo puede cambiar libremente después).
  useEffect(() => {
    if (modalAbierto) setOperadorForm(operadorSugerido);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalAbierto]);

  const galonesCalculadosOp = resumenSeleccion.dieselTotal;

  const galonesAutorizadosCalc = useMemo(() => {
    return galonesCalculadosOp + (Number(galonesExtras) || 0);
  }, [galonesCalculadosOp, galonesExtras]);

  const statusReferenciaForm = useMemo(() => {
    const extraVacio = galonesExtras === '' || galonesExtras === 0 || isNaN(galonesExtras as number);
    const cargVacio = galonesCargados === '' || galonesCargados === 0 || isNaN(galonesCargados as number);

    if (extraVacio && cargVacio) return 'No Autorizado';
    if (!extraVacio && cargVacio) return 'Autorizado';
    return 'Cargado'; 
  }, [galonesExtras, galonesCargados]);

  const handleGuardarReferencia = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!proveedorSeleccionado) return alert("Selecciona un proveedor.");
    setGuardando(true);
    try {
      const batch = writeBatch(db);
      const nuevoRefId = doc(collection(db, 'referencias_diesel')).id;

      // ✅ Consecutivo ÚNICO: se calcula consultando Firestore y se verifica que
      //    no exista; si por una carrera ya estuviera tomado, avanza el número.
      let consecutivoFinal = await obtenerSiguienteConsecutivo(fechaForm);
      let intentos = 0;
      while ((await existeConsecutivo(consecutivoFinal)) && intentos < 25) {
        const partes = consecutivoFinal.split('-');
        const next = (parseInt(partes[2], 10) || 0) + 1;
        consecutivoFinal = `${partes[0]}-${partes[1]}-${String(next).padStart(3, '0')}`;
        intentos++;
      }

      const foundUni = unidadesList.find(u => u.unidad === filtroUnidad || u.nombre === filtroUnidad);

      // ✅ Sube las fotos (si hay) a Storage: consecutivo/unidad/foto
      let fotosSubidas: { url: string; path: string; nombre: string }[] = [];
      if (fotosSeleccionadas.length > 0) {
        try {
          setSubiendoFotos(true);
          fotosSubidas = await subirFotosReferencia(consecutivoFinal, filtroUnidad, fotosSeleccionadas);
        } catch (errFotos) {
          console.error('Error subiendo fotos:', errFotos);
          const seguir = window.confirm('No se pudieron subir una o más fotos. ¿Deseas guardar la referencia SIN fotos?');
          if (!seguir) { setSubiendoFotos(false); setGuardando(false); return; }
        } finally {
          setSubiendoFotos(false);
        }
      }

      // ✅ NUEVO: se respeta el operador elegido en el formulario; si el campo
      //   quedó vacío se usa el auto-detectado de las operaciones (comportamiento
      //   anterior).
      const operadorRef = (operadorForm || '').trim() || operadorSugerido;
      const foundOp = operadorRef && operadorRef !== 'Varios'
        ? operadoresList.find(o => `${o.firstName || ''} ${o.lastNamePaternal || ''}`.trim() === operadorRef.trim())
        : null;

      const data = {
        consecutivo: consecutivoFinal,
        fecha: fechaForm,
        unidadId: foundUni ? foundUni.id : null,
        unidadNombre: filtroUnidad, 
        operadorId: foundOp ? foundOp.id : null,
        operadorNombre: operadorRef, 
        operacionesIds: seleccionadas,
        sumaDiesel: resumenSeleccion.dieselTotal,
        // ✅ NUEVO: kilometraje estimado (de las operaciones) y real capturado.
        kilometrajeEstimado: resumenSeleccion.kmEstimado,
        kilometrajeReal: Number(kilometrajeReal) || 0,
        galonesCalculadosOperaciones: galonesCalculadosOp,
        galonesExtras: Number(galonesExtras) || 0,
        galonesAutorizados: galonesAutorizadosCalc,
        galonesCargados: Number(galonesCargados),
        proveedorId: proveedorSeleccionado,
        proveedorNombre: getNombreProveedor(proveedorSeleccionado),
        costoDiesel: costoDieselDiario,
        totalAutorizado: galonesAutorizadosCalc * costoDieselDiario,
        totalCargado: Number(galonesCargados) * costoDieselDiario,
        observaciones: observacionesForm,
        status: statusReferenciaForm, 
        fotos: fotosSubidas,
        createdAt: new Date().toISOString()
      };

      batch.set(doc(db, 'referencias_diesel', nuevoRefId), data);
      seleccionadas.forEach(id => {
        batch.update(doc(db, 'operaciones', id), { referenciaDieselId: nuevoRefId, referenciaDieselConsecutivo: consecutivoFinal });
      });

      await batch.commit();
      setOperacionesGlobales(prev => prev.map(op =>
        seleccionadas.includes(op.id) ? { ...op, referenciaDieselId: nuevoRefId, referenciaDieselConsecutivo: consecutivoFinal } : op
      ));
      setModalAbierto(false);
      setSeleccionadas([]);
      
      setGalonesExtras('');
      setGalonesCargados('');
      setObservacionesForm('');
      setProveedorSeleccionado('');
      setFotosSeleccionadas([]);
      
      setActiveTab('referencias');
    } catch (error) {
      alert("Error al guardar.");
    } finally {
      setGuardando(false);
    }
  };

  const handleEliminarReferencia = async (e: React.MouseEvent, refData: any) => {
    e.stopPropagation();
    if (window.confirm(`¿Estás seguro de eliminar la referencia ${refData.consecutivo}? Las operaciones asociadas volverán a estar disponibles.`)) {
      try {
        const batch = writeBatch(db);
        batch.delete(doc(db, 'referencias_diesel', refData.id));

        if (Array.isArray(refData.operacionesIds)) {
          refData.operacionesIds.forEach((opId: string) => {
            batch.update(doc(db, 'operaciones', opId), {
              referenciaDieselId: null,
              referenciaDieselConsecutivo: null
            });
          });
        }
        await batch.commit();
        const idsLiberadas: string[] = Array.isArray(refData.operacionesIds) ? refData.operacionesIds : [];
        setOperacionesGlobales(prev => prev.map(op =>
          idsLiberadas.includes(op.id) ? { ...op, referenciaDieselId: null, referenciaDieselConsecutivo: null } : op
        ));
      } catch (error) {
        console.error("Error al eliminar referencia:", error);
        alert("Hubo un error al eliminar.");
      }
    }
  };

  const handleActualizarOperacion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!operacionAEditar || !referenciaViendo) return;

    setGuardandoEdicionOp(true);
    try {
      const batch = writeBatch(db);
      const combustibleNuevo = Number(editCombustibleOp) || 0;
      const combustibleViejo = Number(operacionAEditar.combustibleTotal || 0);
      
      batch.update(doc(db, 'operaciones', operacionAEditar.id), {
        combustibleTotal: combustibleNuevo
      });

      const diferencia = combustibleNuevo - combustibleViejo;
      const nuevaSumaReferencia = Number(referenciaViendo.sumaDiesel || 0) + diferencia;
      const extrasGuardados = Number(referenciaViendo.galonesExtras || 0);
      const nuevosAutorizados = nuevaSumaReferencia + extrasGuardados;
      const nuevoTotalAutorizado = nuevosAutorizados * Number(referenciaViendo.costoDiesel || 0);

      batch.update(doc(db, 'referencias_diesel', referenciaViendo.id), {
        sumaDiesel: nuevaSumaReferencia,
        galonesCalculadosOperaciones: nuevaSumaReferencia,
        galonesAutorizados: nuevosAutorizados,
        totalAutorizado: nuevoTotalAutorizado
      });

      await batch.commit();

      setOperacionesGlobales(prev => prev.map(o =>
        o.id === operacionAEditar.id ? { ...o, combustibleTotal: combustibleNuevo } : o
      ));

      setReferenciaViendo({ 
        ...referenciaViendo, 
        sumaDiesel: nuevaSumaReferencia,
        galonesCalculadosOperaciones: nuevaSumaReferencia,
        galonesAutorizados: nuevosAutorizados,
        totalAutorizado: nuevoTotalAutorizado
      });
      setOperacionAEditar(null);
      
    } catch (error) {
      console.error("Error al actualizar la operación:", error);
      alert("Hubo un error al guardar la modificación.");
    } finally {
      setGuardandoEdicionOp(false);
    }
  };

  // ✅ Abre el modal de edición precargando los datos de la referencia.
  const abrirEdicionRef = (r: any) => {
    setFormEditRef({
      consecutivo: r.consecutivo || '',
      fecha: r.fecha || '',
      proveedorId: r.proveedorId || '',
      operadorId: r.operadorId || (r.operadorNombre ? '__actual__' : ''),
      galonesExtras: (r.galonesExtras === undefined || r.galonesExtras === null) ? '' : Number(r.galonesExtras),
      galonesCargados: (r.galonesCargados === undefined || r.galonesCargados === null) ? '' : Number(r.galonesCargados),
      costoDiesel: (r.costoDiesel === undefined || r.costoDiesel === null) ? '' : Number(r.costoDiesel),
      observaciones: r.observaciones || ''
    });
    setEditandoRef(r);
  };

  // ✅ Guarda los cambios del registro: valida consecutivo único, recalcula
  //    autorizados/totales/status y sincroniza el consecutivo en las operaciones.
  const handleGuardarEdicionRef = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editandoRef) return;

    const nuevoConsecutivo = String(formEditRef.consecutivo || '').trim();
    if (!nuevoConsecutivo) { alert('El número de referencia no puede quedar vacío.'); return; }

    setGuardandoEdicionRef(true);
    try {
      const cambioConsecutivo = nuevoConsecutivo !== editandoRef.consecutivo;

      // ✅ Unicidad: ninguna otra referencia puede tener el mismo consecutivo.
      if (cambioConsecutivo && (await existeConsecutivo(nuevoConsecutivo, editandoRef.id))) {
        alert(`El número de referencia "${nuevoConsecutivo}" ya existe. Usa uno diferente.`);
        setGuardandoEdicionRef(false);
        return;
      }

      const sumaDiesel = Number(editandoRef.sumaDiesel || 0);
      const extras = Number(formEditRef.galonesExtras) || 0;
      const cargados = Number(formEditRef.galonesCargados) || 0;
      const costo = Number(formEditRef.costoDiesel) || 0;
      const autorizados = sumaDiesel + extras;

      const extraVacio = !extras;
      const cargVacio = !cargados;
      let status = 'Cargado';
      if (extraVacio && cargVacio) status = 'No Autorizado';
      else if (!extraVacio && cargVacio) status = 'Autorizado';

      let operadorIdFinal: string | null;
      let operadorNombreFinal: string;
      if (formEditRef.operadorId === '__actual__') {
        operadorIdFinal = editandoRef.operadorId || null;
        operadorNombreFinal = editandoRef.operadorNombre || '';
      } else if (formEditRef.operadorId) {
        const emp = operadoresList.find(o => o.id === formEditRef.operadorId);
        operadorIdFinal = emp ? emp.id : null;
        operadorNombreFinal = emp ? `${emp.firstName || ''} ${emp.lastNamePaternal || ''}`.trim() : '';
      } else {
        operadorIdFinal = null;
        operadorNombreFinal = '';
      }

      const updates: any = {
        consecutivo: nuevoConsecutivo,
        fecha: formEditRef.fecha,
        proveedorId: formEditRef.proveedorId,
        proveedorNombre: getNombreProveedor(formEditRef.proveedorId),
        operadorId: operadorIdFinal,
        operadorNombre: operadorNombreFinal,
        galonesExtras: extras,
        galonesCargados: cargados,
        costoDiesel: costo,
        galonesAutorizados: autorizados,
        totalAutorizado: autorizados * costo,
        totalCargado: cargados * costo,
        observaciones: formEditRef.observaciones,
        status
      };

      // ✅ Batch: actualiza la referencia y, si cambió el consecutivo, sincroniza
      //    el campo referenciaDieselConsecutivo en las operaciones ligadas.
      const batch = writeBatch(db);
      batch.update(doc(db, 'referencias_diesel', editandoRef.id), updates);
      if (cambioConsecutivo && Array.isArray(editandoRef.operacionesIds)) {
        editandoRef.operacionesIds.forEach((opId: string) => {
          batch.update(doc(db, 'operaciones', opId), { referenciaDieselConsecutivo: nuevoConsecutivo });
        });
      }
      await batch.commit();

      setReferenciasGlobales((prev: any[]) => prev.map((r: any) => r.id === editandoRef.id ? { ...r, ...updates } : r));
      setReferenciaViendo((prev: any) => (prev && prev.id === editandoRef.id) ? { ...prev, ...updates } : prev);
      if (cambioConsecutivo && Array.isArray(editandoRef.operacionesIds)) {
        const idsSet = new Set(editandoRef.operacionesIds);
        setOperacionesGlobales(prev => prev.map(o => idsSet.has(o.id) ? { ...o, referenciaDieselConsecutivo: nuevoConsecutivo } : o));
      }
      setEditandoRef(null);
    } catch (error) {
      console.error('Error al editar la referencia:', error);
      alert('No se pudo guardar la edición. Revisa tu conexión.');
    } finally {
      setGuardandoEdicionRef(false);
    }
  };

  const referenciasFiltradas = useMemo(() => {
    const t = busquedaRef.toLowerCase();
    const lista = referenciasGlobales.filter(r => {
      // ✅ NUEVO: rango de fechas (por la fecha de la referencia, robusto a formatos).
      if (fechaDesdeHist || fechaHastaHist) {
        const f = fechaISO(r.fecha);
        if (!f) return false;
        if (fechaDesdeHist && f < fechaDesdeHist) return false;
        if (fechaHastaHist && f > fechaHastaHist) return false;
      }
      const nombreUni = r.unidadNombre || getNombreUnidad(r.unidadId || r.unidad);
      const nombreOpe = r.operadorNombre || getNombreOperador(r.operadorId || r.operador);
      const nombreProv = r.proveedorNombre || getNombreProveedor(r.proveedorId || r.proveedor);
      return (
        r.consecutivo?.toLowerCase().includes(t) || 
        nombreUni.toLowerCase().includes(t) ||
        nombreOpe.toLowerCase().includes(t) ||
        nombreProv.toLowerCase().includes(t) ||
        (r.status || '').toLowerCase().includes(t)
      );
    });
    return [...lista].sort((a, b) => {
      const fa = fechaOrdenRef(a);
      const fb = fechaOrdenRef(b);
      if (fa !== fb) return fb.localeCompare(fa);
      return consecutivoNum(b.consecutivo) - consecutivoNum(a.consecutivo);
    });
  }, [referenciasGlobales, busquedaRef, fechaDesdeHist, fechaHastaHist, unidadesList, operadoresList, proveedoresList]);

  // ✅ Resumen del historial: separa lo AUTORIZADO de lo CARGADO (galones y $).
  const resumenHistorial = useMemo(() => {
    let totalGalones = 0;             // cargados
    let granTotalCargado = 0;
    let totalGalonesAutorizados = 0;
    let granTotalAutorizado = 0;
    referenciasFiltradas.forEach(r => {
      totalGalones += Number(r.galonesCargados) || 0;
      granTotalCargado += Number(r.totalCargado) || 0;
      totalGalonesAutorizados += Number(r.galonesAutorizados) || 0;
      granTotalAutorizado += Number(r.totalAutorizado) || 0;
    });
    return { totalGalones, granTotalCargado, totalGalonesAutorizados, granTotalAutorizado };
  }, [referenciasFiltradas]);

  const totalPaginas = Math.ceil(referenciasFiltradas.length / registrosPorPagina);
  const indexLast = paginaActual * registrosPorPagina;
  const indexFirst = indexLast - registrosPorPagina;
  const registrosVisibles = referenciasFiltradas.slice(indexFirst, indexLast);

  const irPaginaSiguiente = () => setPaginaActual(p => Math.min(p + 1, totalPaginas));
  const irPaginaAnterior = () => setPaginaActual(p => Math.max(p - 1, 1));

  const exportarCSV = () => {
    if (referenciasFiltradas.length === 0) return alert("No hay datos para exportar.");
    const datosExcel = referenciasFiltradas.map(ref => ({
      'Consecutivo': ref.consecutivo,
      'Status': ref.status || 'No Autorizado',
      'Fecha': formatearFechaSpanish(ref.fecha),
      'Unidad': ref.unidadNombre || getNombreUnidad(ref.unidadId || ref.unidad),
      'Operador': ref.operadorNombre || getNombreOperador(ref.operadorId || ref.operador),
      'Proveedor': ref.proveedorNombre || getNombreProveedor(ref.proveedorId || ref.proveedor),
      'Suma de Diesel (Ref)': ref.sumaDiesel,
      'Galones Extras': ref.galonesExtras,
      'Galones Autorizados': ref.galonesAutorizados,
      'Galones Cargados': ref.galonesCargados,
      'Costo Diario Diesel': ref.costoDiesel,
      'Total Autorizado': ref.totalAutorizado,
      'Total Cargado': ref.totalCargado,
      'Observaciones': ref.observaciones
    }));

    const worksheet = XLSX.utils.json_to_sheet(datosExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Referencias Diesel');
    XLSX.writeFile(workbook, `Referencias_Diesel_${hoyLocalISO()}.xlsx`);
  };

  const tabStyle = (active: boolean) => ({
    padding: '12px 24px', background: 'none', border: 'none', cursor: 'pointer',
    color: active ? '#f0f6fc' : '#8b949e', borderBottom: active ? '2px solid #D84315' : '2px solid transparent',
    fontWeight: active ? 'bold' : 'normal' as any
  });

  const thOrdenStyle: React.CSSProperties = { padding: '16px', borderBottom: '1px solid #30363d', backgroundColor: '#1f2937', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' };
  const selectOrdenStyle: React.CSSProperties = { backgroundColor: '#161b22', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: '6px', padding: '8px 10px', fontSize: '0.85rem' };
  const btnDirStyle: React.CSSProperties = { backgroundColor: '#21262d', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: '6px', padding: '8px 12px', cursor: 'pointer', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' };
  const dateInputStyle: React.CSSProperties = { backgroundColor: '#161b22', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: '6px', padding: '7px 10px', fontSize: '0.85rem', colorScheme: 'dark' };

  const colsOpsVisibles = columnasOps.filter(c => c.visible).length + 1;

  return (
    <div className="module-container rdd-x11">
      <h1 className="rdd-x12">Referencias del Diesel</h1>

      <div className="rdd-x13">
        <button onClick={() => setActiveTab('operaciones')} style={tabStyle(activeTab === 'operaciones')}>Asignar Operaciones</button>
        <button onClick={() => setActiveTab('referencias')} style={tabStyle(activeTab === 'referencias')}>Historial de Referencias</button>
      </div>

      {activeTab === 'operaciones' ? (
        <div className="animation-fade-in">
          
          <div className="rdd-x14">
            <button onClick={() => setDrawerFiltrosAbierto(true)} title="Mostrar filtros"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 16px', backgroundColor: '#161b22', border: `1px solid ${(filtroUnidad || fechaDesdeOps || fechaHastaOps) ? '#D84315' : '#30363d'}`, borderRadius: '8px', color: '#c9d1d9', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.88rem' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
              Filtros
              {(filtroUnidad || fechaDesdeOps || fechaHastaOps) && <span className="rdd-x15">{[filtroUnidad, fechaDesdeOps || fechaHastaOps].filter(Boolean).length}</span>}
            </button>
            {filtroUnidad && (
              <span className="rdd-x16">
                {filtroUnidad}
                <button className="rdd-x17" onClick={() => { setFiltroUnidad(''); setSeleccionadas([]); setBusquedaOpsHecha(false); }}>✕</button>
              </span>
            )}
            {(fechaDesdeOps || fechaHastaOps) && (
              <span className="rdd-x18">
                {(fechaDesdeOps || '…')} → {(fechaHastaOps || '…')}
                <button className="rdd-x19" onClick={() => { setFechaDesdeOps(''); setFechaHastaOps(''); }}>✕</button>
              </span>
            )}
            {!filtroUnidad && <span className="rdd-x20">Presiona Filtros, elige la Unidad y pulsa Buscar.</span>}
            <div className="rdd-x21">
              <button 
                disabled={seleccionadas.length === 0 || filtroEstadoOps === 'cargadas'} 
                onClick={() => { setConsecutivoForm(generarConsecutivo(fechaForm)); setFotosSeleccionadas([]); setKilometrajeReal(''); setModalAbierto(true); }}
                style={{ padding: '10px 20px', backgroundColor: (seleccionadas.length > 0 && filtroEstadoOps !== 'cargadas') ? '#D84315' : '#30363d', color: '#fff', border: 'none', borderRadius: '6px', cursor: (seleccionadas.length > 0 && filtroEstadoOps !== 'cargadas') ? 'pointer' : 'not-allowed', fontWeight: 'bold', whiteSpace: 'nowrap' }}
              >
                Generar Referencia ({seleccionadas.length})
              </button>
            </div>
          </div>

          {/* Barra contextual (tras Buscar): seleccionar todo + columnas + export */}
          {busquedaOpsHecha && (
            <>
            <div className="rdd-x22">
              <div className="rdd-x23">

                {filtroEstadoOps === 'pendientes' && operacionesMostradas.length > 0 && (
                  <button onClick={toggleSeleccionarTodas}
                    style={{ padding: '8px 18px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.85rem',
                      border: `1px solid ${todasSeleccionadas ? '#D84315' : '#58a6ff'}`,
                      backgroundColor: todasSeleccionadas ? 'rgba(216,67,21,0.15)' : 'rgba(88,166,255,0.12)',
                      color: todasSeleccionadas ? '#D84315' : '#58a6ff' }}>
                    {todasSeleccionadas ? '☐ Quitar selección' : '☑ Seleccionar todo'}
                  </button>
                )}
              </div>

            </div>

            {/* Rango de fechas + Configurar columnas + Exportar Excel */}
            <div className="rdd-x24">
              <div className="rdd-x25">
                <span className="rdd-x26">
                  {operacionesMostradas.length} {operacionesMostradas.length === 1 ? 'operación' : 'operaciones'}
                </span>
              </div>

              <div className="rdd-x27">
                <button onClick={() => setModalColumnasOps(true)} style={btnDirStyle} title="Elegir y reordenar columnas">
                  ⚙ Configurar Columnas
                </button>
                <button onClick={exportarExcelOps} disabled={operacionesMostradas.length === 0}
                  style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', fontWeight: 'bold', fontSize: '0.85rem', whiteSpace: 'nowrap',
                    cursor: operacionesMostradas.length === 0 ? 'not-allowed' : 'pointer',
                    backgroundColor: operacionesMostradas.length === 0 ? '#30363d' : '#1a7f37',
                    color: operacionesMostradas.length === 0 ? '#8b949e' : '#fff' }}>
                  Exportar Excel ({filtroEstadoOps === 'cargadas' ? 'Cargadas' : 'Pendientes'})
                </button>
              </div>
            </div>
            </>
          )}

          {seleccionadas.length > 0 && filtroEstadoOps === 'pendientes' && (
            <div className="rdd-x28">
              <div className="rdd-x29">
                <div className="rdd-x30">
                  <span className="rdd-x31">Operaciones Seleccionadas</span>
                  <span className="rdd-x32">{seleccionadas.length}</span>
                </div>
                <div>
                  <span className="rdd-x33">Suma Combustible Total</span>
                  <span className="rdd-x34">{resumenSeleccion.dieselTotal.toFixed(2)}</span>
                </div>
                {/* ✅ NUEVO: kilometraje estimado de las operaciones seleccionadas */}
                <div>
                  <span className="rdd-x33">Kilometraje Estimado</span>
                  <span className="rdd-km-estimado">{resumenSeleccion.kmEstimado.toLocaleString('en-US')} km</span>
                </div>
              </div>
              <div className="rdd-x35">
                <span className="rdd-x36">Operaciones incluidas:</span>
                <div className="rdd-x37">
                  {resumenSeleccion.refs.map((ref, i) => (
                    <span className="rdd-x38" key={i}>{ref}</span>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="table-container rdd-x39">
            <table className="rdd-x40">
              <thead className="rdd-x41">
                <tr>
                  <th className="rdd-x42">
                    {filtroUnidad && filtroEstadoOps === 'pendientes' && operacionesMostradas.length > 0 && (
                      <input className="rdd-x43"
                        type="checkbox"
                        checked={todasSeleccionadas}
                        onChange={toggleSeleccionarTodas}
                        title="Seleccionar todo"
                      />
                    )}
                  </th>
                  {columnasOps.filter(c => c.visible).map(col => (
                    <th key={col.id}
                      style={col.orden ? thOrdenStyle : { padding: '16px', borderBottom: '1px solid #30363d', backgroundColor: '#1f2937', whiteSpace: 'nowrap' }}
                      onClick={col.orden ? () => toggleOrdenOps(col.id) : undefined}>
                      {col.label.toUpperCase()}{col.orden ? flechaOps(col.id) : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!busquedaOpsHecha ? (
                  <tr><td className="rdd-x44" colSpan={colsOpsVisibles}>
                    <div className="rdd-x45">
                      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#30363d" strokeWidth="1.6"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
                      <span className="rdd-x46">Elige la <b className="rdd-x47">Unidad</b> en los filtros y presiona <b className="rdd-x48">Buscar</b> para ver las operaciones.</span>
                      <button className="rdd-x49" onClick={() => setDrawerFiltrosAbierto(true)}>Abrir filtros</button>
                    </div>
                  </td></tr>
                ) : cargandoOps ? (
                  <tr><td className="rdd-x50" colSpan={colsOpsVisibles}>Cargando operaciones de la unidad...</td></tr>
                ) : operacionesMostradas.length === 0 ? (
                  <tr><td className="rdd-x50" colSpan={colsOpsVisibles}>
                    {filtroEstadoOps === 'pendientes'
                      ? 'No hay operaciones pendientes para los filtros seleccionados.'
                      : 'No hay operaciones cargadas para los filtros seleccionados.'}
                  </td></tr>
                ) : (
                  operacionesMostradas.map(op => {
                    const seleccionable = filtroEstadoOps === 'pendientes';
                    return (
                      <tr key={op.id} onClick={() => seleccionable && toggleSeleccion(op.id)}
                        style={{ cursor: seleccionable ? 'pointer' : 'default', borderBottom: '1px solid #21262d', backgroundColor: seleccionadas.includes(op.id) ? 'rgba(216,67,21,0.1)' : 'transparent' }}>
                        <td className="rdd-x51">
                          {seleccionable ? (
                            <input className="rdd-x43" type="checkbox" checked={seleccionadas.includes(op.id)} readOnly />
                          ) : (
                            <span className="rdd-x52" title={op.referenciaDieselConsecutivo || 'Cargada'} />
                          )}
                        </td>
                        {columnasOps.filter(c => c.visible).map(col => renderCeldaOps(op, col.id))}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

      ) : (
        <div className="animation-fade-in">
          
          <div className="rdd-x14">
            <button onClick={() => setDrawerFiltrosAbierto(true)} title="Mostrar filtros"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 16px', backgroundColor: '#161b22', border: `1px solid ${(busquedaRef || fechaDesdeHist || fechaHastaHist) ? '#D84315' : '#30363d'}`, borderRadius: '8px', color: '#c9d1d9', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.88rem' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
              Filtros
              {(busquedaRef || fechaDesdeHist || fechaHastaHist) && <span className="rdd-x15">{[busquedaRef, fechaDesdeHist || fechaHastaHist].filter(Boolean).length}</span>}
            </button>
            {busquedaRef && (
              <span className="rdd-x16">
                "{busquedaRef}"
                <button className="rdd-x17" onClick={() => setBusquedaRef('')}>✕</button>
              </span>
            )}
            {(fechaDesdeHist || fechaHastaHist) && (
              <span className="rdd-x18">
                {(fechaDesdeHist || '…')} → {(fechaHastaHist || '…')}
                <button className="rdd-x19" onClick={() => { setFechaDesdeHist(''); setFechaHastaHist(''); }}>✕</button>
              </span>
            )}
            <span className="rdd-x20">
              {busquedaRefHecha ? `${referenciasFiltradas.length} referencias` : 'Presiona Filtros y Buscar para ver el historial.'}
            </span>
            <button className="rdd-x53" title="Exportar a Excel" onClick={exportarCSV}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </button>
          </div>

          {/* RESUMEN: separa lo AUTORIZADO de lo CARGADO (galones y $) */}
          {busquedaRefHecha && referenciasFiltradas.length > 0 && (
            <div className="rdd-x28">
              <div className="rdd-x54">
                <div className="rdd-x30">
                  <span className="rdd-x55">Referencias Listadas</span>
                  <span className="rdd-x32">{referenciasFiltradas.length}</span>
                </div>

                {/* AUTORIZADO */}
                <div className="rdd-x30">
                  <span className="rdd-x56">Galones Autorizados</span>
                  <span className="rdd-x57">{resumenHistorial.totalGalonesAutorizados.toFixed(2)}</span>
                </div>
                <div className="rdd-x30">
                  <span className="rdd-x56">Total Autorizado</span>
                  <span className="rdd-x58">{formatoMoneda(resumenHistorial.granTotalAutorizado)}</span>
                </div>

                {/* CARGADO */}
                <div className="rdd-x30">
                  <span className="rdd-x59">Galones Cargados</span>
                  <span className="rdd-x60">{resumenHistorial.totalGalones.toFixed(2)}</span>
                </div>
                <div>
                  <span className="rdd-x59">Total Cargado</span>
                  <span className="rdd-x61">{formatoMoneda(resumenHistorial.granTotalCargado)}</span>
                </div>
              </div>
            </div>
          )}

          <div className="table-container rdd-x39">
            <table className="rdd-x40">
              <thead className="rdd-x41">
                <tr>
                  <th className="rdd-x62">ACCIONES</th>
                  <th className="rdd-x63">CONSECUTIVO</th>
                  <th className="rdd-x63">STATUS</th>
                  <th className="rdd-x63">UNIDAD</th>
                  <th className="rdd-x63">OPERADOR</th>
                  <th className="rdd-x63">PROVEEDOR</th>
                  <th className="rdd-x64">GAL. AUTORIZADOS</th>
                  <th className="rdd-x65">GAL. CARGADOS</th>
                  <th className="rdd-x64">TOTAL AUTORIZADO</th>
                  <th className="rdd-x65">TOTAL CARGADO</th>
                  <th className="rdd-x63">OBSERVACIONES</th>
                </tr>
              </thead>
              <tbody>
                {!busquedaRefHecha ? (
                  <tr><td className="rdd-x44" colSpan={11}>
                    <div className="rdd-x45">
                      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#30363d" strokeWidth="1.6"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
                      <span className="rdd-x46">Define tus filtros y presiona <b className="rdd-x48">Buscar</b> para ver las referencias.</span>
                      <button className="rdd-x49" onClick={() => setDrawerFiltrosAbierto(true)}>Abrir filtros</button>
                    </div>
                  </td></tr>
                ) : registrosVisibles.length === 0 ? (
                  <tr><td className="rdd-x66" colSpan={11}>No hay referencias registradas.</td></tr>
                ) : (
                  registrosVisibles.map(r => (
                    <tr className="rdd-x67" key={r.id}>
                      <td className="rdd-x51">
                        <div className="rdd-x68">
                          <button className="rdd-x69" 
                            title="Generar Instrucciones de Servicio (PDF)" 
                            onClick={(e) => handleGenerarInstrucciones(e, r)}
                            onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(16, 185, 129, 0.1)'}
                            onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><polyline points="9 15 12 18 15 15"></polyline></svg>
                          </button>

                          <button className="rdd-x70" 
                            title="Editar/Ver Ficha" 
                            onClick={() => setReferenciaViendo(r)}
                            onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'}
                            onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                          </button>
                          
                          <button className="rdd-x71" 
                            title="Eliminar Referencia" 
                            onClick={(e) => handleEliminarReferencia(e, r)}
                            onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'}
                            onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                          </button>
                        </div>
                      </td>
                      <td className="rdd-x72">{r.consecutivo}</td>
                      <td className="rdd-x73">
                        <span style={{ 
                          padding: '4px 12px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 'bold', 
                          backgroundColor: r.status === 'No Autorizado' ? 'rgba(239, 68, 68, 0.1)' : r.status === 'Autorizado' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                          color: r.status === 'No Autorizado' ? '#ef4444' : r.status === 'Autorizado' ? '#f59e0b' : '#10b981',
                          border: `1px solid ${r.status === 'No Autorizado' ? '#ef4444' : r.status === 'Autorizado' ? '#f59e0b' : '#10b981'}`
                        }}>
                          {r.status || 'No Autorizado'}
                        </span>
                      </td>
                      <td className="rdd-x74">{getNombreUnidad(r.unidadNombre || r.unidadId || r.unidad)}</td>
                      <td className="rdd-x75">{getNombreOperador(r.operadorNombre || r.operadorId || r.operador)}</td>
                      <td className="rdd-x75">{getNombreProveedor(r.proveedorNombre || r.proveedorId || r.proveedor)}</td>
                      <td className="rdd-x76">{Number(r.galonesAutorizados || 0).toFixed(2)} Gal.</td>
                      <td className="rdd-x77">{Number(r.galonesCargados || 0).toFixed(2)} Gal.</td>
                      <td className="rdd-x78">{formatoMoneda(r.totalAutorizado)}</td>
                      <td className="rdd-x10">{formatoMoneda(r.totalCargado)}</td>
                      <td className="rdd-x79">{r.observaciones || '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {busquedaRefHecha && totalPaginas > 1 && (
            <div className="rdd-x80">
              <button onClick={irPaginaAnterior} disabled={paginaActual === 1} style={{ padding: '8px 16px', cursor: paginaActual === 1 ? 'not-allowed' : 'pointer', background: 'none', border: 'none', color: '#c9d1d9' }}>Anterior</button>
              <span className="rdd-x81">{paginaActual} / {totalPaginas}</span>
              <button onClick={irPaginaSiguiente} disabled={paginaActual === totalPaginas} style={{ padding: '8px 16px', cursor: (paginaActual === totalPaginas) ? 'not-allowed' : 'pointer', background: 'none', border: 'none', color: '#c9d1d9' }}>Siguiente</button>
            </div>
          )}
        </div>
      )}

      {/* ═══════════ MODAL CONFIGURAR COLUMNAS (Asignar Operaciones) ═══════════ */}
      {modalColumnasOps && (
        <div className="modal-overlay rdd-x82">
          <div className="rdd-x83">
            <div className="rdd-x84">
              <h3 className="rdd-x85">Configurar Columnas</h3>
              <button className="rdd-x86" onClick={() => setModalColumnasOps(false)}>✕</button>
            </div>
            <p className="rdd-x87">Arrastra para reordenar. Desmarca las que quieras ocultar de la tabla y del Excel.</p>
            <ul className="rdd-x88">
              {columnasOps.map((col, idx) => (
                <li key={col.id} draggable onDragStart={(e) => handleDragStartOps(e, idx)} onDragEnter={() => handleDragEnterOps(idx)} onDragEnd={() => setDraggedColOpsIndex(null)} onDragOver={(e) => e.preventDefault()}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', backgroundColor: draggedColOpsIndex === idx ? '#1f2937' : '#161b22', border: '1px solid #30363d', borderRadius: '6px', cursor: 'grab' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                  <input className="rdd-x89" type="checkbox" checked={col.visible} onChange={() => toggleColumnaVisibleOps(idx)} />
                  <span style={{ color: col.visible ? '#c9d1d9' : '#484f58', fontSize: '0.85rem', fontWeight: col.visible ? 'bold' : 'normal' }}>{col.label}</span>
                </li>
              ))}
            </ul>
            <div className="rdd-x90">
              <button className="rdd-x91" onClick={() => setModalColumnasOps(false)}>Aplicar Cambios</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL FORMULARIO */}
      {modalAbierto && (
        <div className="modal-overlay rdd-x92">
          <div className="rdd-x93">
            <div className="rdd-x94">
              <h2 className="rdd-x95">Nueva Referencia: <span className="rdd-x48">{consecutivoForm}</span></h2>
              <button className="rdd-x86" onClick={() => setModalAbierto(false)}>✕</button>
            </div>

            <div className="rdd-x96">
              <div>
                <span className="rdd-x97">Status de la Referencia</span>
                <span style={{ 
                  padding: '4px 10px', 
                  borderRadius: '12px', 
                  fontSize: '0.85rem', 
                  fontWeight: 'bold', 
                  backgroundColor: statusReferenciaForm === 'No Autorizado' ? 'rgba(239, 68, 68, 0.1)' : statusReferenciaForm === 'Autorizado' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                  color: statusReferenciaForm === 'No Autorizado' ? '#ef4444' : statusReferenciaForm === 'Autorizado' ? '#f59e0b' : '#10b981',
                  border: `1px solid ${statusReferenciaForm === 'No Autorizado' ? '#ef4444' : statusReferenciaForm === 'Autorizado' ? '#f59e0b' : '#10b981'}`
                }}>
                  {statusReferenciaForm}
                </span>
              </div>
              <div className="rdd-x98">
                <span className="rdd-x99">Galones Calculados (Operaciones)</span>
                <span className="rdd-x100">{galonesCalculadosOp.toFixed(2)} Gal.</span>
              </div>
            </div>
            
            <form onSubmit={handleGuardarReferencia}>
              {/* ✅ 3 columnas: datos | costos+kilometraje+observaciones | fotos */}
              <div className="rdd-modal-cols">
              <div className="rdd-modal-col">
              <div className="rdd-x101">
                <div>
                  <label className="rdd-x102">FECHA</label>
                  <input className="rdd-x103" type="date" value={fechaForm} onChange={e => setFechaForm(e.target.value)} />
                </div>
                <div>
                  <label className="rdd-x102">PROVEEDOR</label>
                  <SelectorProveedorBuscable
                    proveedores={proveedoresFiltrados}
                    value={proveedorSeleccionado}
                    onChange={setProveedorSeleccionado}
                    resolverNombre={getNombreProveedor}
                  />
                </div>
                {/* ✅ NUEVO: OPERADOR (precargado con el de las operaciones seleccionadas, editable) */}
                <div>
                  <label className="rdd-x102">OPERADOR</label>
                  <select className="rdd-x103" value={operadorForm} onChange={e => setOperadorForm(e.target.value)}>
                    <option value="">— Sin operador —</option>
                    {operadoresSeleccionados.length > 1 && <option value="Varios">Varios</option>}
                    {operadoresOptions.map(nom => <option key={nom} value={nom}>{nom}</option>)}
                  </select>
                  {operadorSugerido && operadorForm !== operadorSugerido && (
                    <span style={{ display: 'block', marginTop: '4px', fontSize: '0.75rem', color: '#f59e0b' }}>
                      Sugerido por las operaciones: {operadorSugerido}
                    </span>
                  )}
                </div>
                <div>
                  <label className="rdd-x102">GALONES EXTRAS</label>
                  <input className="rdd-x103" type="number" step="0.01" value={galonesExtras} onChange={e => setGalonesExtras(e.target.valueAsNumber || '')} />
                </div>
                <div>
                  <label className="rdd-x102">GALONES CARGADOS</label>
                  <input className="rdd-x103" type="number" step="0.01" value={galonesCargados} onChange={e => setGalonesCargados(e.target.valueAsNumber || '')} />
                </div>

                <div className="rdd-x104">
                  <div>
                    <span className="rdd-x99">Galones Autorizados (no editable)</span>
                    <span className="rdd-x105">
                      Operaciones ({galonesCalculadosOp.toFixed(2)}) + Extras ({(Number(galonesExtras) || 0).toFixed(2)})
                    </span>
                  </div>
                  <span className="rdd-x100">{galonesAutorizadosCalc.toFixed(2)} Gal.</span>
                </div>
              </div>

              </div>

              <div className="rdd-modal-col">
              <div className="rdd-x106">
                 <div className="rdd-x107"><span className="rdd-x108">Costo Diesel ({fechaForm}):</span><span className="rdd-x109">{formatoMoneda(costoDieselDiario)}</span></div>
                 <div className="rdd-x107"><span className="rdd-x108">Total Autorizado:</span><span className="rdd-x110">{formatoMoneda(galonesAutorizadosCalc * costoDieselDiario)}</span></div>
                 <div className="rdd-x111"><span className="rdd-x108">Total Cargado:</span><span className="rdd-x112">{formatoMoneda((Number(galonesCargados) || 0) * costoDieselDiario)}</span></div>
              </div>

              {/* ✅ NUEVO: kilometraje real vs estimado */}
              <div className="rdd-km-bloque">
                <div className="rdd-km-fila">
                  <span className="rdd-x108">Kilometraje Estimado (operaciones):</span>
                  <span className="rdd-km-estimado">{resumenSeleccion.kmEstimado.toLocaleString('en-US')} km</span>
                </div>
                <div>
                  <label className="rdd-x102">KILOMETRAJE REAL</label>
                  <input className="rdd-x103" type="number" min="0" step="1" value={kilometrajeReal} onChange={e => setKilometrajeReal(e.target.valueAsNumber || '')} placeholder="km recorridos" />
                </div>
                {kilometrajeReal !== '' && resumenSeleccion.kmEstimado > 0 && (() => {
                  const dif = Number(kilometrajeReal) - resumenSeleccion.kmEstimado;
                  const pct = (dif / resumenSeleccion.kmEstimado) * 100;
                  return (
                    <div className={`rdd-km-dif${dif > 0 ? ' excede' : ' ok'}`}>
                      {dif === 0
                        ? 'Coincide exacto con el estimado.'
                        : dif > 0
                          ? `Excede el estimado por ${dif.toLocaleString('en-US')} km (+${pct.toFixed(1)}%).`
                          : `Por debajo del estimado por ${(-dif).toLocaleString('en-US')} km (${pct.toFixed(1)}%).`}
                    </div>
                  );
                })()}
              </div>

              <div className="rdd-x113">
                <label className="rdd-x102">OBSERVACIONES</label>
                <textarea className="rdd-x114" value={observacionesForm} onChange={e => setObservacionesForm(e.target.value)} />
              </div>
              </div>

              <div className="rdd-modal-col">
              {/* FOTOS DE LA REFERENCIA */}
              <div className="rdd-x113">
                <label className="rdd-x115">
                  FOTOS <span className="rdd-x116">(se guardan en {sanitizarSegmentoRuta(consecutivoForm)}/{sanitizarSegmentoRuta(filtroUnidad)}/)</span>
                </label>

                <input className="rdd-x117"
                  ref={fotoInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleFotosInput}
                />

                <div
                  onClick={() => fotoInputRef.current?.click()}
                  onDragEnter={handleDragEnterFoto}
                  onDragLeave={handleDragLeaveFoto}
                  onDragOver={handleDragOverFoto}
                  onDrop={handleDropFoto}
                  style={{
                    border: `2px dashed ${arrastrandoFoto ? '#D84315' : '#30363d'}`,
                    backgroundColor: arrastrandoFoto ? 'rgba(216,67,21,0.08)' : '#161b22',
                    borderRadius: '8px',
                    padding: '24px',
                    textAlign: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <svg className="rdd-x118" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={arrastrandoFoto ? '#D84315' : '#8b949e'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                  <div style={{ color: arrastrandoFoto ? '#D84315' : '#c9d1d9', fontSize: '0.9rem', fontWeight: 'bold' }}>
                    {arrastrandoFoto ? 'Suelta las fotos aquí' : 'Haz clic o arrastra fotos aquí'}
                  </div>
                  <div className="rdd-x119">Solo imágenes (JPG, PNG, etc.)</div>
                </div>

                {fotosSeleccionadas.length > 0 && (
                  <div className="rdd-x120">
                    {previewsFotos.map((url, i) => (
                      <div className="rdd-x121" key={i}>
                        <img className="rdd-x122" src={url} alt={fotosSeleccionadas[i]?.name || `foto-${i}`} />
                        <button className="rdd-x123"
                          type="button"
                          onClick={(e) => { e.stopPropagation(); quitarFoto(i); }}
                          title="Quitar foto"
                        >✕</button>
                      </div>
                    ))}
                  </div>
                )}
                {fotosSeleccionadas.length > 0 && (
                  <span className="rdd-x124">
                    {fotosSeleccionadas.length} {fotosSeleccionadas.length === 1 ? 'foto seleccionada' : 'fotos seleccionadas'}
                  </span>
                )}
              </div>

              </div>
              </div>

              <div className="rdd-x125">
                <button className="rdd-x126" type="button" onClick={() => setModalAbierto(false)} disabled={guardando}>Cancelar</button>
                <button className="rdd-x127" type="submit" disabled={guardando}>{subiendoFotos ? 'Subiendo fotos...' : guardando ? 'Guardando...' : 'Guardar Referencia'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL FICHA REFERENCIA */}
      {referenciaViendo && (
        <div className="modal-overlay rdd-x128">
          <div className="rdd-x129">
            <div className="rdd-x130">
              <h2 className="rdd-x131">Ficha de Referencia Diesel</h2>
              <div className="rdd-x132">
                <button className="rdd-x133" onClick={() => generarInstruccionesDieselPDF(construirDatosInstrucciones(referenciaViendo))}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><polyline points="9 15 12 18 15 15"></polyline></svg>
                  Instrucciones
                </button>
                <button className="rdd-x134" onClick={() => abrirEdicionRef(referenciaViendo)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                  Editar
                </button>
                <button className="rdd-x86" onClick={() => setReferenciaViendo(null)}>✕</button>
              </div>
            </div>
            
            <div className="rdd-x135">
              <div className="rdd-x136">
                <div className="rdd-x137">
                  <div>
                    <span className="rdd-x138">Consecutivo</span>
                    <span className="rdd-x139">{referenciaViendo.consecutivo}</span>
                  </div>
                  <div className="rdd-x140">
                    <span className="rdd-x31">Status</span>
                    <span style={{ 
                        padding: '4px 12px', borderRadius: '12px', fontSize: '0.85rem', fontWeight: 'bold', 
                        backgroundColor: referenciaViendo.status === 'No Autorizado' ? 'rgba(239, 68, 68, 0.1)' : referenciaViendo.status === 'Autorizado' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                        color: referenciaViendo.status === 'No Autorizado' ? '#ef4444' : referenciaViendo.status === 'Autorizado' ? '#f59e0b' : '#10b981',
                        border: `1px solid ${referenciaViendo.status === 'No Autorizado' ? '#ef4444' : referenciaViendo.status === 'Autorizado' ? '#f59e0b' : '#10b981'}`
                      }}>
                        {referenciaViendo.status || 'No Autorizado'}
                    </span>
                  </div>
                  <div className="rdd-x98">
                    <span className="rdd-x138">Fecha</span>
                    <span className="rdd-x141">{formatearFechaSpanish(referenciaViendo.fecha)}</span>
                  </div>
                </div>

                <div>
                  <span className="rdd-x138">Unidad</span>
                  <span className="rdd-x142">{getNombreUnidad(referenciaViendo.unidadNombre || referenciaViendo.unidadId || referenciaViendo.unidad)}</span>
                </div>
                <div>
                  <span className="rdd-x138">Operador</span>
                  <span className="rdd-x142">{getNombreOperador(referenciaViendo.operadorNombre || referenciaViendo.operadorId || referenciaViendo.operador)}</span>
                </div>
                <div>
                  <span className="rdd-x138">Proveedor</span>
                  <span className="rdd-x142">{getNombreProveedor(referenciaViendo.proveedorNombre || referenciaViendo.proveedorId || referenciaViendo.proveedor)}</span>
                </div>

                <div className="rdd-x143"><hr className="rdd-x144" /></div>

                <div>
                  <span className="rdd-x138">Suma de Diesel</span>
                  <span className="rdd-x142">{Number(referenciaViendo.sumaDiesel || 0).toFixed(2)}</span>
                </div>
                <div>
                  <span className="rdd-x138">Costo Diario</span>
                  <span className="rdd-x142">{formatoMoneda(referenciaViendo.costoDiesel)}</span>
                </div>
                <div>
                  <span className="rdd-x138">Galones Extras</span>
                  <span className="rdd-x142">{Number(referenciaViendo.galonesExtras || 0).toFixed(2)} Gal.</span>
                </div>

                <div className="rdd-x145">
                  {/* AUTORIZADO */}
                  <div className="rdd-x146">
                    <span className="rdd-x147">Galones Autorizados</span>
                    <span className="rdd-x148">{Number(referenciaViendo.galonesAutorizados || 0).toFixed(2)} <span className="rdd-x149">Gal.</span></span>
                    <span className="rdd-x150">Operaciones + Extras</span>
                    <div className="rdd-x151">
                      <span className="rdd-x152">Total</span>
                      <span className="rdd-x153">{formatoMoneda(referenciaViendo.totalAutorizado)}</span>
                    </div>
                  </div>
                  {/* CARGADO */}
                  <div className="rdd-x154">
                    <span className="rdd-x147">Galones Cargados</span>
                    <span className="rdd-x155">{Number(referenciaViendo.galonesCargados || 0).toFixed(2)} <span className="rdd-x149">Gal.</span></span>
                    <span className="rdd-x150">Diesel realmente cargado</span>
                    <div className="rdd-x151">
                      <span className="rdd-x152">Total</span>
                      <span className="rdd-x156">{formatoMoneda(referenciaViendo.totalCargado)}</span>
                    </div>
                  </div>
                  {/* DIFERENCIA (aprovecha el espacio antes vacío) */}
                  {(() => {
                    const aut = Number(referenciaViendo.galonesAutorizados || 0);
                    const car = Number(referenciaViendo.galonesCargados || 0);
                    const difG = car - aut;
                    const difT = Number(referenciaViendo.totalCargado || 0) - Number(referenciaViendo.totalAutorizado || 0);
                    const excede = difG > 0.001;
                    const color = excede ? '#f59e0b' : '#3fb950';
                    const signo = (n: number) => n > 0.001 ? '+' : (n < -0.001 ? '\u2212' : '');
                    return (
                      <div style={{ backgroundColor: '#0d1117', padding: '16px', borderRadius: '10px', border: '1px solid #30363d', borderTop: `3px solid ${color}`, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span className="rdd-x147">Diferencia</span>
                        <span style={{ color, fontSize: '1.7rem', fontWeight: 'bold', lineHeight: 1.1 }}>{signo(difG)}{Math.abs(difG).toFixed(2)} <span className="rdd-x149">Gal.</span></span>
                        <span className="rdd-x150">{excede ? 'Cargó más de lo autorizado' : 'Dentro de lo autorizado'}</span>
                        <div className="rdd-x151">
                          <span className="rdd-x152">Total</span>
                          <span style={{ color, fontSize: '1.05rem', fontWeight: 'bold' }}>{signo(difT)}{formatoMoneda(Math.abs(difT))}</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                <div className="rdd-x143">
                  <span className="rdd-x138">Observaciones</span>
                  <div className="rdd-x157">
                    {referenciaViendo.observaciones || '-'}
                  </div>
                </div>

                {/* FOTOS DE LA REFERENCIA (ver y AGREGAR desde la ficha) */}
                <div className="rdd-x143">
                  <span className="rdd-x158">
                    Fotos ({Array.isArray(referenciaViendo.fotos) ? referenciaViendo.fotos.length : 0})
                  </span>

                  {Array.isArray(referenciaViendo.fotos) && referenciaViendo.fotos.length > 0 && (
                    <div className="rdd-x159">
                      {referenciaViendo.fotos.map((foto: any, i: number) => (
                        <a className="rdd-x160"
                          key={i}
                          href={foto.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={foto.nombre || `Foto ${i + 1}`}
                        >
                          <img className="rdd-x161" src={foto.url} alt={foto.nombre || `foto-${i}`} />
                        </a>
                      ))}
                    </div>
                  )}

                  {/* Zona para agregar fotos nuevas (clic o arrastrar) */}
                  <input className="rdd-x117"
                    ref={fotoDetalleInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleFotosDetalleInput}
                  />
                  <div
                    onClick={() => fotoDetalleInputRef.current?.click()}
                    onDragEnter={handleDragEnterFotoDetalle}
                    onDragLeave={handleDragLeaveFotoDetalle}
                    onDragOver={handleDragOverFotoDetalle}
                    onDrop={handleDropFotoDetalle}
                    style={{
                      border: `2px dashed ${arrastrandoFotoDetalle ? '#D84315' : '#30363d'}`,
                      backgroundColor: arrastrandoFotoDetalle ? 'rgba(216,67,21,0.08)' : '#161b22',
                      borderRadius: '8px',
                      padding: '16px',
                      textAlign: 'center',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    <svg className="rdd-x162" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={arrastrandoFotoDetalle ? '#D84315' : '#8b949e'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                    <div style={{ color: arrastrandoFotoDetalle ? '#D84315' : '#c9d1d9', fontSize: '0.85rem', fontWeight: 'bold' }}>
                      {arrastrandoFotoDetalle ? 'Suelta las fotos aquí' : 'Haz clic o arrastra fotos para agregarlas a esta referencia'}
                    </div>
                    <div className="rdd-x163">Solo imágenes (JPG, PNG, etc.)</div>
                  </div>

                  {fotosNuevasDetalle.length > 0 && (
                    <>
                      <div className="rdd-x120">
                        {previewsFotosDetalle.map((url, i) => (
                          <div className="rdd-x164" key={i}>
                            <img src={url} alt={fotosNuevasDetalle[i]?.name || `foto-nueva-${i}`} style={{ width: '100%', height: '80px', objectFit: 'cover', display: 'block', opacity: subiendoFotosDetalle ? 0.5 : 1 }} />
                            <button className="rdd-x123"
                              type="button"
                              onClick={(e) => { e.stopPropagation(); quitarFotoDetalle(i); }}
                              disabled={subiendoFotosDetalle}
                              title="Quitar foto"
                            >✕</button>
                          </div>
                        ))}
                      </div>
                      <div className="rdd-x165">
                        <span className="rdd-x166">
                          {fotosNuevasDetalle.length} {fotosNuevasDetalle.length === 1 ? 'foto nueva por subir' : 'fotos nuevas por subir'}
                        </span>
                        <button
                          type="button"
                          onClick={subirFotosDesdeDetalle}
                          disabled={subiendoFotosDetalle}
                          style={{ padding: '8px 20px', backgroundColor: '#238636', color: '#fff', border: 'none', borderRadius: '6px', cursor: subiendoFotosDetalle ? 'wait' : 'pointer', fontWeight: 'bold', fontSize: '0.85rem', opacity: subiendoFotosDetalle ? 0.7 : 1 }}
                        >
                          {subiendoFotosDetalle ? 'Subiendo fotos...' : `Subir ${fotosNuevasDetalle.length} ${fotosNuevasDetalle.length === 1 ? 'foto' : 'fotos'}`}
                        </button>
                      </div>
                    </>
                  )}
                </div>

                <div className="rdd-x143">
                  <span className="rdd-x158">Operaciones Incluidas en esta Referencia</span>
                  <div className="rdd-x37">
                    {referenciaViendo.operacionesIds?.map((idOp: string) => {
                      const match = operacionesGlobales.find(o => o.id === idOp);
                      const displayRef = match ? (match.ref || match.id?.substring(0,6)) : idOp.substring(0,6);
                      
                      return (
                        <span 
                          key={idOp} 
                          onClick={() => { if(match) { setOperacionAEditar(match); setEditCombustibleOp(match.combustibleTotal || ''); } }}
                          title={match ? "Clic para ver/editar detalle" : "Detalle no disponible sin cargar Asignaciones"}
                          style={{ 
                            backgroundColor: '#21262d', border: '1px solid #58a6ff', color: '#58a6ff', 
                            padding: '6px 14px', borderRadius: '16px', fontSize: '0.85rem', fontFamily: 'monospace',
                            cursor: match ? 'pointer' : 'default', transition: 'all 0.2s ease', display: 'inline-flex', alignItems: 'center', gap: '6px'
                          }}
                        >
                          {displayRef}
                          {/* Caja Cargada / Vacía y Hazmat de la operación */}
                          {match && (() => {
                            const atrib = atributosCajaOp(match);
                            return (
                              <>
                                {atrib.carga && (
                                  <span style={{ fontSize: '0.62rem', fontWeight: 'bold', padding: '1px 7px', borderRadius: '999px', letterSpacing: '0.5px',
                                    border: `1px solid ${atrib.carga === 'CARGADA' ? '#3fb950' : '#8b949e'}`,
                                    color: atrib.carga === 'CARGADA' ? '#3fb950' : '#8b949e' }}>
                                    {atrib.carga === 'CARGADA' ? 'CARGADA' : 'VACÍA'}
                                  </span>
                                )}
                                {atrib.hazmat && (
                                  <span className="rdd-x167">
                                    ☣ HAZMAT
                                  </span>
                                )}
                              </>
                            );
                          })()}
                          {match && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>}
                        </span>
                      );
                    })}
                  </div>
                </div>

              </div>
            </div>
            
            <div className="rdd-x168">
              <button onClick={() => setReferenciaViendo(null)} className="btn btn-outline rdd-x169">Cerrar Ficha</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: EDITAR REFERENCIA (datos del registro) */}
      {editandoRef && (
        <div className="modal-overlay rdd-x170">
          <div className="rdd-x171">
            <div className="rdd-x172">
              <h2 className="rdd-x173">Editar Referencia: <span className="rdd-x174">{editandoRef.consecutivo}</span></h2>
              <button className="rdd-x86" onClick={() => setEditandoRef(null)}>✕</button>
            </div>

            <form onSubmit={handleGuardarEdicionRef}>
              <div className="rdd-x101">

                {/* NÚMERO DE REFERENCIA EDITABLE (debe ser único) */}
                <div className="rdd-x175">
                  <label className="rdd-x176">NÚMERO DE REFERENCIA (CONSECUTIVO)</label>
                  <input className="rdd-x177"
                    type="text"
                    value={formEditRef.consecutivo}
                    onChange={e => setFormEditRef({ ...formEditRef, consecutivo: e.target.value })}
                    placeholder="Ej: DIESEL-260626-001"
                  />
                  <span className="rdd-x178">Debe ser único. Si lo cambias, se actualizará también en las operaciones ligadas.</span>
                </div>

                <div>
                  <label className="rdd-x102">FECHA</label>
                  <input className="rdd-x179" type="date" value={formEditRef.fecha} onChange={e => setFormEditRef({ ...formEditRef, fecha: e.target.value })} />
                </div>
                <div>
                  <label className="rdd-x102">PROVEEDOR</label>
                  <SelectorProveedorBuscable
                    proveedores={proveedoresFiltrados}
                    value={formEditRef.proveedorId}
                    onChange={(id) => setFormEditRef({ ...formEditRef, proveedorId: id })}
                    resolverNombre={getNombreProveedor}
                  />
                </div>
                <div>
                  <label className="rdd-x102">OPERADOR</label>
                  <select className="rdd-x103" value={formEditRef.operadorId} onChange={e => setFormEditRef({ ...formEditRef, operadorId: e.target.value })}>
                    <option value="">Sin asignar</option>
                    {formEditRef.operadorId === '__actual__' && (
                      <option value="__actual__">{editandoRef.operadorNombre} (actual)</option>
                    )}
                    {[...operadoresList].sort((a, b) => `${a.firstName || ''} ${a.lastNamePaternal || ''}`.localeCompare(`${b.firstName || ''} ${b.lastNamePaternal || ''}`)).map(o => (
                      <option key={o.id} value={o.id}>{`${o.firstName || ''} ${o.lastNamePaternal || ''}`.trim()}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="rdd-x102">GALONES EXTRAS</label>
                  <input className="rdd-x103" type="number" step="0.01" value={formEditRef.galonesExtras} onChange={e => setFormEditRef({ ...formEditRef, galonesExtras: e.target.valueAsNumber || '' })} />
                </div>
                <div>
                  <label className="rdd-x102">GALONES CARGADOS</label>
                  <input className="rdd-x103" type="number" step="0.01" value={formEditRef.galonesCargados} onChange={e => setFormEditRef({ ...formEditRef, galonesCargados: e.target.valueAsNumber || '' })} />
                </div>
                <div>
                  <label className="rdd-x102">COSTO DIARIO DIESEL</label>
                  <input className="rdd-x103" type="number" step="0.01" value={formEditRef.costoDiesel} onChange={e => setFormEditRef({ ...formEditRef, costoDiesel: e.target.valueAsNumber || '' })} />
                </div>
                <div className="rdd-x180">
                  <span className="rdd-x181">Galones Autorizados (automático)</span>
                  <span className="rdd-x182">
                    {(Number(editandoRef.sumaDiesel || 0) + (Number(formEditRef.galonesExtras) || 0)).toFixed(2)} Gal.
                  </span>
                </div>
              </div>

              <div className="rdd-x113">
                <label className="rdd-x102">OBSERVACIONES</label>
                <textarea className="rdd-x183" value={formEditRef.observaciones} onChange={e => setFormEditRef({ ...formEditRef, observaciones: e.target.value })} />
              </div>

              <div className="rdd-x184">
                <div className="rdd-x111">
                  <span className="rdd-x108">Suma de Diesel (operaciones, no editable):</span>
                  <span className="rdd-x109">{Number(editandoRef.sumaDiesel || 0).toFixed(2)}</span>
                </div>
              </div>

              <div className="rdd-x125">
                <button className="rdd-x126" type="button" onClick={() => setEditandoRef(null)} disabled={guardandoEdicionRef}>Cancelar</button>
                <button className="rdd-x185" type="submit" disabled={guardandoEdicionRef}>{guardandoEdicionRef ? 'Guardando...' : 'Guardar Cambios'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: EDICIÓN RÁPIDA DE OPERACIÓN */}
      {operacionAEditar && (
        <div className="modal-overlay rdd-x186">
          <div className="rdd-x187">
            <div className="rdd-x188">
              <h2 className="rdd-x189">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" strokeWidth="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                Edición de Operación
              </h2>
              <button className="rdd-x86" onClick={() => setOperacionAEditar(null)}>✕</button>
            </div>

            <div className="rdd-x190">
              <div className="rdd-x107">
                <span className="rdd-x191">REF. OPERACIÓN</span>
                <span className="rdd-x192">{operacionAEditar.ref || operacionAEditar.id.substring(0,6)}</span>
              </div>
              <div className="rdd-x107">
                <span className="rdd-x191">ORIGEN</span>
                <span className="rdd-x193">{getNombreLugar(operacionAEditar.origen)}</span>
              </div>
              <div className="rdd-x111">
                <span className="rdd-x191">DESTINO</span>
                <span className="rdd-x193">{getNombreLugar(operacionAEditar.destino)}</span>
              </div>
            </div>

            <form onSubmit={handleActualizarOperacion}>
              <div className="rdd-x194">
                <label className="rdd-x195">
                  Combustible Total (Diesel Op.)
                </label>
                <div className="rdd-x1">
                  <span className="rdd-x196">#</span>
                  <input className="rdd-x197" 
                    type="number" 
                    step="0.01" 
                    value={editCombustibleOp} 
                    onChange={e => setEditCombustibleOp(e.target.valueAsNumber || '')} 
                    required 
                  />
                </div>
                <span className="rdd-x124">
                  * Al guardar, se recalculará automáticamente la Suma de Diesel y los Galones Autorizados en la Referencia Maestra.
                </span>
              </div>

              <div className="rdd-x125">
                <button className="rdd-x198" type="button" onClick={() => setOperacionAEditar(null)} disabled={guardandoEdicionOp}>Cancelar</button>
                <button className="rdd-x199" type="submit" disabled={guardandoEdicionOp}>
                  {guardandoEdicionOp ? 'Guardando...' : 'Actualizar Diesel'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}


      {/* NUEVO: panel lateral DERECHO de filtros (Referencias del Diesel) */}
      {drawerFiltrosAbierto && (
        <div className="rdd-x200" onClick={() => setDrawerFiltrosAbierto(false)}>
          <div className="rdd-x201" onClick={(e) => e.stopPropagation()}>
            <div className="rdd-x202">
              <h3 className="rdd-x203">Filtros · {activeTab === 'operaciones' ? 'Operaciones' : 'Historial'}</h3>
              <button className="rdd-x86" onClick={() => setDrawerFiltrosAbierto(false)}>✕</button>
            </div>

            {activeTab === 'operaciones' ? (
              <>
                <div className="rdd-x204">
                  <label className="rdd-x205">UNIDAD <span className="rdd-x206">*</span></label>
                  <select value={filtroUnidad} onChange={e => { setFiltroUnidad(e.target.value); setSeleccionadas([]); }} style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', color: '#c9d1d9', border: `1px solid ${filtroUnidad ? '#58a6ff' : '#30363d'}`, borderRadius: '6px', boxSizing: 'border-box' }}>
                    <option value="">Seleccionar Unidad...</option>
                    {unidadesOptions.map((name, i) => <option key={i} value={name}>{name}</option>)}
                  </select>
                </div>

                <div className="rdd-x204">
                  <label className="rdd-x191">ESTADO</label>
                  <div className="rdd-x207">
                    <button onClick={() => { setFiltroEstadoOps('pendientes'); }} style={{ flex: 1, padding: '9px 0', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem', backgroundColor: filtroEstadoOps === 'pendientes' ? 'rgba(239,68,68,0.15)' : 'transparent', color: filtroEstadoOps === 'pendientes' ? '#ef4444' : '#8b949e' }}>● Pendientes ({conteoOps.pendientes})</button>
                    <button onClick={() => { setFiltroEstadoOps('cargadas'); setSeleccionadas([]); }} style={{ flex: 1, padding: '9px 0', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem', backgroundColor: filtroEstadoOps === 'cargadas' ? 'rgba(16,185,129,0.15)' : 'transparent', color: filtroEstadoOps === 'cargadas' ? '#10b981' : '#8b949e' }}>● Cargadas ({conteoOps.cargadas})</button>
                  </div>
                </div>

                <div className="rdd-x208">
                  <div className="rdd-x209">
                    <label className="rdd-x191">FECHA DESDE</label>
                    <input type="date" value={fechaDesdeOps} onChange={(e) => setFechaDesdeOps(e.target.value)} style={{ ...dateInputStyle, width: '100%', boxSizing: 'border-box' }} />
                  </div>
                  <div className="rdd-x209">
                    <label className="rdd-x191">FECHA HASTA</label>
                    <input type="date" value={fechaHastaOps} min={fechaDesdeOps || undefined} onChange={(e) => setFechaHastaOps(e.target.value)} style={{ ...dateInputStyle, width: '100%', boxSizing: 'border-box' }} />
                  </div>
                </div>

                <div className="rdd-x204">
                  <label className="rdd-x191">ORDENAR POR</label>
                  <div className="rdd-x210">
                    <select value={ordenOps.campo} onChange={(e) => setOrdenOps(prev => ({ ...prev, campo: e.target.value }))} style={{ ...selectOrdenStyle, flex: 1 }}>
                      <option value="ref">Referencia</option>
                      <option value="fechaServicio">Fecha Servicio</option>
                      <option value="unidad">Unidad</option>
                      <option value="operador">Operador</option>
                      <option value="origen">Origen</option>
                      <option value="destino">Destino</option>
                      <option value="diesel">Diesel</option>
                    </select>
                    <button onClick={() => setOrdenOps(prev => ({ ...prev, dir: prev.dir === 'asc' ? 'desc' : 'asc' }))} style={btnDirStyle} title="Cambiar dirección">
                      {ordenOps.dir === 'asc' ? '▲ Asc' : '▼ Desc'}
                    </button>
                  </div>
                </div>

                <div className="rdd-x211">
                  La <b className="rdd-x47">Unidad</b> es obligatoria; las fechas y el estado son opcionales.
                </div>
              </>
            ) : (
              <>
                <div className="rdd-x204">
                  <label className="rdd-x205">BÚSQUEDA</label>
                  <div className="rdd-x1">
                    <svg className="rdd-x212" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                    <input className="rdd-x213" type="text" placeholder="Unidad, referencia, status, proveedor..." value={busquedaRef} onChange={e => setBusquedaRef(e.target.value)} />
                    {busquedaRef && (
                      <button className="rdd-x214" onClick={() => setBusquedaRef('')} title="Limpiar">✕</button>
                    )}
                  </div>
                </div>

                {/* NUEVO: rango de fechas del historial (fecha de la referencia) */}
                <div className="rdd-x208">
                  <div className="rdd-x209">
                    <label className="rdd-x191">FECHA DESDE</label>
                    <input type="date" value={fechaDesdeHist} onChange={(e) => setFechaDesdeHist(e.target.value)} style={{ ...dateInputStyle, width: '100%', boxSizing: 'border-box' }} />
                  </div>
                  <div className="rdd-x209">
                    <label className="rdd-x191">FECHA HASTA</label>
                    <input type="date" value={fechaHastaHist} min={fechaDesdeHist || undefined} onChange={(e) => setFechaHastaHist(e.target.value)} style={{ ...dateInputStyle, width: '100%', boxSizing: 'border-box' }} />
                  </div>
                </div>

                <div className="rdd-x211">
                  La búsqueda y las fechas son <b className="rdd-x108">opcionales</b>. Presiona <b className="rdd-x48">Buscar</b> para ver todo el historial.
                </div>
              </>
            )}

            <div className="rdd-x215">
              <button className="rdd-x216" onClick={() => {
                if (activeTab === 'operaciones') { setFiltroUnidad(''); setFechaDesdeOps(''); setFechaHastaOps(''); setSeleccionadas([]); setBusquedaOpsHecha(false); }
                else { setBusquedaRef(''); setFechaDesdeHist(''); setFechaHastaHist(''); setBusquedaRefHecha(false); }
              }}>Limpiar</button>
              <button className="rdd-x217" onClick={() => {
                if (activeTab === 'operaciones') {
                  if (!filtroUnidad) { alert('Selecciona una Unidad para buscar sus operaciones.'); return; }
                  setBusquedaOpsHecha(true);
                } else {
                  setBusquedaRefHecha(true);
                }
                setDrawerFiltrosAbierto(false);
              }}>Buscar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};