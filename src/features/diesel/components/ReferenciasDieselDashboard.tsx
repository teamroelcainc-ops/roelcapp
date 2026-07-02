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
  getDoc
} from 'firebase/firestore';
import { db } from '../../../config/firebase';
import * as XLSX from 'xlsx';
import { generarInstruccionesDieselPDF } from '../../../utils/pdfInstruccionesDiesel';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';

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
    <div ref={contenedorRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setAbierto(o => !o)}
        style={{
          width: '100%', padding: '8px', backgroundColor: '#161b22', color: '#fff',
          border: '1px solid #30363d', borderRadius: '4px', boxSizing: 'border-box',
          cursor: 'pointer', textAlign: 'left', display: 'flex',
          justifyContent: 'space-between', alignItems: 'center', gap: '8px',
        }}
      >
        <span style={{ color: nombreMostrado ? '#fff' : '#8b949e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {nombreMostrado || placeholder}
        </span>
        <span style={{ color: '#8b949e', fontSize: '0.7rem', flexShrink: 0 }}>{abierto ? '▲' : '▼'}</span>
      </button>

      {abierto && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 50,
          backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)', overflow: 'hidden',
        }}>
          <div style={{ padding: '8px' }}>
            <input
              autoFocus
              type="text"
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar proveedor..."
              style={{ width: '100%', padding: '8px', backgroundColor: '#161b22', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '4px', boxSizing: 'border-box' }}
            />
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: '220px', overflowY: 'auto' }}>
            {filtrados.length === 0 ? (
              <li style={{ padding: '12px', color: '#8b949e', fontSize: '0.85rem', textAlign: 'center' }}>Sin resultados</li>
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

  const [filtroUnidad, setFiltroUnidad] = useState('');
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
  const [paginaActual, setPaginaActual] = useState(1);
  const registrosPorPagina = 50;

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

  const [fechaForm, setFechaForm] = useState(new Date().toISOString().split('T')[0]);
  const [consecutivoForm, setConsecutivoForm] = useState('');
  // Galones Extras: editable (antes "Galones Autorizados")
  const [galonesExtras, setGalonesExtras] = useState<number | ''>('');
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
      case 'ref': return <td key={key} style={{ padding: '16px', color: '#58a6ff', fontWeight: 'bold', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{op.ref || op.id.substring(0, 6)}</td>;
      case 'fechaServicio': return <td key={key} style={tdBase}>{formatearFechaSpanish(op.fechaServicio || op.createdAt)}</td>;
      case 'unidad': return <td key={key} style={tdBase}>{getNombreUnidad(op.unidadNombre || op.unidadId || op.unidad)}</td>;
      case 'operador': return <td key={key} style={tdBase}>{getNombreOperador(op.operadorNombre || op.operadorId || op.operador)}</td>;
      case 'origen': return <td key={key} style={tdBase}>{getNombreLugar(op.origen)}</td>;
      case 'destino': return <td key={key} style={tdBase}>{getNombreLugar(op.destino)}</td>;
      case 'diesel': return <td key={key} style={{ padding: '16px', color: '#3fb950', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{Number(op.combustibleTotal || 0).toFixed(2)}</td>;
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
    const hoy = new Date().toISOString().split('T')[0];
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
    const refs: string[] = [];
    seleccionadas.forEach(id => {
      const op = operacionesGlobales.find(o => o.id === id);
      if (op) {
        dieselTotal += Number(op.combustibleTotal || 0);
        refs.push(op.ref || op.id?.substring(0,6));
      }
    });
    return { dieselTotal, refs };
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

      const operadorRef = operadoresSeleccionados.length === 1
        ? operadoresSeleccionados[0]
        : (operadoresSeleccionados.length > 1 ? 'Varios' : '');
      const foundOp = operadoresSeleccionados.length === 1
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
  }, [referenciasGlobales, busquedaRef, unidadesList, operadoresList, proveedoresList]);

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
    XLSX.writeFile(workbook, `Referencias_Diesel_${new Date().toISOString().split('T')[0]}.xlsx`);
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
    <div className="module-container" style={{ padding: '24px', animation: 'fadeIn 0.3s ease' }}>
      <h1 style={{ color: '#f0f6fc', fontSize: '1.5rem', marginBottom: '24px' }}>Referencias del Diesel</h1>

      <div style={{ display: 'flex', borderBottom: '1px solid #30363d', marginBottom: '24px' }}>
        <button onClick={() => setActiveTab('operaciones')} style={tabStyle(activeTab === 'operaciones')}>Asignar Operaciones</button>
        <button onClick={() => setActiveTab('referencias')} style={tabStyle(activeTab === 'referencias')}>Historial de Referencias</button>
      </div>

      {activeTab === 'operaciones' ? (
        <div className="animation-fade-in">
          
          <div style={{ display: 'flex', gap: '16px', marginBottom: '20px', alignItems: 'flex-end', backgroundColor: '#0d1117', padding: '20px', borderRadius: '8px', border: '1px solid #30363d' }}>
            <div style={{ flex: 1 }}>
              <label style={{ color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>UNIDAD</label>
              <select value={filtroUnidad} onChange={e => { setFiltroUnidad(e.target.value); setSeleccionadas([]); }} style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px' }}>
                <option value="">Seleccionar Unidad...</option>
                {unidadesOptions.map((name, i) => <option key={i} value={name}>{name}</option>)}
              </select>
            </div>
            <button 
              disabled={seleccionadas.length === 0 || filtroEstadoOps === 'cargadas'} 
              onClick={() => { setConsecutivoForm(generarConsecutivo(fechaForm)); setFotosSeleccionadas([]); setModalAbierto(true); }}
              style={{ padding: '10px 20px', backgroundColor: (seleccionadas.length > 0 && filtroEstadoOps !== 'cargadas') ? '#D84315' : '#30363d', color: '#fff', border: 'none', borderRadius: '6px', cursor: (seleccionadas.length > 0 && filtroEstadoOps !== 'cargadas') ? 'pointer' : 'not-allowed', fontWeight: 'bold', whiteSpace: 'nowrap' }}
            >
              Generar Referencia ({seleccionadas.length})
            </button>
          </div>

          {/* Filtros Pendientes / Cargadas + Seleccionar todo + Orden */}
          {filtroUnidad && (
            <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                <button onClick={() => { setFiltroEstadoOps('pendientes'); }}
                  style={{ padding: '8px 18px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.85rem',
                    border: `1px solid ${filtroEstadoOps === 'pendientes' ? '#ef4444' : '#30363d'}`,
                    backgroundColor: filtroEstadoOps === 'pendientes' ? 'rgba(239,68,68,0.15)' : 'transparent',
                    color: filtroEstadoOps === 'pendientes' ? '#ef4444' : '#8b949e' }}>
                  ● Pendientes ({conteoOps.pendientes})
                </button>
                <button onClick={() => { setFiltroEstadoOps('cargadas'); setSeleccionadas([]); }}
                  style={{ padding: '8px 18px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.85rem',
                    border: `1px solid ${filtroEstadoOps === 'cargadas' ? '#10b981' : '#30363d'}`,
                    backgroundColor: filtroEstadoOps === 'cargadas' ? 'rgba(16,185,129,0.15)' : 'transparent',
                    color: filtroEstadoOps === 'cargadas' ? '#10b981' : '#8b949e' }}>
                  ● Cargadas ({conteoOps.cargadas})
                </button>

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

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: '#8b949e', fontSize: '0.8rem' }}>Ordenar:</span>
                <select value={ordenOps.campo} onChange={(e) => setOrdenOps(prev => ({ ...prev, campo: e.target.value }))} style={selectOrdenStyle}>
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

            {/* Rango de fechas + Configurar columnas + Exportar Excel */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '16px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '12px 16px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', alignItems: 'flex-end' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ color: '#8b949e', fontSize: '0.72rem', fontWeight: 'bold' }}>FECHA DESDE</label>
                  <input type="date" value={fechaDesdeOps} onChange={(e) => setFechaDesdeOps(e.target.value)} style={dateInputStyle} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ color: '#8b949e', fontSize: '0.72rem', fontWeight: 'bold' }}>FECHA HASTA</label>
                  <input type="date" value={fechaHastaOps} onChange={(e) => setFechaHastaOps(e.target.value)} style={dateInputStyle} />
                </div>
                {(fechaDesdeOps || fechaHastaOps) && (
                  <button onClick={() => { setFechaDesdeOps(''); setFechaHastaOps(''); }} style={{ ...btnDirStyle, color: '#8b949e' }} title="Quitar filtro de fechas">
                    ✕ Limpiar fechas
                  </button>
                )}
                <span style={{ color: '#8b949e', fontSize: '0.8rem' }}>
                  {operacionesMostradas.length} {operacionesMostradas.length === 1 ? 'operación' : 'operaciones'}
                </span>
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button onClick={() => setModalColumnasOps(true)} style={btnDirStyle} title="Elegir y reordenar columnas">
                  ⚙ Configurar Columnas
                </button>
                <button onClick={exportarExcelOps} disabled={operacionesMostradas.length === 0}
                  style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', fontWeight: 'bold', fontSize: '0.85rem', whiteSpace: 'nowrap',
                    cursor: operacionesMostradas.length === 0 ? 'not-allowed' : 'pointer',
                    backgroundColor: operacionesMostradas.length === 0 ? '#30363d' : '#1a7f37',
                    color: operacionesMostradas.length === 0 ? '#8b949e' : '#fff' }}>
                  ⬇ Exportar Excel ({filtroEstadoOps === 'cargadas' ? 'Cargadas' : 'Pendientes'})
                </button>
              </div>
            </div>
            </>
          )}

          {seleccionadas.length > 0 && filtroEstadoOps === 'pendientes' && (
            <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '20px', marginBottom: '20px', animation: 'fadeIn 0.3s ease' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', marginBottom: '16px' }}>
                <div style={{ borderRight: '1px solid #30363d' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Operaciones Seleccionadas</span>
                  <span style={{ color: '#58a6ff', fontSize: '1.8rem', fontWeight: 'bold' }}>{seleccionadas.length}</span>
                </div>
                <div>
                  <span style={{ display: 'block', color: '#D84315', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Suma Combustible Total</span>
                  <span style={{ color: '#3fb950', fontSize: '1.8rem', fontWeight: 'bold' }}>{resumenSeleccion.dieselTotal.toFixed(2)}</span>
                </div>
              </div>
              <div style={{ borderTop: '1px dashed #30363d', paddingTop: '16px' }}>
                <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '8px' }}>Operaciones incluidas:</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {resumenSeleccion.refs.map((ref, i) => (
                    <span key={i} style={{ backgroundColor: '#161b22', border: '1px solid #30363d', color: '#c9d1d9', padding: '4px 10px', borderRadius: '12px', fontSize: '0.85rem', fontFamily: 'monospace' }}>{ref}</span>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 350px)', backgroundColor: '#161b22' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead style={{ backgroundColor: '#1f2937', color: '#8b949e', fontSize: '0.8rem', position: 'sticky', top: 0, zIndex: 10 }}>
                <tr>
                  <th style={{ padding: '16px', width: '50px', textAlign: 'center', borderBottom: '1px solid #30363d', backgroundColor: '#1f2937', whiteSpace: 'nowrap' }}>
                    {filtroUnidad && filtroEstadoOps === 'pendientes' && operacionesMostradas.length > 0 && (
                      <input
                        type="checkbox"
                        checked={todasSeleccionadas}
                        onChange={toggleSeleccionarTodas}
                        title="Seleccionar todo"
                        style={{ cursor: 'pointer', width: '16px', height: '16px' }}
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
                {!filtroUnidad ? (
                  <tr><td colSpan={colsOpsVisibles} style={{ padding: '40px', textAlign: 'center', color: '#8b949e' }}>Selecciona una Unidad en el filtro superior para buscar operaciones.</td></tr>
                ) : cargandoOps ? (
                  <tr><td colSpan={colsOpsVisibles} style={{ padding: '40px', textAlign: 'center', color: '#8b949e' }}>Cargando operaciones de la unidad...</td></tr>
                ) : operacionesMostradas.length === 0 ? (
                  <tr><td colSpan={colsOpsVisibles} style={{ padding: '40px', textAlign: 'center', color: '#8b949e' }}>
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
                        <td style={{ padding: '16px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                          {seleccionable ? (
                            <input type="checkbox" checked={seleccionadas.includes(op.id)} readOnly style={{ cursor: 'pointer', width: '16px', height: '16px' }} />
                          ) : (
                            <span title={op.referenciaDieselConsecutivo || 'Cargada'} style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#10b981' }} />
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
          
          <div style={{ position: 'relative', marginBottom: '20px', display: 'flex', justifyContent: 'space-between' }}>
            <input type="text" placeholder="Buscar en historial (Unidad, Ref, Status)..." value={busquedaRef} onChange={e => setBusquedaRef(e.target.value)} style={{ width: '100%', maxWidth: '400px', padding: '10px 16px', backgroundColor: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px' }} />
            <button title="Exportar a Excel" onClick={exportarCSV} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent', border: '1px solid #8b949e', color: '#c9d1d9', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </button>
          </div>

          {/* ✅ RESUMEN: separa lo AUTORIZADO de lo CARGADO (galones y $) */}
          {referenciasFiltradas.length > 0 && (
            <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '20px', marginBottom: '20px', animation: 'fadeIn 0.3s ease' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '16px' }}>
                <div style={{ borderRight: '1px solid #30363d' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.78rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Referencias Listadas</span>
                  <span style={{ color: '#58a6ff', fontSize: '1.8rem', fontWeight: 'bold' }}>{referenciasFiltradas.length}</span>
                </div>

                {/* AUTORIZADO */}
                <div style={{ borderRight: '1px solid #30363d' }}>
                  <span style={{ display: 'block', color: '#f59e0b', fontSize: '0.78rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Galones Autorizados</span>
                  <span style={{ color: '#f59e0b', fontSize: '1.6rem', fontWeight: 'bold' }}>{resumenHistorial.totalGalonesAutorizados.toFixed(2)}</span>
                </div>
                <div style={{ borderRight: '1px solid #30363d' }}>
                  <span style={{ display: 'block', color: '#f59e0b', fontSize: '0.78rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Total Autorizado</span>
                  <span style={{ color: '#f0f6fc', fontSize: '1.6rem', fontWeight: 'bold' }}>{formatoMoneda(resumenHistorial.granTotalAutorizado)}</span>
                </div>

                {/* CARGADO */}
                <div style={{ borderRight: '1px solid #30363d' }}>
                  <span style={{ display: 'block', color: '#10b981', fontSize: '0.78rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Galones Cargados</span>
                  <span style={{ color: '#10b981', fontSize: '1.6rem', fontWeight: 'bold' }}>{resumenHistorial.totalGalones.toFixed(2)}</span>
                </div>
                <div>
                  <span style={{ display: 'block', color: '#10b981', fontSize: '0.78rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Total Cargado</span>
                  <span style={{ color: '#3fb950', fontSize: '1.6rem', fontWeight: 'bold' }}>{formatoMoneda(resumenHistorial.granTotalCargado)}</span>
                </div>
              </div>
            </div>
          )}

          <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 350px)', backgroundColor: '#161b22' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead style={{ backgroundColor: '#1f2937', color: '#8b949e', fontSize: '0.8rem', position: 'sticky', top: 0, zIndex: 10 }}>
                <tr>
                  <th style={{ padding: '16px', textAlign: 'center', borderBottom: '1px solid #30363d', backgroundColor: '#1f2937', whiteSpace: 'nowrap' }}>ACCIONES</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', backgroundColor: '#1f2937', whiteSpace: 'nowrap' }}>CONSECUTIVO</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', backgroundColor: '#1f2937', whiteSpace: 'nowrap' }}>STATUS</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', backgroundColor: '#1f2937', whiteSpace: 'nowrap' }}>UNIDAD</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', backgroundColor: '#1f2937', whiteSpace: 'nowrap' }}>OPERADOR</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', backgroundColor: '#1f2937', whiteSpace: 'nowrap' }}>PROVEEDOR</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', backgroundColor: '#1f2937', whiteSpace: 'nowrap', color: '#f59e0b' }}>GAL. AUTORIZADOS</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', backgroundColor: '#1f2937', whiteSpace: 'nowrap', color: '#10b981' }}>GAL. CARGADOS</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', backgroundColor: '#1f2937', whiteSpace: 'nowrap', color: '#f59e0b' }}>TOTAL AUTORIZADO</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', backgroundColor: '#1f2937', whiteSpace: 'nowrap', color: '#10b981' }}>TOTAL CARGADO</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', backgroundColor: '#1f2937', whiteSpace: 'nowrap' }}>OBSERVACIONES</th>
                </tr>
              </thead>
              <tbody>
                {registrosVisibles.length === 0 ? (
                  <tr><td colSpan={11} style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>No hay referencias registradas.</td></tr>
                ) : (
                  registrosVisibles.map(r => (
                    <tr key={r.id} style={{ borderBottom: '1px solid #21262d' }}>
                      <td style={{ padding: '16px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                          <button 
                            title="Generar Instrucciones de Servicio (PDF)" 
                            onClick={(e) => handleGenerarInstrucciones(e, r)} 
                            style={{ background: 'transparent', border: '1px solid #10b981', borderRadius: '4px', color: '#10b981', cursor: 'pointer', padding: '6px', display: 'flex', transition: 'all 0.2s' }}
                            onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(16, 185, 129, 0.1)'}
                            onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><polyline points="9 15 12 18 15 15"></polyline></svg>
                          </button>

                          <button 
                            title="Editar/Ver Ficha" 
                            onClick={() => setReferenciaViendo(r)} 
                            style={{ background: 'transparent', border: '1px solid #3b82f6', borderRadius: '4px', color: '#3b82f6', cursor: 'pointer', padding: '6px', display: 'flex', transition: 'all 0.2s' }}
                            onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'}
                            onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                          </button>
                          
                          <button 
                            title="Eliminar Referencia" 
                            onClick={(e) => handleEliminarReferencia(e, r)} 
                            style={{ background: 'transparent', border: '1px solid #ef4444', borderRadius: '4px', color: '#ef4444', cursor: 'pointer', padding: '6px', display: 'flex', transition: 'all 0.2s' }}
                            onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'}
                            onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                          </button>
                        </div>
                      </td>
                      <td style={{ padding: '16px', color: '#D84315', fontWeight: 'bold', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{r.consecutivo}</td>
                      <td style={{ padding: '16px', whiteSpace: 'nowrap' }}>
                        <span style={{ 
                          padding: '4px 12px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 'bold', 
                          backgroundColor: r.status === 'No Autorizado' ? 'rgba(239, 68, 68, 0.1)' : r.status === 'Autorizado' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                          color: r.status === 'No Autorizado' ? '#ef4444' : r.status === 'Autorizado' ? '#f59e0b' : '#10b981',
                          border: `1px solid ${r.status === 'No Autorizado' ? '#ef4444' : r.status === 'Autorizado' ? '#f59e0b' : '#10b981'}`
                        }}>
                          {r.status || 'No Autorizado'}
                        </span>
                      </td>
                      <td style={{ padding: '16px', color: '#f0f6fc', whiteSpace: 'nowrap' }}>{getNombreUnidad(r.unidadNombre || r.unidadId || r.unidad)}</td>
                      <td style={{ padding: '16px', color: '#c9d1d9', whiteSpace: 'nowrap' }}>{getNombreOperador(r.operadorNombre || r.operadorId || r.operador)}</td>
                      <td style={{ padding: '16px', color: '#c9d1d9', whiteSpace: 'nowrap' }}>{getNombreProveedor(r.proveedorNombre || r.proveedorId || r.proveedor)}</td>
                      <td style={{ padding: '16px', color: '#f59e0b', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{Number(r.galonesAutorizados || 0).toFixed(2)} Gal.</td>
                      <td style={{ padding: '16px', color: '#10b981', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{Number(r.galonesCargados || 0).toFixed(2)} Gal.</td>
                      <td style={{ padding: '16px', color: '#f0f6fc', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{formatoMoneda(r.totalAutorizado)}</td>
                      <td style={{ padding: '16px', color: '#3fb950', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{formatoMoneda(r.totalCargado)}</td>
                      <td style={{ padding: '16px', color: '#c9d1d9', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>{r.observaciones || '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {totalPaginas > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', marginTop: '20px' }}>
              <button onClick={irPaginaAnterior} disabled={paginaActual === 1} style={{ padding: '8px 16px', cursor: paginaActual === 1 ? 'not-allowed' : 'pointer', background: 'none', border: 'none', color: '#c9d1d9' }}>Anterior</button>
              <span style={{ color: '#fff', alignSelf: 'center' }}>{paginaActual} / {totalPaginas}</span>
              <button onClick={irPaginaSiguiente} disabled={paginaActual === totalPaginas} style={{ padding: '8px 16px', cursor: (paginaActual === totalPaginas) ? 'not-allowed' : 'pointer', background: 'none', border: 'none', color: '#c9d1d9' }}>Siguiente</button>
            </div>
          )}
        </div>
      )}

      {/* ═══════════ MODAL CONFIGURAR COLUMNAS (Asignar Operaciones) ═══════════ */}
      {modalColumnasOps && (
        <div className="modal-overlay" style={{ zIndex: 2000, position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', backdropFilter: 'blur(4px)', backgroundColor: 'rgba(0,0,0,0.7)' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', width: '720px', maxWidth: '95%', padding: '24px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px', borderBottom: '1px solid #30363d', paddingBottom: '12px' }}>
              <h3 style={{ margin: 0, color: '#f0f6fc' }}>Configurar Columnas</h3>
              <button onClick={() => setModalColumnasOps(false)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>
            <p style={{ color: '#8b949e', fontSize: '0.85rem', marginBottom: '20px' }}>Arrastra para reordenar. Desmarca las que quieras ocultar de la tabla y del Excel.</p>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: '60vh', overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
              {columnasOps.map((col, idx) => (
                <li key={col.id} draggable onDragStart={(e) => handleDragStartOps(e, idx)} onDragEnter={() => handleDragEnterOps(idx)} onDragEnd={() => setDraggedColOpsIndex(null)} onDragOver={(e) => e.preventDefault()}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', backgroundColor: draggedColOpsIndex === idx ? '#1f2937' : '#161b22', border: '1px solid #30363d', borderRadius: '6px', cursor: 'grab' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                  <input type="checkbox" checked={col.visible} onChange={() => toggleColumnaVisibleOps(idx)} style={{ cursor: 'pointer', transform: 'scale(1.2)' }} />
                  <span style={{ color: col.visible ? '#c9d1d9' : '#484f58', fontSize: '0.85rem', fontWeight: col.visible ? 'bold' : 'normal' }}>{col.label}</span>
                </li>
              ))}
            </ul>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '24px', borderTop: '1px solid #30363d', paddingTop: '16px' }}>
              <button onClick={() => setModalColumnasOps(false)} style={{ backgroundColor: '#D84315', color: '#fff', border: 'none', padding: '10px 32px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Aplicar Cambios</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL FORMULARIO */}
      {modalAbierto && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px', backdropFilter: 'blur(4px)' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', width: '100%', maxWidth: '600px', padding: '24px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
              <h2 style={{ color: '#f0f6fc', margin: 0 }}>Nueva Referencia: <span style={{ color: '#D84315' }}>{consecutivoForm}</span></h2>
              <button onClick={() => setModalAbierto(false)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#010409', padding: '16px', borderRadius: '8px', border: '1px solid #30363d', marginBottom: '20px' }}>
              <div>
                <span style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '8px' }}>Status de la Referencia</span>
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
              <div style={{ textAlign: 'right' }}>
                <span style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Galones Calculados (Operaciones)</span>
                <span style={{ color: '#58a6ff', fontSize: '1.4rem', fontWeight: 'bold' }}>{galonesCalculadosOp.toFixed(2)} Gal.</span>
              </div>
            </div>
            
            <form onSubmit={handleGuardarReferencia}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
                <div>
                  <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>FECHA</label>
                  <input type="date" value={fechaForm} onChange={e => setFechaForm(e.target.value)} style={{ width: '100%', padding: '8px', backgroundColor: '#161b22', color: '#fff', border: '1px solid #30363d', borderRadius: '4px' }} />
                </div>
                <div>
                  <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>PROVEEDOR</label>
                  <SelectorProveedorBuscable
                    proveedores={proveedoresFiltrados}
                    value={proveedorSeleccionado}
                    onChange={setProveedorSeleccionado}
                    resolverNombre={getNombreProveedor}
                  />
                </div>
                <div>
                  <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>GALONES EXTRAS</label>
                  <input type="number" step="0.01" value={galonesExtras} onChange={e => setGalonesExtras(e.target.valueAsNumber || '')} style={{ width: '100%', padding: '8px', backgroundColor: '#161b22', color: '#fff', border: '1px solid #30363d', borderRadius: '4px' }} />
                </div>
                <div>
                  <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>GALONES CARGADOS</label>
                  <input type="number" step="0.01" value={galonesCargados} onChange={e => setGalonesCargados(e.target.valueAsNumber || '')} style={{ width: '100%', padding: '8px', backgroundColor: '#161b22', color: '#fff', border: '1px solid #30363d', borderRadius: '4px' }} />
                </div>

                <div style={{ gridColumn: 'span 2', backgroundColor: '#010409', border: '1px solid #30363d', borderRadius: '8px', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Galones Autorizados (no editable)</span>
                    <span style={{ color: '#8b949e', fontSize: '0.72rem' }}>
                      Operaciones ({galonesCalculadosOp.toFixed(2)}) + Extras ({(Number(galonesExtras) || 0).toFixed(2)})
                    </span>
                  </div>
                  <span style={{ color: '#58a6ff', fontSize: '1.4rem', fontWeight: 'bold' }}>{galonesAutorizadosCalc.toFixed(2)} Gal.</span>
                </div>
              </div>

              <div style={{ backgroundColor: '#161b22', padding: '16px', borderRadius: '8px', marginBottom: '20px' }}>
                 <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}><span style={{color: '#8b949e'}}>Costo Diesel ({fechaForm}):</span><span style={{color: '#fff', fontWeight: 'bold'}}>{formatoMoneda(costoDieselDiario)}</span></div>
                 <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}><span style={{color: '#8b949e'}}>Total Autorizado:</span><span style={{color: '#58a6ff', fontWeight: 'bold'}}>{formatoMoneda(galonesAutorizadosCalc * costoDieselDiario)}</span></div>
                 <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{color: '#8b949e'}}>Total Cargado:</span><span style={{color: '#3fb950', fontWeight: 'bold'}}>{formatoMoneda((Number(galonesCargados) || 0) * costoDieselDiario)}</span></div>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>OBSERVACIONES</label>
                <textarea value={observacionesForm} onChange={e => setObservacionesForm(e.target.value)} style={{ width: '100%', padding: '8px', backgroundColor: '#161b22', color: '#fff', border: '1px solid #30363d', borderRadius: '4px', height: '80px' }} />
              </div>

              {/* ✅ FOTOS DE LA REFERENCIA */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '8px' }}>
                  FOTOS <span style={{ color: '#484f58', fontWeight: 'normal' }}>(se guardan en {sanitizarSegmentoRuta(consecutivoForm)}/{sanitizarSegmentoRuta(filtroUnidad)}/)</span>
                </label>

                <input
                  ref={fotoInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleFotosInput}
                  style={{ display: 'none' }}
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
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={arrastrandoFoto ? '#D84315' : '#8b949e'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '8px' }}><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                  <div style={{ color: arrastrandoFoto ? '#D84315' : '#c9d1d9', fontSize: '0.9rem', fontWeight: 'bold' }}>
                    {arrastrandoFoto ? 'Suelta las fotos aquí' : 'Haz clic o arrastra fotos aquí'}
                  </div>
                  <div style={{ color: '#8b949e', fontSize: '0.75rem', marginTop: '4px' }}>Solo imágenes (JPG, PNG, etc.)</div>
                </div>

                {fotosSeleccionadas.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: '10px', marginTop: '12px' }}>
                    {previewsFotos.map((url, i) => (
                      <div key={i} style={{ position: 'relative', borderRadius: '6px', overflow: 'hidden', border: '1px solid #30363d', backgroundColor: '#010409' }}>
                        <img src={url} alt={fotosSeleccionadas[i]?.name || `foto-${i}`} style={{ width: '100%', height: '80px', objectFit: 'cover', display: 'block' }} />
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); quitarFoto(i); }}
                          title="Quitar foto"
                          style={{ position: 'absolute', top: '4px', right: '4px', width: '22px', height: '22px', borderRadius: '50%', border: 'none', backgroundColor: 'rgba(239,68,68,0.9)', color: '#fff', cursor: 'pointer', fontSize: '0.85rem', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        >✕</button>
                      </div>
                    ))}
                  </div>
                )}
                {fotosSeleccionadas.length > 0 && (
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', marginTop: '8px' }}>
                    {fotosSeleccionadas.length} {fotosSeleccionadas.length === 1 ? 'foto seleccionada' : 'fotos seleccionadas'}
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button type="button" onClick={() => setModalAbierto(false)} disabled={guardando} style={{ padding: '8px 24px', background: 'none', color: '#8b949e', border: '1px solid #30363d', borderRadius: '6px', cursor: 'pointer' }}>Cancelar</button>
                <button type="submit" disabled={guardando} style={{ padding: '8px 24px', backgroundColor: '#238636', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>{subiendoFotos ? 'Subiendo fotos...' : guardando ? 'Guardando...' : 'Guardar Referencia'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL FICHA REFERENCIA */}
      {referenciaViendo && (
        <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 1500, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px', backdropFilter: 'blur(4px)' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', width: '800px', maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #30363d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.4rem' }}>Ficha de Referencia Diesel</h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <button onClick={() => generarInstruccionesDieselPDF(construirDatosInstrucciones(referenciaViendo))} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', backgroundColor: '#10b981', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><polyline points="9 15 12 18 15 15"></polyline></svg>
                  Instrucciones
                </button>
                <button onClick={() => abrirEdicionRef(referenciaViendo)} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', backgroundColor: '#D84315', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                  Editar
                </button>
                <button onClick={() => setReferenciaViendo(null)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
              </div>
            </div>
            
            <div style={{ padding: '24px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px', marginBottom: '24px' }}>
                <div style={{ gridColumn: 'span 3', display: 'flex', justifyContent: 'space-between', backgroundColor: '#161b22', padding: '16px', borderRadius: '8px', border: '1px solid #30363d', alignItems: 'center' }}>
                  <div>
                    <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Consecutivo</span>
                    <span style={{ color: '#D84315', fontSize: '1.2rem', fontWeight: 'bold', fontFamily: 'monospace' }}>{referenciaViendo.consecutivo}</span>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Status</span>
                    <span style={{ 
                        padding: '4px 12px', borderRadius: '12px', fontSize: '0.85rem', fontWeight: 'bold', 
                        backgroundColor: referenciaViendo.status === 'No Autorizado' ? 'rgba(239, 68, 68, 0.1)' : referenciaViendo.status === 'Autorizado' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                        color: referenciaViendo.status === 'No Autorizado' ? '#ef4444' : referenciaViendo.status === 'Autorizado' ? '#f59e0b' : '#10b981',
                        border: `1px solid ${referenciaViendo.status === 'No Autorizado' ? '#ef4444' : referenciaViendo.status === 'Autorizado' ? '#f59e0b' : '#10b981'}`
                      }}>
                        {referenciaViendo.status || 'No Autorizado'}
                    </span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Fecha</span>
                    <span style={{ color: '#c9d1d9', fontSize: '1rem', fontWeight: 'bold' }}>{formatearFechaSpanish(referenciaViendo.fecha)}</span>
                  </div>
                </div>

                <div>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Unidad</span>
                  <span style={{ color: '#f0f6fc', fontSize: '1rem' }}>{getNombreUnidad(referenciaViendo.unidadNombre || referenciaViendo.unidadId || referenciaViendo.unidad)}</span>
                </div>
                <div>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Operador</span>
                  <span style={{ color: '#f0f6fc', fontSize: '1rem' }}>{getNombreOperador(referenciaViendo.operadorNombre || referenciaViendo.operadorId || referenciaViendo.operador)}</span>
                </div>
                <div>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Proveedor</span>
                  <span style={{ color: '#f0f6fc', fontSize: '1rem' }}>{getNombreProveedor(referenciaViendo.proveedorNombre || referenciaViendo.proveedorId || referenciaViendo.proveedor)}</span>
                </div>

                <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '0' }} /></div>

                <div>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Suma de Diesel</span>
                  <span style={{ color: '#f0f6fc', fontSize: '1rem' }}>{Number(referenciaViendo.sumaDiesel || 0).toFixed(2)}</span>
                </div>
                <div>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Costo Diario</span>
                  <span style={{ color: '#f0f6fc', fontSize: '1rem' }}>{formatoMoneda(referenciaViendo.costoDiesel)}</span>
                </div>
                <div>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Galones Extras</span>
                  <span style={{ color: '#f0f6fc', fontSize: '1rem' }}>{Number(referenciaViendo.galonesExtras || 0).toFixed(2)} Gal.</span>
                </div>

                <div style={{ backgroundColor: '#010409', padding: '16px', borderRadius: '8px', border: '1px dashed #30363d' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Galones Autorizados</span>
                  <span style={{ color: '#58a6ff', fontSize: '1.2rem', fontWeight: 'bold' }}>{Number(referenciaViendo.galonesAutorizados || 0).toFixed(2)}</span>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.72rem', marginTop: '2px' }}>Operaciones + Extras</span>
                  <span style={{ display: 'block', color: '#c9d1d9', fontSize: '0.85rem', marginTop: '4px' }}>Total: {formatoMoneda(referenciaViendo.totalAutorizado)}</span>
                </div>
                
                <div style={{ backgroundColor: '#010409', padding: '16px', borderRadius: '8px', border: '1px dashed #30363d' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Galones Cargados</span>
                  <span style={{ color: '#3fb950', fontSize: '1.2rem', fontWeight: 'bold' }}>{Number(referenciaViendo.galonesCargados).toFixed(2)}</span>
                  <span style={{ display: 'block', color: '#c9d1d9', fontSize: '0.85rem', marginTop: '4px' }}>Total: {formatoMoneda(referenciaViendo.totalCargado)}</span>
                </div>
                <div></div>

                <div style={{ gridColumn: 'span 3' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Observaciones</span>
                  <div style={{ color: '#c9d1d9', backgroundColor: '#161b22', padding: '12px', borderRadius: '6px', border: '1px solid #30363d', minHeight: '60px' }}>
                    {referenciaViendo.observaciones || '-'}
                  </div>
                </div>

                {/* ✅ FOTOS DE LA REFERENCIA */}
                {Array.isArray(referenciaViendo.fotos) && referenciaViendo.fotos.length > 0 && (
                  <div style={{ gridColumn: 'span 3' }}>
                    <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '12px' }}>
                      Fotos ({referenciaViendo.fotos.length})
                    </span>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '10px' }}>
                      {referenciaViendo.fotos.map((foto: any, i: number) => (
                        <a
                          key={i}
                          href={foto.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={foto.nombre || `Foto ${i + 1}`}
                          style={{ display: 'block', borderRadius: '6px', overflow: 'hidden', border: '1px solid #30363d', backgroundColor: '#010409' }}
                        >
                          <img src={foto.url} alt={foto.nombre || `foto-${i}`} style={{ width: '100%', height: '100px', objectFit: 'cover', display: 'block' }} />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ gridColumn: 'span 3' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '12px' }}>Operaciones Incluidas en esta Referencia</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
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
                          {match && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>}
                        </span>
                      );
                    })}
                  </div>
                </div>

              </div>
            </div>
            
            <div style={{ padding: '16px 24px', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #30363d', backgroundColor: '#161b22' }}>
              <button onClick={() => setReferenciaViendo(null)} className="btn btn-outline" style={{ padding: '8px 24px', borderRadius: '6px', color: '#c9d1d9', border: '1px solid #30363d', background: 'transparent', cursor: 'pointer' }}>Cerrar Ficha</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: EDITAR REFERENCIA (datos del registro) */}
      {editandoRef && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 2600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', backdropFilter: 'blur(6px)' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #D84315', borderRadius: '12px', width: '100%', maxWidth: '600px', padding: '24px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.7)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px', alignItems: 'center' }}>
              <h2 style={{ color: '#f0f6fc', margin: 0, fontSize: '1.2rem' }}>Editar Referencia: <span style={{ color: '#D84315', fontFamily: 'monospace' }}>{editandoRef.consecutivo}</span></h2>
              <button onClick={() => setEditandoRef(null)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>

            <form onSubmit={handleGuardarEdicionRef}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>

                {/* ✅ NÚMERO DE REFERENCIA EDITABLE (debe ser único) */}
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ color: '#D84315', fontSize: '0.75rem', display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>NÚMERO DE REFERENCIA (CONSECUTIVO)</label>
                  <input
                    type="text"
                    value={formEditRef.consecutivo}
                    onChange={e => setFormEditRef({ ...formEditRef, consecutivo: e.target.value })}
                    placeholder="Ej: DIESEL-260626-001"
                    style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', color: '#fff', border: '1px solid #D84315', borderRadius: '6px', fontFamily: 'monospace', fontWeight: 'bold', boxSizing: 'border-box' }}
                  />
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.72rem', marginTop: '4px' }}>Debe ser único. Si lo cambias, se actualizará también en las operaciones ligadas.</span>
                </div>

                <div>
                  <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>FECHA</label>
                  <input type="date" value={formEditRef.fecha} onChange={e => setFormEditRef({ ...formEditRef, fecha: e.target.value })} style={{ width: '100%', padding: '8px', backgroundColor: '#161b22', color: '#fff', border: '1px solid #30363d', borderRadius: '4px', colorScheme: 'dark' }} />
                </div>
                <div>
                  <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>PROVEEDOR</label>
                  <SelectorProveedorBuscable
                    proveedores={proveedoresFiltrados}
                    value={formEditRef.proveedorId}
                    onChange={(id) => setFormEditRef({ ...formEditRef, proveedorId: id })}
                    resolverNombre={getNombreProveedor}
                  />
                </div>
                <div>
                  <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>OPERADOR</label>
                  <select value={formEditRef.operadorId} onChange={e => setFormEditRef({ ...formEditRef, operadorId: e.target.value })} style={{ width: '100%', padding: '8px', backgroundColor: '#161b22', color: '#fff', border: '1px solid #30363d', borderRadius: '4px' }}>
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
                  <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>GALONES EXTRAS</label>
                  <input type="number" step="0.01" value={formEditRef.galonesExtras} onChange={e => setFormEditRef({ ...formEditRef, galonesExtras: e.target.valueAsNumber || '' })} style={{ width: '100%', padding: '8px', backgroundColor: '#161b22', color: '#fff', border: '1px solid #30363d', borderRadius: '4px' }} />
                </div>
                <div>
                  <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>GALONES CARGADOS</label>
                  <input type="number" step="0.01" value={formEditRef.galonesCargados} onChange={e => setFormEditRef({ ...formEditRef, galonesCargados: e.target.valueAsNumber || '' })} style={{ width: '100%', padding: '8px', backgroundColor: '#161b22', color: '#fff', border: '1px solid #30363d', borderRadius: '4px' }} />
                </div>
                <div>
                  <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>COSTO DIARIO DIESEL</label>
                  <input type="number" step="0.01" value={formEditRef.costoDiesel} onChange={e => setFormEditRef({ ...formEditRef, costoDiesel: e.target.valueAsNumber || '' })} style={{ width: '100%', padding: '8px', backgroundColor: '#161b22', color: '#fff', border: '1px solid #30363d', borderRadius: '4px' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                  <span style={{ color: '#8b949e', fontSize: '0.72rem', marginBottom: '4px' }}>Galones Autorizados (automático)</span>
                  <span style={{ color: '#58a6ff', fontSize: '1.15rem', fontWeight: 'bold' }}>
                    {(Number(editandoRef.sumaDiesel || 0) + (Number(formEditRef.galonesExtras) || 0)).toFixed(2)} Gal.
                  </span>
                </div>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>OBSERVACIONES</label>
                <textarea value={formEditRef.observaciones} onChange={e => setFormEditRef({ ...formEditRef, observaciones: e.target.value })} style={{ width: '100%', padding: '8px', backgroundColor: '#161b22', color: '#fff', border: '1px solid #30363d', borderRadius: '4px', height: '70px' }} />
              </div>

              <div style={{ backgroundColor: '#161b22', padding: '12px 16px', borderRadius: '8px', marginBottom: '20px', fontSize: '0.85rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#8b949e' }}>Suma de Diesel (operaciones, no editable):</span>
                  <span style={{ color: '#fff', fontWeight: 'bold' }}>{Number(editandoRef.sumaDiesel || 0).toFixed(2)}</span>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button type="button" onClick={() => setEditandoRef(null)} disabled={guardandoEdicionRef} style={{ padding: '8px 24px', background: 'none', color: '#8b949e', border: '1px solid #30363d', borderRadius: '6px', cursor: 'pointer' }}>Cancelar</button>
                <button type="submit" disabled={guardandoEdicionRef} style={{ padding: '8px 24px', backgroundColor: '#D84315', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>{guardandoEdicionRef ? 'Guardando...' : 'Guardar Cambios'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: EDICIÓN RÁPIDA DE OPERACIÓN */}
      {operacionAEditar && (
        <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 3000, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px', backdropFilter: 'blur(8px)' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #58a6ff', borderRadius: '12px', width: '100%', maxWidth: '450px', padding: '24px', boxShadow: '0 10px 40px rgba(0,0,0,0.7)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
              <h2 style={{ color: '#f0f6fc', margin: 0, fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" strokeWidth="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                Edición de Operación
              </h2>
              <button onClick={() => setOperacionAEditar(null)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>

            <div style={{ backgroundColor: '#161b22', padding: '16px', borderRadius: '8px', border: '1px solid #30363d', marginBottom: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold' }}>REF. OPERACIÓN</span>
                <span style={{ color: '#58a6ff', fontWeight: 'bold', fontFamily: 'monospace' }}>{operacionAEditar.ref || operacionAEditar.id.substring(0,6)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold' }}>ORIGEN</span>
                <span style={{ color: '#c9d1d9' }}>{getNombreLugar(operacionAEditar.origen)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold' }}>DESTINO</span>
                <span style={{ color: '#c9d1d9' }}>{getNombreLugar(operacionAEditar.destino)}</span>
              </div>
            </div>

            <form onSubmit={handleActualizarOperacion}>
              <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', color: '#c9d1d9', fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '8px' }}>
                  Combustible Total (Diesel Op.)
                </label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#8b949e', fontWeight: 'bold' }}>#</span>
                  <input 
                    type="number" 
                    step="0.01" 
                    value={editCombustibleOp} 
                    onChange={e => setEditCombustibleOp(e.target.valueAsNumber || '')} 
                    required 
                    style={{ width: '100%', padding: '12px 12px 12px 30px', backgroundColor: '#010409', border: '1px solid #58a6ff', borderRadius: '6px', color: '#58a6ff', fontSize: '1.2rem', fontWeight: 'bold', boxSizing: 'border-box' }} 
                  />
                </div>
                <span style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', marginTop: '8px' }}>
                  * Al guardar, se recalculará automáticamente la Suma de Diesel y los Galones Autorizados en la Referencia Maestra.
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button type="button" onClick={() => setOperacionAEditar(null)} disabled={guardandoEdicionOp} style={{ padding: '10px 20px', background: 'none', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: 'pointer' }}>Cancelar</button>
                <button type="submit" disabled={guardandoEdicionOp} style={{ padding: '10px 20px', backgroundColor: '#58a6ff', color: '#000', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>
                  {guardandoEdicionOp ? 'Guardando...' : 'Actualizar Diesel'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};