import { useState, useRef, useCallback, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { db } from '../../../config/firebase';
import { collection, doc, writeBatch, getDocs, query, limit, getDoc, setDoc, arrayUnion } from 'firebase/firestore';

// ── Paleta Roelca (GitHub dark + acento naranja) ──────────────────────────
const C = {
  bg: '#0d1117',          // base de tarjetas / inputs
  panel: '#161b22',       // tarjeta elevada
  border: '#30363d',
  borderSoft: '#21262d',
  text: '#e6edf3',
  textMuted: '#8b949e',
  textFaint: '#6e7681',
  accent: '#D84315',      // naranja de marca
  accentHover: '#bf360c',
  accentSoft: 'rgba(216,67,21,0.14)',
  accentBorder: 'rgba(216,67,21,0.45)',
  green: '#3fb950',
  greenSoft: 'rgba(63,185,80,0.12)',
  greenBorder: 'rgba(63,185,80,0.40)',
  blue: '#58a6ff',
  blueSoft: 'rgba(88,166,255,0.12)',
  blueBorder: 'rgba(88,166,255,0.40)',
  amber: '#d29922',
  amberText: '#e3b341',
  amberSoft: 'rgba(210,153,34,0.10)',
  amberBorder: 'rgba(210,153,34,0.35)',
  red: '#f85149',
  redText: '#ff7b72',
  redSoft: 'rgba(248,81,73,0.10)',
  redBorder: 'rgba(248,81,73,0.35)',
};

// ── Iconos SVG de línea (mismo estilo que el sidebar de Roelca) ───────────
type IconProps = { size?: number; color?: string; strokeWidth?: number; style?: React.CSSProperties; className?: string };
const mkIcon = (paths: React.ReactNode) =>
  ({ size = 16, color = 'currentColor', strokeWidth = 2, style, className }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, ...style }} className={className}>
      {paths}
    </svg>
  );

const Upload = mkIcon(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></>);
const Download = mkIcon(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></>);
const ArrowRight = mkIcon(<><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></>);
const AlertCircle = mkIcon(<><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></>);
const CheckCircle = mkIcon(<><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></>);
const Database = mkIcon(<><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></>);
const Loader2 = mkIcon(<><line x1="12" y1="2" x2="12" y2="6" /><line x1="12" y1="18" x2="12" y2="22" /><line x1="4.93" y1="4.93" x2="7.76" y2="7.76" /><line x1="16.24" y1="16.24" x2="19.07" y2="19.07" /><line x1="2" y1="12" x2="6" y2="12" /><line x1="18" y1="12" x2="22" y2="12" /><line x1="4.93" y1="19.07" x2="7.76" y2="16.24" /><line x1="16.24" y1="7.76" x2="19.07" y2="4.93" /></>);
const RotateCcw = mkIcon(<><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></>);
const FileSpreadsheet = mkIcon(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="16" y2="17" /><line x1="12" y1="13" x2="12" y2="21" /></>);
const ChevronDown = mkIcon(<polyline points="6 9 12 15 18 9" />);

type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'array' | 'skip';

type CollectionDef = {
  id: string;
  name: string;
  description: string;
  fields: { name: string; type: FieldType; label?: string }[];
};

// ⚠️ Colecciones de Roelca (ajusta los CAMPOS a tu esquema real si hace falta;
// en el paso de mapeo puedes asignar cualquier columna del CSV a cualquier campo).
const AVAILABLE_COLLECTIONS: CollectionDef[] = [
  {
    id: 'operaciones', name: 'Operaciones', description: 'Servicios / operaciones de transporte',
    fields: [
      { name: 'numReferencia', type: 'string', label: 'Referencia' },
      { name: 'fechaServicio', type: 'date', label: 'Fecha de servicio' },
      { name: 'clienteNombre', type: 'string', label: 'Cliente' },
      { name: 'proveedorNombre', type: 'string', label: 'Proveedor' },
      { name: 'origen', type: 'string' },
      { name: 'destino', type: 'string' },
      { name: 'unidadNombre', type: 'string', label: 'Unidad' },
      { name: 'remolquePlaca', type: 'string', label: 'Remolque / placas' },
      { name: 'descripcionServicio', type: 'string', label: 'Descripción' },
      { name: 'subtotal', type: 'number' },
      { name: 'createdAt', type: 'date' }
    ]
  },
  {
    id: 'empresas', name: 'Empresas (Clientes / Proveedores)', description: 'Catálogo de empresas',
    fields: [
      { name: 'nombre', type: 'string', label: 'Nombre' },
      { name: 'rfc', type: 'string' },
      { name: 'direccion', type: 'string' },
      { name: 'numExtInt', type: 'string', label: 'Núm. Ext/Int' },
      { name: 'colonia', type: 'string' },
      { name: 'ciudad', type: 'string' },
      { name: 'diasCredito', type: 'number', label: 'Días de crédito' },
      { name: 'tipo', type: 'string', label: 'Tipo (Cliente/Proveedor)' }
    ]
  },
  {
    id: 'facturas_clientes', name: 'Facturas · Clientes', description: 'Facturación a clientes (por cobrar)',
    fields: [
      { name: 'invoice', type: 'string', label: 'Folio' },
      { name: 'fecha', type: 'date' },
      { name: 'clienteNombre', type: 'string', label: 'Cliente' },
      { name: 'moneda', type: 'string' },
      { name: 'subtotalFactura', type: 'number', label: 'Subtotal' }
    ]
  },
  {
    id: 'facturas_proveedores', name: 'Facturas · Proveedores', description: 'Facturación de proveedores (por pagar)',
    fields: [
      { name: 'invoice', type: 'string', label: 'Folio' },
      { name: 'fecha', type: 'date' },
      { name: 'proveedorNombre', type: 'string', label: 'Proveedor' },
      { name: 'monedaProveedor', type: 'string', label: 'Moneda' },
      { name: 'subtotalFactura', type: 'number', label: 'Subtotal' }
    ]
  }
];

// ⚠️ IMPORTANTE: el SDK web de Firestore NO puede listar las colecciones de un
// proyecto (eso solo lo hace el Admin SDK del backend). Por eso el desplegable de
// la plantilla arma su lista combinando TRES fuentes:
//   1) AVAILABLE_COLLECTIONS (las 4 con nombre "bonito"),
//   2) COLECCIONES_CONOCIDAS de aquí abajo (edítala para agregar/quitar a mano),
//   3) el documento Firestore `config_import/config`, campo `colecciones` (array de
//      strings) — puedes agregar nombres AHÍ sin volver a desplegar la app. El
//      botón "Agregar a la lista" de la UI escribe justo en ese documento.
// Además, siempre puedes elegir "Otra colección…" y escribir cualquier nombre.
const COLECCIONES_CONOCIDAS: string[] = [
  'operaciones',
  'empresas',
  'facturas_clientes',
  'facturas_proveedores',
  // 👇 Agrega aquí el resto de tus colecciones (una por línea), por ejemplo:
  // 'contactos', 'direcciones', 'unidades', 'remolques', 'proveedoresUnidad',
  // 'unidadesProveedor', 'conveniosClientes', 'conveniosProveedores', 'tiposEmpresa',
  // 'monedas', 'combustible', 'empleados', 'deducciones', 'nominas', 'diesel',
  // 'puentes', 'mtto', 'usuarios', 'roles',
];

// Documento donde se guarda la lista de colecciones editable sin redeploy.
const CONFIG_IMPORT_DOC = { col: 'config_import', id: 'config' };

type Step = 'upload' | 'mapping' | 'preview' | 'importing' | 'done';

interface FieldMapping {
  firestoreField: string;
  type: FieldType;
}

interface ImportProgress {
  current: number;
  total: number;
  errors: { row: number; message: string }[];
  successCount: number;
}

interface DataImportViewProps {
  onOpenMenu: () => void;
}

export default function DataImportView({ onOpenMenu }: DataImportViewProps) {
  const [step, setStep] = useState<Step>('upload');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvData, setCsvData] = useState<any[]>([]);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<string>('');
  const [fieldMappings, setFieldMappings] = useState<Record<string, FieldMapping>>({});
  const [useExistingId, setUseExistingId] = useState(false);
  const [idColumn, setIdColumn] = useState('');
  const [importProgress, setImportProgress] = useState<ImportProgress>({
    current: 0,
    total: 0,
    errors: [],
    successCount: 0
  });
  const [isDragging, setIsDragging] = useState(false);
  // ⭐ Búsqueda + filtro por estado (agiliza CSV con muchas columnas)
  const [columnSearch, setColumnSearch] = useState('');
  const [mappingFilter, setMappingFilter] = useState<'all' | 'matched' | 'custom' | 'skipped'>('all');

  // ⭐ Colección elegida SOLO para descargar la plantilla Excel (independiente de
  //    la colección destino de importación). '__other__' habilita el campo libre.
  const [exportCollection, setExportCollection] = useState<string>('');
  const [otherCollection, setOtherCollection] = useState('');   // nombre libre de colección
  const [templateBusy, setTemplateBusy] = useState(false);      // leyendo esquema de Firestore
  const [coleccionesExtra, setColeccionesExtra] = useState<string[]>([]); // desde config_import/config
  const [savingList, setSavingList] = useState(false);          // guardando nombre en la lista

  // ⭐ Carga la lista de colecciones guardada en Firestore (config_import/config).
  //    Así el desplegable puede crecer sin volver a desplegar la app.
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, CONFIG_IMPORT_DOC.col, CONFIG_IMPORT_DOC.id));
        const arr = (snap.exists() && Array.isArray((snap.data() as any)?.colecciones))
          ? ((snap.data() as any).colecciones as any[]).map(String)
          : [];
        setColeccionesExtra(arr);
      } catch {
        /* silencioso: si no hay doc o no hay permisos, se usa solo la lista fija */
      }
    })();
  }, []);

  // ⭐ Lista final del desplegable = fijas + conocidas + guardadas en Firestore.
  const nombresColecciones = Array.from(new Set([
    ...AVAILABLE_COLLECTIONS.map(c => c.id),
    ...COLECCIONES_CONOCIDAS,
    ...coleccionesExtra,
  ])).filter(Boolean).sort((a, b) => a.localeCompare(b));

  // Etiqueta amigable si la colección es una de las "conocidas con descripción".
  const labelColeccion = (id: string): string => {
    const c = AVAILABLE_COLLECTIONS.find(x => x.id === id);
    return c ? `${c.name} (${c.description})` : id;
  };

  // ⭐ Guarda un nombre de colección en config_import/config para que aparezca
  //    siempre en el desplegable (para todos los usuarios), sin redeploy.
  const agregarAListaColeccion = async () => {
    const name = otherCollection.trim();
    if (!name) { alert('Escribe el nombre de la colección primero.'); return; }
    setSavingList(true);
    try {
      await setDoc(
        doc(db, CONFIG_IMPORT_DOC.col, CONFIG_IMPORT_DOC.id),
        { colecciones: arrayUnion(name) },
        { merge: true }
      );
      setColeccionesExtra(prev => Array.from(new Set([...prev, name])));
      setExportCollection(name);   // seleccionarla de una vez
      setOtherCollection('');
    } catch (err: any) {
      alert(`No se pudo guardar en la lista: ${err?.message || err}`);
    } finally {
      setSavingList(false);
    }
  };

  const getExportDef = (): CollectionDef | undefined =>
    AVAILABLE_COLLECTIONS.find(c => c.id === exportCollection);

  // ⭐ ID real de la colección a exportar (el elegido, o el escrito a mano).
  const exportCollectionId = (): string =>
    (exportCollection === '__other__' ? otherCollection.trim() : exportCollection).trim();

  // ⭐ Texto de ayuda por tipo de campo (fila 2 de la plantilla)
  const TYPE_EXAMPLE: Record<FieldType, string> = {
    string: '[texto]',
    number: '[número]',
    boolean: '[VERDADERO/FALSO]',
    date: '[YYYY-MM-DD]',
    array: '[valor1, valor2]',
    skip: '[texto]',
  };

  // ⭐ Infiere el tipo de un campo a partir de valores reales muestreados.
  const inferTypeFromValues = (values: any[]): FieldType => {
    const s = values.filter(v => v !== null && v !== '' && v !== undefined);
    if (s.length === 0) return 'string';
    if (s.some(v => Array.isArray(v))) return 'array';
    if (s.every(v => typeof v === 'boolean')) return 'boolean';
    if (s.every(v => typeof v === 'number' || (!isNaN(Number(v)) && String(v).trim() !== ''))) return 'number';
    if (s.every(v => {
      const str = String(v).trim();
      if (!/[-/]/.test(str)) return false;
      return !isNaN(Date.parse(str));
    })) return 'date';
    return 'string';
  };

  // ⭐ Genera y descarga una plantilla .xlsx para la colección elegida.
  //    A diferencia de antes, NO usa una lista fija de campos: lee una MUESTRA de
  //    documentos reales de Firestore y arma la plantilla con TODOS los campos que
  //    existen de verdad en esa colección (unión de llaves de todos los documentos
  //    muestreados). Así la plantilla siempre refleja el esquema real.
  const handleDownloadTemplate = async () => {
    const colId = exportCollectionId();
    if (!colId) {
      alert('Selecciona (o escribe) una colección para descargar su plantilla.');
      return;
    }

    const def = getExportDef(); // puede ser undefined si es colección libre
    const displayName = def?.name || colId;

    setTemplateBusy(true);
    try {
      // 1) Muestra de documentos reales para descubrir el esquema completo.
      const MUESTRA = 400;
      const snap = await getDocs(query(collection(db, colId), limit(MUESTRA)));

      // 2) Unión de todas las llaves + valores de muestra por campo (para tipos).
      const valoresPorCampo: Record<string, any[]> = {};
      snap.forEach(d => {
        const data = d.data() as any;
        Object.keys(data).forEach(k => {
          if (!valoresPorCampo[k]) valoresPorCampo[k] = [];
          if (valoresPorCampo[k].length < 5) valoresPorCampo[k].push(data[k]);
        });
      });
      const camposReales = Object.keys(valoresPorCampo);

      // 3) Orden de columnas: primero los campos "conocidos" del schema (en su
      //    orden declarado, si existen en los datos reales), luego el resto
      //    descubierto, alfabético. Si no hay def, todo alfabético.
      const declarados = def ? def.fields.map(f => f.name) : [];
      const declaradosPresentes = declarados.filter(n => camposReales.includes(n));
      const extra = camposReales.filter(n => !declarados.includes(n)).sort((a, b) => a.localeCompare(b));
      // Si la colección estaba vacía, cae al schema declarado (o solo 'id').
      const ordenCampos = camposReales.length > 0
        ? [...declaradosPresentes, ...extra]
        : declarados;

      if (ordenCampos.length === 0) {
        alert(`La colección "${colId}" no devolvió documentos y no hay un esquema conocido para ella, así que no se pudieron determinar los campos.\n\nRevisa que el nombre de la colección sea correcto y que tengas permisos de lectura.`);
        setTemplateBusy(false);
        return;
      }

      // 4) Tipo por campo: usa el tipo declarado si existe; si no, lo infiere de
      //    los valores reales muestreados.
      const tipoDe = (campo: string): FieldType => {
        const d = def?.fields.find(f => f.name === campo);
        if (d) return d.type;
        return inferTypeFromValues(valoresPorCampo[campo] || []);
      };

      // 5) La primera columna es 'id' (ID del documento en Firestore).
      const headers = ['id', ...ordenCampos];
      const exampleRow = ['[ID del documento en Firestore]', ...ordenCampos.map(c => TYPE_EXAMPLE[tipoDe(c)] || '[texto]')];

      const worksheet = XLSX.utils.aoa_to_sheet([headers, exampleRow]);
      worksheet['!cols'] = headers.map(h => ({ wch: Math.max(14, h.length + 4) }));

      const workbook = XLSX.utils.book_new();
      const safeSheetName = (displayName.replace(/[:\\/?*[\]]/g, ' ').trim().substring(0, 31)) || 'Plantilla';
      XLSX.utils.book_append_sheet(workbook, worksheet, safeSheetName);

      XLSX.writeFile(workbook, `plantilla_${colId}.xlsx`);

      if (camposReales.length === 0) {
        alert(`Nota: la colección "${colId}" no tenía documentos, así que la plantilla se generó con el esquema conocido (${ordenCampos.length} campos).`);
      }
    } catch (err: any) {
      alert(`No se pudo leer la colección "${colId}" desde Firestore.\n\n${err?.message || err}\n\nVerifica el nombre de la colección y tus permisos de lectura.`);
    } finally {
      setTemplateBusy(false);
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  const getCollectionDef = (): CollectionDef | undefined => {
    return AVAILABLE_COLLECTIONS.find(c => c.id === selectedCollection);
  };

  const findBestFieldMatch = (csvHeader: string, fields: CollectionDef['fields']): string | null => {
    const norm = (str: string) => str.toLowerCase().replace(/[\s_-]+/g, '');
    const target = norm(csvHeader);
    const exact = fields.find(f => norm(f.name) === target || (f.label && norm(f.label) === target));
    return exact ? exact.name : null;
  };

  const handleSelectCollection = (collectionId: string) => {
    setSelectedCollection(collectionId);
    const def = AVAILABLE_COLLECTIONS.find(c => c.id === collectionId);
    if (!def || csvHeaders.length === 0) return;

    setFieldMappings(prev => {
      const next: Record<string, FieldMapping> = { ...prev };
      csvHeaders.forEach(h => {
        const match = findBestFieldMatch(h, def.fields);
        if (match) {
          const fieldDef = def.fields.find(f => f.name === match)!;
          next[h] = { firestoreField: match, type: fieldDef.type };
        } else if (!prev[h] || !prev[h].firestoreField) {
          next[h] = { firestoreField: toCamelCase(h), type: detectType(csvData, h) };
        }
      });
      return next;
    });
  };

  // ⭐ Clasifica cada columna del CSV según su mapeo:
  //    matched  = va a un campo que YA EXISTE en la colección (verde)
  //    custom   = crea un campo nuevo que no está en el schema (azul)
  //    skipped  = no se importa (gris)
  const classifyHeader = (header: string): 'matched' | 'custom' | 'skipped' => {
    const m = fieldMappings[header];
    if (!m || m.type === 'skip' || !m.firestoreField) return 'skipped';
    const known = (getCollectionDef()?.fields || []).some(f => f.name === m.firestoreField);
    return known ? 'matched' : 'custom';
  };

  // ⭐ Acciones masivas para no tocar columna por columna
  const reAutoMap = () => { if (selectedCollection) handleSelectCollection(selectedCollection); };

  const bulkSkipCustom = () => {
    setFieldMappings(prev => {
      const next = { ...prev };
      csvHeaders.forEach(h => {
        if (classifyHeader(h) === 'custom') next[h] = { ...next[h], type: 'skip' };
      });
      return next;
    });
  };

  const bulkImportSkipped = () => {
    setFieldMappings(prev => {
      const next = { ...prev };
      csvHeaders.forEach(h => {
        const m = next[h];
        if (!m || m.type === 'skip') {
          next[h] = { firestoreField: (m && m.firestoreField) || toCamelCase(h), type: detectType(csvData, h) };
        }
      });
      return next;
    });
  };

  // ─────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────

  const toCamelCase = (str: string): string => {
    return str
      .trim()
      .toLowerCase()
      .replace(/[^a-zA-Z0-9]+(.)/g, (_, c) => c.toUpperCase())
      .replace(/^[A-Z]/, (m) => m.toLowerCase());
  };

  const detectType = (data: any[], column: string): FieldType => {
    const samples = data.slice(0, 5).map(r => r[column]).filter(v => v !== null && v !== '' && v !== undefined);
    if (samples.length === 0) return 'string';

    if (samples.every(v => !isNaN(Number(v)) && String(v).trim() !== '')) return 'number';
    if (samples.every(v => ['true', 'false', 'yes', 'no', '1', '0'].includes(String(v).toLowerCase().trim()))) return 'boolean';

    if (samples.every(v => {
      const str = String(v).trim();
      if (!/[-/]/.test(str)) return false;
      return !isNaN(Date.parse(str));
    })) return 'date';

    return 'string';
  };

  const transformValue = (value: any, type: FieldType): any => {
    if (value === null || value === undefined || value === '') {
      if (type === 'number') return 0;
      if (type === 'boolean') return false;
      if (type === 'array') return [];
      return '';
    }

    const str = String(value).trim();

    switch (type) {
      case 'number':
        const num = Number(str.replace(/,/g, ''));
        return isNaN(num) ? 0 : num;
      case 'boolean':
        return ['true', 'yes', '1', 'sí', 'si'].includes(str.toLowerCase());
      case 'date':
        const date = new Date(str);
        if (isNaN(date.getTime())) return str;
        return date.toISOString().split('T')[0];
      case 'array':
        return str.split(',').map(s => s.trim()).filter(s => s.length > 0);
      default:
        return str;
    }
  };

  const transformRow = (row: any): any => {
    const transformed: any = {};
    Object.entries(fieldMappings).forEach(([csvHeader, mapping]) => {
      if (mapping.type === 'skip' || !mapping.firestoreField) return;
      transformed[mapping.firestoreField] = transformValue(row[csvHeader], mapping.type);
    });
    return transformed;
  };

  // ─────────────────────────────────────────────────────────────
  // HANDLERS
  // ─────────────────────────────────────────────────────────────

  const handleFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      alert('Por favor selecciona un archivo CSV.');
      return;
    }

    setCsvFile(file);

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = String(ev.target?.result || '');
        const wb = XLSX.read(text, { type: 'string' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<any>(ws, { defval: '', raw: false });
        if (!rows.length) { alert('El CSV está vacío o no tiene filas válidas.'); return; }
        // Normaliza encabezados (trim) en cada fila.
        const data = rows.map((r: any) => {
          const o: any = {};
          Object.keys(r).forEach(k => { o[k.trim()] = r[k]; });
          return o;
        });
        const headers = Object.keys(data[0]).filter(h => h.trim() !== '');
        setCsvData(data);
        setCsvHeaders(headers);
        setColumnSearch('');
        setMappingFilter('all');
        const initialMappings: Record<string, FieldMapping> = {};
        headers.forEach(h => {
          initialMappings[h] = { firestoreField: toCamelCase(h), type: detectType(data, h) };
        });
        setFieldMappings(initialMappings);
        setStep('mapping');
      } catch (err: any) {
        alert(`Error parseando CSV: ${err?.message || err}`);
      }
    };
    reader.onerror = () => alert('No se pudo leer el archivo.');
    reader.readAsText(file);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, []);

  const handleImport = async () => {
    if (!selectedCollection) {
      alert('Selecciona una colección destino.');
      return;
    }
    if (csvData.length === 0) {
      alert('No hay datos para importar.');
      return;
    }

    const hasMappedFields = Object.values(fieldMappings).some(m => m.type !== 'skip' && m.firestoreField);
    if (!hasMappedFields) {
      alert('Debes mapear al menos un campo (no todos pueden estar en "Skip").');
      return;
    }

    setStep('importing');
    setImportProgress({ current: 0, total: csvData.length, errors: [], successCount: 0 });

    try {
      const BATCH_SIZE = 500;
      let successCount = 0;
      const errors: { row: number; message: string }[] = [];

      for (let i = 0; i < csvData.length; i += BATCH_SIZE) {
        const batchData = csvData.slice(i, i + BATCH_SIZE);
        const batch = writeBatch(db);

        batchData.forEach((row, index) => {
          const rowNumber = i + index + 1;
          try {
            const transformedData = transformRow(row);

            const hasAnyValue = Object.values(transformedData).some(v =>
              v !== '' && v !== 0 && v !== false && (!Array.isArray(v) || v.length > 0)
            );
            if (!hasAnyValue) {
              errors.push({ row: rowNumber, message: 'Fila completamente vacía, saltada.' });
              return;
            }

            if (useExistingId && idColumn) {
              const docId = String(row[idColumn] || '').trim();
              if (!docId) {
                throw new Error(`ID vacío en la columna "${idColumn}"`);
              }
              const cleanId = docId.replace(/\//g, '_').replace(/^\.+|\.+$/g, '');
              const docRef = doc(db, selectedCollection, cleanId);
              batch.set(docRef, transformedData);
            } else {
              const docRef = doc(collection(db, selectedCollection));
              batch.set(docRef, transformedData);
            }
            successCount++;
          } catch (err: any) {
            errors.push({ row: rowNumber, message: err.message || 'Error desconocido' });
          }
        });

        await batch.commit();

        setImportProgress({
          current: Math.min(i + BATCH_SIZE, csvData.length),
          total: csvData.length,
          successCount,
          errors: [...errors]
        });
      }

      setStep('done');
    } catch (error: any) {
      console.error('Error durante la importación:', error);
      alert(`Error al importar: ${error.message}\n\nRevisa la consola para más detalles.`);
      setStep('preview');
    }
  };

  const handleReset = () => {
    setStep('upload');
    setCsvFile(null);
    setCsvData([]);
    setCsvHeaders([]);
    setSelectedCollection('');
    setFieldMappings({});
    setUseExistingId(false);
    setIdColumn('');
    setColumnSearch('');
    setMappingFilter('all');
    setImportProgress({ current: 0, total: 0, errors: [], successCount: 0 });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ─────────────────────────────────────────────────────────────
  // ESTILOS (tema oscuro Roelca)
  // ─────────────────────────────────────────────────────────────

  const s = {
    card: { backgroundColor: C.panel, borderRadius: '10px', border: `1px solid ${C.border}`, padding: '20px' },
    label: { fontSize: '0.7rem', color: C.textMuted, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.6px', marginBottom: '6px', display: 'block' },
    input: { backgroundColor: C.bg, padding: '7px 11px', border: `1px solid ${C.border}`, borderRadius: '6px', fontSize: '0.825rem', color: C.text, width: '100%', boxSizing: 'border-box' as const, outline: 'none', fontFamily: 'inherit', transition: 'border-color 0.15s, box-shadow 0.15s' },
    select: { backgroundColor: C.bg, padding: '7px 11px', border: `1px solid ${C.border}`, borderRadius: '6px', fontSize: '0.825rem', color: C.text, width: '100%', boxSizing: 'border-box' as const, outline: 'none', cursor: 'pointer', fontFamily: 'inherit', transition: 'border-color 0.15s' },
    btnPrimary: { backgroundColor: C.accent, color: '#ffffff', border: `1px solid ${C.accent}`, padding: '8px 16px', borderRadius: '7px', fontWeight: 500, cursor: 'pointer', fontSize: '0.825rem', display: 'flex', alignItems: 'center', gap: '6px', transition: 'all 0.15s' },
    btnSecondary: { backgroundColor: C.panel, border: `1px solid ${C.border}`, color: C.text, padding: '8px 16px', borderRadius: '7px', fontWeight: 500, cursor: 'pointer', fontSize: '0.825rem', display: 'flex', alignItems: 'center', gap: '6px', transition: 'all 0.15s' },
    stepBadge: (active: boolean, complete: boolean) => ({
      width: '26px', height: '26px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: '0.75rem',
      backgroundColor: complete ? C.green : (active ? C.accent : C.borderSoft),
      color: complete || active ? '#ffffff' : C.textFaint,
      transition: 'all 0.2s',
      flexShrink: 0
    }),
    th: { padding: '9px 12px', textAlign: 'left' as const, fontSize: '0.65rem', fontWeight: 600, color: C.textMuted, textTransform: 'uppercase' as const, letterSpacing: '0.05em', borderBottom: `1px solid ${C.border}`, backgroundColor: C.bg, whiteSpace: 'nowrap' as const },
    td: { padding: '8px 12px', borderBottom: `1px solid ${C.borderSoft}`, fontSize: '0.8rem', color: C.text }
  };

  const STEPS = ['Upload CSV', 'Map Fields', 'Preview', 'Import'];
  const currentStepIndex = step === 'upload' ? 0 : step === 'mapping' ? 1 : step === 'preview' ? 2 : 3;

  // ⭐ Conteos por estado + columnas visibles (según búsqueda y filtro activo)
  const counts = csvHeaders.reduce(
    (acc, h) => { const c = classifyHeader(h); (acc as any)[c]++; acc.all++; return acc; },
    { all: 0, matched: 0, custom: 0, skipped: 0 }
  );
  const visibleHeaders = csvHeaders.filter(h => {
    if (columnSearch.trim() && !h.toLowerCase().includes(columnSearch.toLowerCase().trim())) return false;
    if (mappingFilter !== 'all' && classifyHeader(h) !== mappingFilter) return false;
    return true;
  });

  // ⭐ Estilo visual por estado (etiqueta + tinte de fila)
  const STATUS_UI: Record<'matched' | 'custom' | 'skipped', { bg: string; border: string; fg: string; label: string; rowBg: string; icon: string }> = {
    matched: { bg: C.greenSoft, border: C.greenBorder, fg: C.green, label: 'En la colección', rowBg: 'rgba(63,185,80,0.05)', icon: '✓' },
    custom:  { bg: C.blueSoft, border: C.blueBorder, fg: C.blue, label: 'Campo nuevo', rowBg: 'rgba(88,166,255,0.05)', icon: '✎' },
    skipped: { bg: C.borderSoft, border: C.border, fg: C.textFaint, label: 'No se importa', rowBg: 'transparent', icon: '⊘' }
  };

  const filterPill = (key: 'all' | 'matched' | 'custom' | 'skipped', label: string, count: number, color: string) => (
    <button
      type="button"
      onClick={() => setMappingFilter(key)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        padding: '6px 12px', borderRadius: '999px', cursor: 'pointer',
        fontSize: '0.78rem', fontWeight: 600,
        border: `1px solid ${mappingFilter === key ? color : C.border}`,
        background: mappingFilter === key ? color : C.bg,
        color: mappingFilter === key ? '#ffffff' : C.textMuted,
        transition: 'all 0.15s'
      }}
    >
      {label}
      <span style={{
        background: mappingFilter === key ? 'rgba(255,255,255,0.25)' : C.borderSoft,
        color: mappingFilter === key ? '#ffffff' : C.textMuted,
        borderRadius: '999px', padding: '0 7px', fontSize: '0.72rem', fontWeight: 700, minWidth: '18px', textAlign: 'center'
      }}>{count}</span>
    </button>
  );

  // ─────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────

  return (
    <div className="fade-in" style={{ padding: '24px', maxWidth: '1180px', margin: '0 auto' }}>
      <style>{`
        .spin-import { animation: spin-import 1s linear infinite; }
        @keyframes spin-import { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .hamburger-btn { background: ${C.bg}; border: 1px solid ${C.border}; border-radius: 7px; padding: 7px 10px; cursor: pointer; color: ${C.textMuted}; display: flex; align-items: center; justify-content: center; transition: all 0.15s; }
        .hamburger-btn:hover { background-color: ${C.borderSoft}; border-color: ${C.textFaint}; color: ${C.text}; }
        .di-btn-primary:hover { background-color: ${C.accentHover} !important; border-color: ${C.accentHover} !important; }
        .di-btn-secondary:hover { background-color: ${C.borderSoft} !important; border-color: ${C.textFaint} !important; }
        .di-input:focus { border-color: ${C.accent} !important; box-shadow: 0 0 0 3px ${C.accentSoft} !important; }
        .di-input::placeholder { color: ${C.textFaint}; }
        .di-row:hover { filter: brightness(1.25); }
        .di-input option, .di-input optgroup { background-color: ${C.panel}; color: ${C.text}; }
      `}</style>

      {/* HEADER */}
      <header style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '20px' }}>
        <button className="hamburger-btn" onClick={onOpenMenu}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
        </button>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.35rem', color: C.text, fontWeight: 600, letterSpacing: '-0.02em' }}>Data Import</h1>
          <p style={{ margin: '2px 0 0 0', color: C.textMuted, fontSize: '0.825rem' }}>Importa archivos CSV de Google Sheets hacia Firestore</p>
        </div>
      </header>

      {/* ⭐ PANEL: DESCARGAR PLANTILLA EXCEL (independiente de la importación) */}
      <div style={{ ...s.card, marginBottom: '20px', borderColor: C.greenBorder }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
          <FileSpreadsheet size={16} color={C.green} />
          <h2 style={{ margin: 0, fontSize: '0.95rem', color: C.text, fontWeight: 600 }}>Descargar plantilla de Excel</h2>
        </div>
        <p style={{ margin: '0 0 14px 0', color: C.textMuted, fontSize: '0.8rem', lineHeight: 1.5 }}>
          La plantilla <strong style={{ color: C.text }}>.xlsx</strong> se genera leyendo una muestra de tus documentos reales en Firestore, así incluye <strong style={{ color: C.text }}>todos los campos</strong> de esa colección. ¿Falta alguna colección en la lista? Elige <strong style={{ color: C.text }}>"Otra colección…"</strong>, escribe su nombre y pulsa <strong style={{ color: C.text }}>Agregar a la lista</strong> para que aparezca siempre.
        </p>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 280px', minWidth: '220px' }}>
            <label style={s.label}>
              <Database size={11} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '5px' }} />
              Colección de la plantilla
            </label>
            <select
              className="di-input"
              style={s.select}
              value={exportCollection}
              onChange={(e) => { setExportCollection(e.target.value); if (e.target.value !== '__other__') setOtherCollection(''); }}
            >
              <option value="">— Selecciona una colección —</option>
              {nombresColecciones.map(id => (
                <option key={id} value={id}>{labelColeccion(id)}</option>
              ))}
              <option value="__other__">✎ Otra colección (escribir nombre)…</option>
            </select>
          </div>

          {/* Campo libre para cualquier otra colección de Firestore */}
          {exportCollection === '__other__' && (
            <div style={{ flex: '1 1 260px', minWidth: '200px' }}>
              <label style={s.label}>Nombre exacto de la colección en Firestore</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  className="di-input"
                  style={{ ...s.input, flex: 1 }}
                  placeholder="p. ej. contactos, unidades, remolques…"
                  value={otherCollection}
                  onChange={(e) => setOtherCollection(e.target.value)}
                />
                <button
                  type="button"
                  onClick={agregarAListaColeccion}
                  disabled={!otherCollection.trim() || savingList}
                  className="di-btn-secondary"
                  style={{ ...s.btnSecondary, padding: '7px 12px', whiteSpace: 'nowrap', opacity: (!otherCollection.trim() || savingList) ? 0.5 : 1, cursor: (!otherCollection.trim() || savingList) ? 'not-allowed' : 'pointer' }}
                  title="Guardar este nombre en la lista para que aparezca siempre en el desplegable"
                >
                  {savingList ? <><Loader2 size={13} className="spin-import" /> Guardando…</> : '＋ Agregar a la lista'}
                </button>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={handleDownloadTemplate}
            disabled={!exportCollectionId() || templateBusy}
            className="di-btn-secondary"
            style={{ ...s.btnSecondary, background: C.greenSoft, borderColor: C.greenBorder, color: C.green, opacity: (!exportCollectionId() || templateBusy) ? 0.5 : 1, cursor: (!exportCollectionId() || templateBusy) ? 'not-allowed' : 'pointer' }}
          >
            {templateBusy
              ? <><Loader2 size={14} className="spin-import" /> Leyendo esquema…</>
              : <><Download size={14} /> Descargar Plantilla Excel</>}
          </button>
        </div>
        {!!exportCollectionId() && (
          <p style={{ margin: '10px 0 0 0', fontSize: '0.72rem', color: C.textFaint }}>
            La primera columna es <strong style={{ color: C.text }}>id</strong> (el ID del documento en Firestore, que se usa como ID principal al importar). Las demás columnas se toman de los campos reales de <strong style={{ color: C.green }}>{exportCollectionId()}</strong>. La fila 2 indica el formato esperado de cada campo (p. ej. [YYYY-MM-DD], [número]).
          </p>
        )}
      </div>

      {/* PROGRESS BAR */}
      <div style={{ ...s.card, marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', padding: '16px 20px' }}>
        {STEPS.map((label, idx) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: '110px' }}>
            <div style={s.stepBadge(idx === currentStepIndex, idx < currentStepIndex)}>
              {idx < currentStepIndex ? <CheckCircle size={14} color="#ffffff" /> : idx + 1}
            </div>
            <div style={{ fontSize: '0.775rem', fontWeight: idx === currentStepIndex ? 600 : 500, color: idx === currentStepIndex ? C.text : C.textFaint }}>
              {label}
            </div>
            {idx < STEPS.length - 1 && <div style={{ flex: 1, height: '1px', backgroundColor: idx < currentStepIndex ? C.green : C.border, marginLeft: '6px' }} />}
          </div>
        ))}
      </div>

      {/* ─────────── STEP 1: UPLOAD ─────────── */}
      {step === 'upload' && (
        <div style={s.card}>
          <h2 style={{ margin: '0 0 4px 0', fontSize: '0.95rem', color: C.text, fontWeight: 600 }}>Sube tu archivo CSV</h2>
          <p style={{ margin: '0 0 18px 0', color: C.textMuted, fontSize: '0.825rem' }}>
            Exporta tu Google Sheet como CSV (File → Download → Comma Separated Values) y suéltalo aquí.
          </p>

          <div
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `1.5px dashed ${isDragging ? C.accent : C.border}`,
              borderRadius: '10px',
              padding: '44px 20px',
              textAlign: 'center',
              cursor: 'pointer',
              backgroundColor: isDragging ? C.accentSoft : C.bg,
              transition: 'all 0.18s'
            }}
          >
            <Upload size={32} strokeWidth={1.5} color={isDragging ? C.accent : C.textMuted} style={{ margin: '0 auto 12px', display: 'block' }} />
            <div style={{ fontSize: '0.875rem', fontWeight: 600, color: C.text, marginBottom: '3px' }}>
              {isDragging ? 'Suelta el CSV aquí' : 'Haz clic para seleccionar o arrastra un archivo CSV'}
            </div>
            <div style={{ fontSize: '0.775rem', color: C.textFaint }}>
              Solo archivos .csv · La primera fila deben ser los encabezados de columna
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                handleFile(e.target.files[0]);
              }
            }}
          />

          <div style={{ marginTop: '18px', padding: '14px 16px', backgroundColor: C.amberSoft, border: `1px solid ${C.amberBorder}`, borderRadius: '8px', display: 'flex', gap: '10px' }}>
            <AlertCircle size={15} color={C.amber} style={{ flexShrink: 0, marginTop: '2px' }} />
            <div style={{ fontSize: '0.8rem', color: C.amberText, lineHeight: 1.55 }}>
              <strong style={{ fontWeight: 600 }}>Cómo exportar desde Google Sheets:</strong>
              <ol style={{ margin: '4px 0 0 16px', padding: 0 }}>
                <li>Abre tu Google Sheet</li>
                <li>Asegúrate de que la <strong>primera fila</strong> contenga los nombres de columna (p. ej. "Nombre", "RFC", "Ciudad")</li>
                <li>Haz clic en <strong>File → Download → Comma-separated values (.csv)</strong></li>
                <li>Arrastra el archivo descargado aquí</li>
              </ol>
            </div>
          </div>
        </div>
      )}

      {/* ─────────── STEP 2: MAPPING ─────────── */}
      {step === 'mapping' && (
        <div style={s.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <h2 style={{ margin: '0 0 3px 0', fontSize: '0.95rem', color: C.text, fontWeight: 600 }}>Asigna columnas a campos de Firestore</h2>
              <p style={{ margin: 0, color: C.textMuted, fontSize: '0.775rem' }}>
                <FileSpreadsheet size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '5px' }} />
                <strong style={{ color: C.text, fontWeight: 600 }}>{csvFile?.name}</strong> · {csvData.length} filas · {csvHeaders.length} columnas
              </p>
            </div>
            <button onClick={handleReset} className="di-btn-secondary" style={s.btnSecondary}><RotateCcw size={13} /> Empezar de nuevo</button>
          </div>

          {/* SELECCIONAR COLECCIÓN */}
          <div style={{ marginBottom: '16px' }}>
            <label style={s.label}>
              <Database size={11} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '5px' }} />
              Colección destino en Firestore
            </label>
            <select className="di-input" style={s.select} value={selectedCollection} onChange={(e) => handleSelectCollection(e.target.value)}>
              <option value="">— Selecciona una colección —</option>
              {AVAILABLE_COLLECTIONS.map(c => (
                <option key={c.id} value={c.id}>{c.name} ({c.description})</option>
              ))}
            </select>
            {selectedCollection && (
              <p style={{ margin: '6px 0 0 0', fontSize: '0.7rem', color: C.textFaint }}>
                {getCollectionDef()?.fields.length} campos conocidos en esta colección. Las columnas coincidentes se auto-mapearon abajo.
              </p>
            )}
          </div>

          {/* OPCIÓN: USAR ID DEL CSV */}
          <div style={{ marginBottom: '16px', padding: '14px 16px', backgroundColor: C.bg, borderRadius: '8px', border: `1px solid ${C.border}` }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: useExistingId ? '12px' : 0 }}>
              <input type="checkbox" checked={useExistingId} onChange={(e) => setUseExistingId(e.target.checked)} style={{ accentColor: C.accent, cursor: 'pointer' }} />
              <span style={{ fontWeight: 500, fontSize: '0.825rem', color: C.text }}>Usar una columna del CSV como ID del documento en Firestore</span>
            </label>
            {useExistingId && (
              <div>
                <label style={s.label}>Columna a usar como ID del documento</label>
                <select className="di-input" style={s.select} value={idColumn} onChange={(e) => setIdColumn(e.target.value)}>
                  <option value="">— Selecciona columna —</option>
                  {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
                <p style={{ margin: '6px 0 0 0', fontSize: '0.7rem', color: C.textFaint }}>
                  Si no se marca, Firestore generará IDs aleatorios (recomendado).
                </p>
              </div>
            )}
          </div>

          {/* ⭐ BARRA DE CONTROL: buscador + filtros por estado + acciones masivas */}
          {selectedCollection && (
            <div style={{ marginBottom: '14px', padding: '14px 16px', backgroundColor: C.bg, border: `1px solid ${C.border}`, borderRadius: '10px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* Buscador */}
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ position: 'relative', flex: '1 1 240px', minWidth: '200px' }}>
                  <input
                    className="di-input"
                    style={{ ...s.input, paddingLeft: '32px' }}
                    placeholder="Buscar columna del CSV…"
                    value={columnSearch}
                    onChange={(e) => setColumnSearch(e.target.value)}
                  />
                  <FileSpreadsheet size={14} color={C.textFaint} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }} />
                </div>
                {/* Acciones masivas */}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button type="button" onClick={reAutoMap} className="di-btn-secondary" style={{ ...s.btnSecondary, padding: '7px 12px' }} title="Volver a emparejar automáticamente por nombre">
                    <RotateCcw size={13} /> Auto-mapear
                  </button>
                  <button type="button" onClick={bulkImportSkipped} className="di-btn-secondary" style={{ ...s.btnSecondary, padding: '7px 12px', color: C.blue, borderColor: C.blueBorder, background: C.blueSoft }} title="Importar como campo nuevo todas las columnas omitidas">
                    Importar omitidas
                  </button>
                  <button type="button" onClick={bulkSkipCustom} className="di-btn-secondary" style={{ ...s.btnSecondary, padding: '7px 12px' }} title="No importar las columnas que crearían campos nuevos">
                    Omitir campos nuevos
                  </button>
                </div>
              </div>

              {/* Filtros por estado (con conteos, clickeables) */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                {filterPill('all', 'Todas', counts.all, C.accent)}
                {filterPill('matched', '✓ En la colección', counts.matched, C.green)}
                {filterPill('custom', '✎ Campo nuevo', counts.custom, C.blue)}
                {filterPill('skipped', '⊘ No se importa', counts.skipped, C.textFaint)}
              </div>
            </div>
          )}

          {/* TABLA DE MAPEO */}
          <div style={{ border: `1px solid ${C.border}`, borderRadius: '8px', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '680px' }}>
              <thead>
                <tr>
                  <th style={{ ...s.th, width: '132px' }}>Estado</th>
                  <th style={s.th}><FileSpreadsheet size={11} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '5px' }} /> Columna del CSV</th>
                  <th style={s.th}>Ejemplo</th>
                  <th style={{ ...s.th, width: '36px' }}></th>
                  <th style={s.th}>
                    <Database size={11} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '5px' }} />
                    {(() => {
                      const def = getCollectionDef();
                      return def ? `Campo en ${def.name}` : 'Campo destino (elige colección)';
                    })()}
                  </th>
                  <th style={s.th}>Tipo</th>
                </tr>
              </thead>
              <tbody>
                {visibleHeaders.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ ...s.td, textAlign: 'center', color: C.textFaint, padding: '28px', fontStyle: 'italic' }}>
                      {csvHeaders.length === 0 ? 'No hay columnas.' : 'Ninguna columna coincide con la búsqueda/filtro.'}
                    </td>
                  </tr>
                ) : visibleHeaders.map(header => {
                  const mapping = fieldMappings[header];
                  const sampleValue = csvData[0]?.[header] || '';
                  const isSkipped = mapping?.type === 'skip';
                  const collectionDef = getCollectionDef();
                  const knownFields = collectionDef?.fields || [];
                  const isKnownField = knownFields.some(f => f.name === mapping?.firestoreField);
                  const dropdownValue = !mapping?.firestoreField
                    ? ''
                    : (isKnownField ? mapping.firestoreField : '__custom__');
                  const status = classifyHeader(header);
                  const ui = STATUS_UI[status];

                  return (
                    <tr key={header} className="di-row" style={{ backgroundColor: ui.rowBg, transition: 'filter 0.15s' }}>
                      {/* Estado */}
                      <td style={s.td}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '3px 9px', borderRadius: '999px', border: `1px solid ${ui.border}`, background: ui.bg, color: ui.fg, fontSize: '0.68rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
                          <span style={{ fontSize: '0.72rem' }}>{ui.icon}</span> {ui.label}
                        </span>
                      </td>
                      {/* Columna del CSV */}
                      <td style={{ ...s.td, fontWeight: 600, color: C.text }}>{header}</td>
                      {/* Ejemplo */}
                      <td style={{ ...s.td, color: C.textFaint, maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, monospace', fontSize: '0.75rem' }}>
                        {String(sampleValue).substring(0, 50)}
                      </td>
                      <td style={s.td}><ArrowRight size={13} color={C.textFaint} strokeWidth={2} /></td>
                      {/* Campo destino */}
                      <td style={s.td}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <select
                            className="di-input"
                            style={{ ...s.select, padding: '6px 10px', fontSize: '0.8rem', opacity: isSkipped ? 0.5 : 1 }}
                            value={dropdownValue}
                            disabled={isSkipped}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v === '') {
                                setFieldMappings(prev => ({ ...prev, [header]: { ...prev[header], firestoreField: '' } }));
                              } else if (v === '__custom__') {
                                setFieldMappings(prev => ({ ...prev, [header]: { ...prev[header], firestoreField: isKnownField ? '' : (prev[header]?.firestoreField || '') } }));
                              } else {
                                const fieldDef = knownFields.find(f => f.name === v);
                                setFieldMappings(prev => ({
                                  ...prev,
                                  [header]: { firestoreField: v, type: fieldDef?.type || prev[header]?.type || 'string' }
                                }));
                              }
                            }}
                          >
                            <option value="">— No mapear esta columna —</option>
                            {collectionDef && knownFields.length > 0 && (
                              <optgroup label={`Campos de ${collectionDef.name}`}>
                                {knownFields.map(f => (
                                  <option key={f.name} value={f.name}>
                                    {f.name}{f.label ? ` · ${f.label}` : ''} ({f.type})
                                  </option>
                                ))}
                              </optgroup>
                            )}
                            <option value="__custom__">✎ Nombre de campo personalizado…</option>
                          </select>

                          {(dropdownValue === '__custom__' || (!collectionDef && mapping?.firestoreField)) && (
                            <input
                              type="text"
                              className="di-input"
                              style={{ ...s.input, padding: '5px 10px', fontSize: '0.75rem' }}
                              value={mapping?.firestoreField || ''}
                              onChange={(e) => setFieldMappings(prev => ({
                                ...prev,
                                [header]: { ...prev[header], firestoreField: e.target.value }
                              }))}
                              disabled={isSkipped}
                              placeholder={collectionDef ? 'nombreCampoPersonalizado' : 'Selecciona colección arriba para usar el schema'}
                            />
                          )}
                        </div>
                      </td>
                      {/* Tipo */}
                      <td style={s.td}>
                        <select
                          className="di-input"
                          style={{ ...s.select, padding: '6px 10px', fontSize: '0.8rem' }}
                          value={mapping?.type || 'string'}
                          onChange={(e) => setFieldMappings(prev => ({
                            ...prev,
                            [header]: { ...prev[header], type: e.target.value as FieldType }
                          }))}
                        >
                          <option value="string">Texto (string)</option>
                          <option value="number">Número</option>
                          <option value="boolean">Sí/No (boolean)</option>
                          <option value="date">Fecha (YYYY-MM-DD)</option>
                          <option value="array">Arreglo (separado por comas)</option>
                          <option value="skip">⊘ Omitir esta columna</option>
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Resumen inferior + continuar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '18px', gap: '10px', flexWrap: 'wrap' }}>
            <div style={{ fontSize: '0.78rem', color: C.textMuted }}>
              Se importarán <strong style={{ color: C.text }}>{counts.matched + counts.custom}</strong> de {csvHeaders.length} columnas
              {counts.skipped > 0 && <span> · {counts.skipped} omitida(s)</span>}
            </div>
            <button
              onClick={() => setStep('preview')}
              disabled={!selectedCollection}
              className="di-btn-primary"
              style={{ ...s.btnPrimary, opacity: !selectedCollection ? 0.4 : 1, cursor: !selectedCollection ? 'not-allowed' : 'pointer' }}
            >
              Previsualizar datos <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ─────────── STEP 3: PREVIEW ─────────── */}
      {step === 'preview' && (
        <div style={s.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <h2 style={{ margin: '0 0 3px 0', fontSize: '0.95rem', color: C.text, fontWeight: 600 }}>Previsualiza antes de importar</h2>
              <p style={{ margin: 0, color: C.textMuted, fontSize: '0.775rem' }}>
                Primeras 5 filas transformadas como se guardarán en <strong style={{ color: C.text, fontWeight: 600 }}>{selectedCollection}</strong>
              </p>
            </div>
            <button onClick={() => setStep('mapping')} className="di-btn-secondary" style={s.btnSecondary}>
              <ChevronDown size={13} style={{ transform: 'rotate(90deg)' }} /> Volver al mapeo
            </button>
          </div>

          <div style={{ display: 'grid', gap: '10px', marginBottom: '16px' }}>
            {csvData.slice(0, 5).map((row, idx) => {
              const transformed = transformRow(row);
              const docId = useExistingId && idColumn ? String(row[idColumn] || '(¡vacío!)').trim() : '(auto-generado)';
              return (
                <div key={idx} style={{ backgroundColor: C.bg, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '12px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontSize: '0.65rem', color: C.textFaint, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Fila {idx + 1}</span>
                    <span style={{ fontSize: '0.7rem', color: C.textMuted, backgroundColor: C.borderSoft, padding: '2px 8px', borderRadius: '4px', fontWeight: 500, fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, monospace' }}>
                      ID: {docId}
                    </span>
                  </div>
                  <pre style={{ margin: 0, fontSize: '0.75rem', color: C.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, monospace', lineHeight: 1.55 }}>
                    {JSON.stringify(transformed, null, 2)}
                  </pre>
                </div>
              );
            })}
          </div>

          {csvData.length > 5 && (
            <p style={{ textAlign: 'center', color: C.textFaint, fontSize: '0.775rem', marginBottom: '16px' }}>
              y <strong style={{ color: C.textMuted, fontWeight: 600 }}>{csvData.length - 5}</strong> filas más se importarán de forma similar
            </p>
          )}

          <div style={{ padding: '14px 16px', backgroundColor: C.amberSoft, border: `1px solid ${C.amberBorder}`, borderRadius: '8px', marginBottom: '18px', display: 'flex', gap: '10px' }}>
            <AlertCircle size={16} color={C.amber} style={{ flexShrink: 0, marginTop: '2px' }} />
            <div style={{ fontSize: '0.8rem', color: C.amberText, lineHeight: 1.5 }}>
              <strong style={{ fontWeight: 600 }}>A punto de importar {csvData.length} documentos en "{selectedCollection}"</strong>
              <div style={{ marginTop: '3px', fontSize: '0.75rem', opacity: 0.85 }}>Esta acción no se puede deshacer desde esta vista. Verifica que el mapeo sea correcto.</div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <button onClick={handleReset} className="di-btn-secondary" style={s.btnSecondary}>Cancelar</button>
            <button
              onClick={handleImport}
              style={{ ...s.btnPrimary, backgroundColor: C.green, borderColor: C.green }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#2ea043'; e.currentTarget.style.borderColor = '#2ea043'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = C.green; e.currentTarget.style.borderColor = C.green; }}
            >
              <Upload size={14} /> Importar {csvData.length} registros
            </button>
          </div>
        </div>
      )}

      {/* ─────────── STEP 4: IMPORTING ─────────── */}
      {step === 'importing' && (
        <div style={s.card}>
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <Loader2 size={32} strokeWidth={1.75} className="spin-import" color={C.accent} style={{ margin: '0 auto 16px', display: 'block' }} />
            <h2 style={{ margin: '0 0 4px 0', fontSize: '1rem', color: C.text, fontWeight: 600 }}>Importando datos</h2>
            <p style={{ margin: '0 0 22px 0', color: C.textMuted, fontSize: '0.8rem' }}>
              {importProgress.current} de {importProgress.total} registros procesados
            </p>

            <div style={{ maxWidth: '360px', margin: '0 auto' }}>
              <div style={{ height: '6px', backgroundColor: C.borderSoft, borderRadius: '3px', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${(importProgress.current / importProgress.total) * 100}%`,
                    height: '100%',
                    backgroundColor: C.accent,
                    transition: 'width 0.3s ease',
                    borderRadius: '3px'
                  }}
                />
              </div>
              <div style={{ marginTop: '8px', fontSize: '0.75rem', color: C.textMuted, fontWeight: 500, fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, monospace' }}>
                {Math.round((importProgress.current / importProgress.total) * 100)}%
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─────────── STEP 5: DONE ─────────── */}
      {step === 'done' && (
        <div style={s.card}>
          <div style={{ textAlign: 'center', padding: '20px 16px' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '50%', backgroundColor: C.greenSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
              <CheckCircle size={26} strokeWidth={2} color={C.green} />
            </div>
            <h2 style={{ margin: '0 0 6px 0', fontSize: '1.05rem', color: C.text, fontWeight: 600 }}>Importación completa</h2>
            <p style={{ margin: '0 0 22px 0', color: C.textMuted, fontSize: '0.8rem' }}>
              <strong style={{ color: C.green, fontWeight: 600 }}>{importProgress.successCount}</strong> registros importados con éxito a <strong style={{ color: C.text, fontWeight: 600 }}>{selectedCollection}</strong>
              {importProgress.errors.length > 0 && (
                <span>, <strong style={{ color: C.red, fontWeight: 600 }}>{importProgress.errors.length}</strong> errores</span>
              )}
            </p>

            {importProgress.errors.length > 0 && (
              <details style={{ textAlign: 'left', maxWidth: '560px', margin: '0 auto 22px', backgroundColor: C.redSoft, border: `1px solid ${C.redBorder}`, borderRadius: '8px', padding: '12px 14px' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600, color: C.redText, fontSize: '0.8rem' }}>
                  Mostrar {importProgress.errors.length} errores
                </summary>
                <div style={{ marginTop: '10px', maxHeight: '200px', overflowY: 'auto' }}>
                  {importProgress.errors.map((err, i) => (
                    <div key={i} style={{ fontSize: '0.75rem', color: C.redText, padding: '4px 0', borderBottom: i < importProgress.errors.length - 1 ? `1px solid ${C.redBorder}` : 'none' }}>
                      <strong style={{ fontWeight: 600 }}>Fila {err.row}:</strong> {err.message}
                    </div>
                  ))}
                </div>
              </details>
            )}

            <button onClick={handleReset} className="di-btn-primary" style={{ ...s.btnPrimary, margin: '0 auto' }}>
              <RotateCcw size={14} /> Importar otro archivo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}