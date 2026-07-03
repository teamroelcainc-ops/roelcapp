import { useState, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { db } from '../../../config/firebase';
import { collection, doc, writeBatch } from 'firebase/firestore';

// Iconos sin dependencias externas (esta app no tiene 'lucide-react' instalado).
const Upload = (_p: any) => <span>⬆️</span>;
const ArrowRight = (_p: any) => <span>➡️</span>;
const AlertCircle = (_p: any) => <span>⚠️</span>;
const CheckCircle = (_p: any) => <span>✅</span>;
const Database = (_p: any) => <span>🗄️</span>;
const Loader2 = (_p: any) => <span>⏳</span>;
const RotateCcw = (_p: any) => <span>↺</span>;
const FileSpreadsheet = (_p: any) => <span>📊</span>;
const ChevronDown = (_p: any) => <span>▾</span>;
const Download = (_p: any) => <span>⬇️</span>;

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
  //    la colección destino de importación).
  const [exportCollection, setExportCollection] = useState<string>('');

  const getExportDef = (): CollectionDef | undefined =>
    AVAILABLE_COLLECTIONS.find(c => c.id === exportCollection);

  // ⭐ Texto de ayuda por tipo de campo (fila 2 de la plantilla)
  const TYPE_EXAMPLE: Record<FieldType, string> = {
    string: '[texto]',
    number: '[número]',
    boolean: '[VERDADERO/FALSO]',
    date: '[YYYY-MM-DD]',
    array: '[valor1, valor2]',
    skip: '[texto]',
  };

  // ⭐ Genera y descarga una plantilla .xlsx para la colección elegida:
  //    Fila 1 = nombres de los campos (schema) · Fila 2 = formato esperado por tipo.
  const handleDownloadTemplate = () => {
    const def = getExportDef();
    if (!def) {
      alert('Selecciona una colección para descargar su plantilla.');
      return;
    }

    // ⭐ La primera columna es 'id': aquí va el ID de AppSheet, que será el ID
    //    principal del documento en Firestore (marca "usar columna como ID" al importar).
    const headers = ['id', ...def.fields.map(f => f.name)];
    const exampleRow = ['[ID de AppSheet — será el ID del documento]', ...def.fields.map(f => TYPE_EXAMPLE[f.type] || '[texto]')];

    const worksheet = XLSX.utils.aoa_to_sheet([headers, exampleRow]);
    // Ancho de columnas cómodo según el header
    worksheet['!cols'] = headers.map(h => ({ wch: Math.max(14, h.length + 4) }));

    const workbook = XLSX.utils.book_new();
    // Excel no permite estos caracteres en el nombre de la hoja: : \ / ? * [ ]
    const safeSheetName = (def.name.replace(/[:\\/?*[\]]/g, ' ').trim().substring(0, 31)) || 'Plantilla';
    XLSX.utils.book_append_sheet(workbook, worksheet, safeSheetName);

    XLSX.writeFile(workbook, `plantilla_${def.id}.xlsx`);
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
  // ESTILOS
  // ─────────────────────────────────────────────────────────────

  const s = {
    card: { backgroundColor: 'white', borderRadius: '10px', border: '1px solid #e5e7eb', padding: '20px' },
    label: { fontSize: '0.7rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.6px', marginBottom: '6px', display: 'block' },
    input: { backgroundColor: '#ffffff', padding: '7px 11px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '0.825rem', color: '#0f172a', width: '100%', boxSizing: 'border-box' as const, outline: 'none', fontFamily: 'inherit', transition: 'border-color 0.15s, box-shadow 0.15s' },
    select: { backgroundColor: '#ffffff', padding: '7px 11px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '0.825rem', color: '#0f172a', width: '100%', boxSizing: 'border-box' as const, outline: 'none', cursor: 'pointer', fontFamily: 'inherit', transition: 'border-color 0.15s' },
    btnPrimary: { backgroundColor: '#1e293b', color: 'white', border: '1px solid #1e293b', padding: '8px 16px', borderRadius: '7px', fontWeight: 500, cursor: 'pointer', fontSize: '0.825rem', display: 'flex', alignItems: 'center', gap: '6px', transition: 'all 0.15s' },
    btnSecondary: { backgroundColor: 'white', border: '1px solid #e2e8f0', color: '#475569', padding: '8px 16px', borderRadius: '7px', fontWeight: 500, cursor: 'pointer', fontSize: '0.825rem', display: 'flex', alignItems: 'center', gap: '6px', transition: 'all 0.15s' },
    stepBadge: (active: boolean, complete: boolean) => ({
      width: '26px', height: '26px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: '0.75rem',
      backgroundColor: complete ? '#10b981' : (active ? '#0f172a' : '#f1f5f9'),
      color: complete || active ? 'white' : '#94a3b8',
      transition: 'all 0.2s',
      flexShrink: 0
    }),
    th: { padding: '9px 12px', textAlign: 'left' as const, fontSize: '0.65rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' as const, letterSpacing: '0.05em', borderBottom: '1px solid #e2e8f0', backgroundColor: '#f8fafc', whiteSpace: 'nowrap' as const },
    td: { padding: '8px 12px', borderBottom: '1px solid #f1f5f9', fontSize: '0.8rem', color: '#0f172a' }
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
    matched: { bg: '#ecfdf5', border: '#a7f3d0', fg: '#047857', label: 'En la colección', rowBg: '#f6fefb', icon: '✓' },
    custom:  { bg: '#eff6ff', border: '#bfdbfe', fg: '#1d4ed8', label: 'Campo nuevo', rowBg: '#f8fbff', icon: '✎' },
    skipped: { bg: '#f1f5f9', border: '#e2e8f0', fg: '#94a3b8', label: 'No se importa', rowBg: '#ffffff', icon: '⊘' }
  };

  const filterPill = (key: 'all' | 'matched' | 'custom' | 'skipped', label: string, count: number, color: string) => (
    <button
      type="button"
      onClick={() => setMappingFilter(key)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        padding: '6px 12px', borderRadius: '999px', cursor: 'pointer',
        fontSize: '0.78rem', fontWeight: 600,
        border: `1px solid ${mappingFilter === key ? color : '#e2e8f0'}`,
        background: mappingFilter === key ? color : '#ffffff',
        color: mappingFilter === key ? '#ffffff' : '#475569',
        transition: 'all 0.15s'
      }}
    >
      {label}
      <span style={{
        background: mappingFilter === key ? 'rgba(255,255,255,0.25)' : '#f1f5f9',
        color: mappingFilter === key ? '#ffffff' : '#64748b',
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
        .hamburger-btn { background: white; border: 1px solid #e5e7eb; border-radius: 7px; padding: 7px 10px; cursor: pointer; color: #475569; display: flex; align-items: center; justify-content: center; transition: all 0.15s; }
        .hamburger-btn:hover { background-color: #f8fafc; border-color: #cbd5e1; }
        .di-btn-primary:hover { background-color: #0f172a !important; }
        .di-btn-secondary:hover { background-color: #f8fafc !important; border-color: #cbd5e1 !important; }
        .di-input:focus { border-color: #0f172a !important; box-shadow: 0 0 0 3px rgba(15,23,42,0.06) !important; }
        .di-row:hover { filter: brightness(0.985); }
      `}</style>

      {/* HEADER */}
      <header style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '20px' }}>
        <button className="hamburger-btn" onClick={onOpenMenu}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
        </button>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.35rem', color: '#0f172a', fontWeight: 600, letterSpacing: '-0.02em' }}>Data Import</h1>
          <p style={{ margin: '2px 0 0 0', color: '#64748b', fontSize: '0.825rem' }}>Import CSV files from Google Sheets into Firestore</p>
        </div>
      </header>

      {/* ⭐ PANEL: DESCARGAR PLANTILLA EXCEL (independiente de la importación) */}
      <div style={{ ...s.card, marginBottom: '20px', borderColor: '#d1fae5', background: 'linear-gradient(180deg, #f6fefb, #ffffff)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
          <FileSpreadsheet size={16} color="#059669" />
          <h2 style={{ margin: 0, fontSize: '0.95rem', color: '#0f172a', fontWeight: 600 }}>Descargar plantilla de Excel</h2>
        </div>
        <p style={{ margin: '0 0 14px 0', color: '#64748b', fontSize: '0.8rem', lineHeight: 1.5 }}>
          Elige una colección y descarga una plantilla <strong>.xlsx</strong> con las columnas correctas. Llénala, expórtala como <strong>CSV</strong> (File → Download → CSV) y súbela abajo para importar.
        </p>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 280px', minWidth: '220px' }}>
            <label style={s.label}>
              <Database size={11} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '5px' }} />
              Colección de la plantilla
            </label>
            <select className="di-input" style={s.select} value={exportCollection} onChange={(e) => setExportCollection(e.target.value)}>
              <option value="">— Selecciona una colección —</option>
              {AVAILABLE_COLLECTIONS.map(c => (
                <option key={c.id} value={c.id}>{c.name} ({c.description})</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={handleDownloadTemplate}
            disabled={!exportCollection}
            className="di-btn-secondary"
            style={{ ...s.btnSecondary, background: '#ecfdf5', borderColor: '#a7f3d0', color: '#047857', opacity: !exportCollection ? 0.5 : 1, cursor: !exportCollection ? 'not-allowed' : 'pointer' }}
          >
            <Download size={14} /> Descargar Plantilla Excel
          </button>
        </div>
        {exportCollection && (
          <p style={{ margin: '10px 0 0 0', fontSize: '0.72rem', color: '#94a3b8' }}>
            La plantilla tendrá <strong style={{ color: '#059669' }}>{(getExportDef()?.fields.length || 0) + 1}</strong> columna(s), incluyendo <strong style={{ color: '#0f172a' }}>id</strong> (el ID de AppSheet que se usará como ID principal del documento). La fila 2 indica el formato esperado de cada campo (p. ej. [YYYY-MM-DD], [número]).
          </p>
        )}
      </div>

      {/* PROGRESS BAR */}
      <div style={{ ...s.card, marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', padding: '16px 20px' }}>
        {STEPS.map((label, idx) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: '110px' }}>
            <div style={s.stepBadge(idx === currentStepIndex, idx < currentStepIndex)}>
              {idx < currentStepIndex ? <CheckCircle size={14} /> : idx + 1}
            </div>
            <div style={{ fontSize: '0.775rem', fontWeight: idx === currentStepIndex ? 600 : 500, color: idx === currentStepIndex ? '#0f172a' : '#94a3b8' }}>
              {label}
            </div>
            {idx < STEPS.length - 1 && <div style={{ flex: 1, height: '1px', backgroundColor: idx < currentStepIndex ? '#10b981' : '#e2e8f0', marginLeft: '6px' }} />}
          </div>
        ))}
      </div>

      {/* ─────────── STEP 1: UPLOAD ─────────── */}
      {step === 'upload' && (
        <div style={s.card}>
          <h2 style={{ margin: '0 0 4px 0', fontSize: '0.95rem', color: '#0f172a', fontWeight: 600 }}>Upload your CSV file</h2>
          <p style={{ margin: '0 0 18px 0', color: '#64748b', fontSize: '0.825rem' }}>
            Export your Google Sheet as CSV (File → Download → Comma Separated Values) and drop it here.
          </p>

          <div
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `1.5px dashed ${isDragging ? '#0f172a' : '#cbd5e1'}`,
              borderRadius: '10px',
              padding: '44px 20px',
              textAlign: 'center',
              cursor: 'pointer',
              backgroundColor: isDragging ? '#f1f5f9' : '#fafbfc',
              transition: 'all 0.18s'
            }}
          >
            <Upload size={32} strokeWidth={1.5} style={{ color: isDragging ? '#0f172a' : '#94a3b8', margin: '0 auto 12px', display: 'block' }} />
            <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a', marginBottom: '3px' }}>
              {isDragging ? 'Drop the CSV here' : 'Click to select or drag a CSV file'}
            </div>
            <div style={{ fontSize: '0.775rem', color: '#94a3b8' }}>
              Only .csv files · First row must be column headers
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

          <div style={{ marginTop: '18px', padding: '14px 16px', backgroundColor: '#fffbeb', border: '1px solid #fef3c7', borderRadius: '8px', display: 'flex', gap: '10px' }}>
            <AlertCircle size={15} color="#a16207" style={{ flexShrink: 0, marginTop: '2px' }} />
            <div style={{ fontSize: '0.8rem', color: '#78350f', lineHeight: 1.55 }}>
              <strong style={{ fontWeight: 600 }}>How to export from Google Sheets:</strong>
              <ol style={{ margin: '4px 0 0 16px', padding: 0 }}>
                <li>Open your Google Sheet</li>
                <li>Make sure the <strong>first row</strong> contains column names (e.g., "First Name", "Email", "Phone")</li>
                <li>Click <strong>File → Download → Comma-separated values (.csv)</strong></li>
                <li>Drag the downloaded file here</li>
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
              <h2 style={{ margin: '0 0 3px 0', fontSize: '0.95rem', color: '#0f172a', fontWeight: 600 }}>Map columns to Firestore fields</h2>
              <p style={{ margin: 0, color: '#64748b', fontSize: '0.775rem' }}>
                <FileSpreadsheet size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '5px' }} />
                <strong style={{ color: '#0f172a', fontWeight: 600 }}>{csvFile?.name}</strong> · {csvData.length} rows · {csvHeaders.length} columns
              </p>
            </div>
            <button onClick={handleReset} className="di-btn-secondary" style={s.btnSecondary}><RotateCcw size={13} /> Start Over</button>
          </div>

          {/* SELECCIONAR COLECCIÓN */}
          <div style={{ marginBottom: '16px' }}>
            <label style={s.label}>
              <Database size={11} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '5px' }} />
              Target Firestore Collection
            </label>
            <select className="di-input" style={s.select} value={selectedCollection} onChange={(e) => handleSelectCollection(e.target.value)}>
              <option value="">— Select a collection —</option>
              {AVAILABLE_COLLECTIONS.map(c => (
                <option key={c.id} value={c.id}>{c.name} ({c.description})</option>
              ))}
            </select>
            {selectedCollection && (
              <p style={{ margin: '6px 0 0 0', fontSize: '0.7rem', color: '#94a3b8' }}>
                {getCollectionDef()?.fields.length} known fields for this collection. Matching columns were auto-mapped below.
              </p>
            )}
          </div>

          {/* OPCIÓN: USAR ID DEL CSV */}
          <div style={{ marginBottom: '16px', padding: '14px 16px', backgroundColor: '#fafbfc', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: useExistingId ? '12px' : 0 }}>
              <input type="checkbox" checked={useExistingId} onChange={(e) => setUseExistingId(e.target.checked)} style={{ accentColor: '#0f172a', cursor: 'pointer' }} />
              <span style={{ fontWeight: 500, fontSize: '0.825rem', color: '#0f172a' }}>Use a column from CSV as the Firestore document ID</span>
            </label>
            {useExistingId && (
              <div>
                <label style={s.label}>Column to use as document ID</label>
                <select className="di-input" style={s.select} value={idColumn} onChange={(e) => setIdColumn(e.target.value)}>
                  <option value="">— Select column —</option>
                  {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
                <p style={{ margin: '6px 0 0 0', fontSize: '0.7rem', color: '#94a3b8' }}>
                  If unchecked, Firestore will auto-generate random IDs (recommended).
                </p>
              </div>
            )}
          </div>

          {/* ⭐ BARRA DE CONTROL: buscador + filtros por estado + acciones masivas */}
          {selectedCollection && (
            <div style={{ marginBottom: '14px', padding: '14px 16px', backgroundColor: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: '10px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
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
                  <FileSpreadsheet size={14} color="#94a3b8" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }} />
                </div>
                {/* Acciones masivas */}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button type="button" onClick={reAutoMap} style={{ ...s.btnSecondary, padding: '7px 12px' }} title="Volver a emparejar automáticamente por nombre">
                    <RotateCcw size={13} /> Auto-mapear
                  </button>
                  <button type="button" onClick={bulkImportSkipped} style={{ ...s.btnSecondary, padding: '7px 12px', color: '#1d4ed8', borderColor: '#bfdbfe', background: '#eff6ff' }} title="Importar como campo nuevo todas las columnas omitidas">
                    Importar omitidas
                  </button>
                  <button type="button" onClick={bulkSkipCustom} style={{ ...s.btnSecondary, padding: '7px 12px' }} title="No importar las columnas que crearían campos nuevos">
                    Omitir campos nuevos
                  </button>
                </div>
              </div>

              {/* Filtros por estado (con conteos, clickeables) */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                {filterPill('all', 'Todas', counts.all, '#0f172a')}
                {filterPill('matched', '✓ En la colección', counts.matched, '#10b981')}
                {filterPill('custom', '✎ Campo nuevo', counts.custom, '#2563eb')}
                {filterPill('skipped', '⊘ No se importa', counts.skipped, '#64748b')}
              </div>
            </div>
          )}

          {/* TABLA DE MAPEO */}
          <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', overflowX: 'auto' }}>
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
                    <td colSpan={6} style={{ ...s.td, textAlign: 'center', color: '#94a3b8', padding: '28px', fontStyle: 'italic' }}>
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
                      <td style={{ ...s.td, fontWeight: 600, color: '#0f172a' }}>{header}</td>
                      {/* Ejemplo */}
                      <td style={{ ...s.td, color: '#94a3b8', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, monospace', fontSize: '0.75rem' }}>
                        {String(sampleValue).substring(0, 50)}
                      </td>
                      <td style={s.td}><ArrowRight size={13} color="#cbd5e1" strokeWidth={2} /></td>
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
                            <option value="">— Don't map this column —</option>
                            {collectionDef && knownFields.length > 0 && (
                              <optgroup label={`📋 ${collectionDef.name} fields`}>
                                {knownFields.map(f => (
                                  <option key={f.name} value={f.name}>
                                    {f.name}{f.label ? ` · ${f.label}` : ''} ({f.type})
                                  </option>
                                ))}
                              </optgroup>
                            )}
                            <option value="__custom__">✎ Custom field name…</option>
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
                              placeholder={collectionDef ? 'customFieldName' : 'Select collection above to use schema'}
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
                          <option value="string">Text (string)</option>
                          <option value="number">Number</option>
                          <option value="boolean">Yes/No (boolean)</option>
                          <option value="date">Date (YYYY-MM-DD)</option>
                          <option value="array">Array (comma-separated)</option>
                          <option value="skip">⊘ Skip this column</option>
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
            <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
              Se importarán <strong style={{ color: '#0f172a' }}>{counts.matched + counts.custom}</strong> de {csvHeaders.length} columnas
              {counts.skipped > 0 && <span> · {counts.skipped} omitida(s)</span>}
            </div>
            <button 
              onClick={() => setStep('preview')} 
              disabled={!selectedCollection} 
              className="di-btn-primary"
              style={{ ...s.btnPrimary, opacity: !selectedCollection ? 0.4 : 1, cursor: !selectedCollection ? 'not-allowed' : 'pointer' }}
            >
              Preview Data <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ─────────── STEP 3: PREVIEW ─────────── */}
      {step === 'preview' && (
        <div style={s.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <h2 style={{ margin: '0 0 3px 0', fontSize: '0.95rem', color: '#0f172a', fontWeight: 600 }}>Preview before importing</h2>
              <p style={{ margin: 0, color: '#64748b', fontSize: '0.775rem' }}>
                First 5 rows transformed as they will be saved in <strong style={{ color: '#0f172a', fontWeight: 600 }}>{selectedCollection}</strong>
              </p>
            </div>
            <button onClick={() => setStep('mapping')} className="di-btn-secondary" style={s.btnSecondary}>
              <ChevronDown size={13} style={{ transform: 'rotate(90deg)' }} /> Back to Mapping
            </button>
          </div>

          <div style={{ display: 'grid', gap: '10px', marginBottom: '16px' }}>
            {csvData.slice(0, 5).map((row, idx) => {
              const transformed = transformRow(row);
              const docId = useExistingId && idColumn ? String(row[idColumn] || '(empty!)').trim() : '(auto-generated)';
              return (
                <div key={idx} style={{ backgroundColor: '#fafbfc', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontSize: '0.65rem', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Row {idx + 1}</span>
                    <span style={{ fontSize: '0.7rem', color: '#475569', backgroundColor: '#f1f5f9', padding: '2px 8px', borderRadius: '4px', fontWeight: 500, fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, monospace' }}>
                      ID: {docId}
                    </span>
                  </div>
                  <pre style={{ margin: 0, fontSize: '0.75rem', color: '#0f172a', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, monospace', lineHeight: 1.55 }}>
                    {JSON.stringify(transformed, null, 2)}
                  </pre>
                </div>
              );
            })}
          </div>

          {csvData.length > 5 && (
            <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: '0.775rem', marginBottom: '16px' }}>
              and <strong style={{ color: '#475569', fontWeight: 600 }}>{csvData.length - 5}</strong> more rows will be imported similarly
            </p>
          )}

          <div style={{ padding: '14px 16px', backgroundColor: '#fffbeb', border: '1px solid #fef3c7', borderRadius: '8px', marginBottom: '18px', display: 'flex', gap: '10px' }}>
            <AlertCircle size={16} color="#a16207" style={{ flexShrink: 0, marginTop: '2px' }} />
            <div style={{ fontSize: '0.8rem', color: '#78350f', lineHeight: 1.5 }}>
              <strong style={{ fontWeight: 600 }}>About to import {csvData.length} documents into "{selectedCollection}"</strong>
              <div style={{ marginTop: '3px', fontSize: '0.75rem', opacity: 0.85 }}>This action cannot be undone from this view. Make sure the mapping is correct.</div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <button onClick={handleReset} className="di-btn-secondary" style={s.btnSecondary}>Cancel</button>
            <button 
              onClick={handleImport} 
              style={{ ...s.btnPrimary, backgroundColor: '#10b981', borderColor: '#10b981' }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#059669'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#10b981'}
            >
              <Upload size={14} /> Import {csvData.length} records
            </button>
          </div>
        </div>
      )}

      {/* ─────────── STEP 4: IMPORTING ─────────── */}
      {step === 'importing' && (
        <div style={s.card}>
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <Loader2 size={32} strokeWidth={1.75} className="spin-import" style={{ color: '#0f172a', margin: '0 auto 16px', display: 'block' }} />
            <h2 style={{ margin: '0 0 4px 0', fontSize: '1rem', color: '#0f172a', fontWeight: 600 }}>Importing data</h2>
            <p style={{ margin: '0 0 22px 0', color: '#64748b', fontSize: '0.8rem' }}>
              {importProgress.current} of {importProgress.total} records processed
            </p>

            <div style={{ maxWidth: '360px', margin: '0 auto' }}>
              <div style={{ height: '6px', backgroundColor: '#f1f5f9', borderRadius: '3px', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${(importProgress.current / importProgress.total) * 100}%`,
                    height: '100%',
                    backgroundColor: '#0f172a',
                    transition: 'width 0.3s ease',
                    borderRadius: '3px'
                  }}
                />
              </div>
              <div style={{ marginTop: '8px', fontSize: '0.75rem', color: '#475569', fontWeight: 500, fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, monospace' }}>
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
            <div style={{ width: '48px', height: '48px', borderRadius: '50%', backgroundColor: '#ecfdf5', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
              <CheckCircle size={26} strokeWidth={2} color="#10b981" />
            </div>
            <h2 style={{ margin: '0 0 6px 0', fontSize: '1.05rem', color: '#0f172a', fontWeight: 600 }}>Import complete</h2>
            <p style={{ margin: '0 0 22px 0', color: '#64748b', fontSize: '0.8rem' }}>
              <strong style={{ color: '#10b981', fontWeight: 600 }}>{importProgress.successCount}</strong> records imported successfully to <strong style={{ color: '#0f172a', fontWeight: 600 }}>{selectedCollection}</strong>
              {importProgress.errors.length > 0 && (
                <span>, <strong style={{ color: '#ef4444', fontWeight: 600 }}>{importProgress.errors.length}</strong> errors</span>
              )}
            </p>

            {importProgress.errors.length > 0 && (
              <details style={{ textAlign: 'left', maxWidth: '560px', margin: '0 auto 22px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '12px 14px' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#991b1b', fontSize: '0.8rem' }}>
                  Show {importProgress.errors.length} errors
                </summary>
                <div style={{ marginTop: '10px', maxHeight: '200px', overflowY: 'auto' }}>
                  {importProgress.errors.map((err, i) => (
                    <div key={i} style={{ fontSize: '0.75rem', color: '#7f1d1d', padding: '4px 0', borderBottom: i < importProgress.errors.length - 1 ? '1px solid #fecaca' : 'none' }}>
                      <strong style={{ fontWeight: 600 }}>Row {err.row}:</strong> {err.message}
                    </div>
                  ))}
                </div>
              </details>
            )}

            <button onClick={handleReset} className="di-btn-primary" style={s.btnPrimary}>
              <RotateCcw size={14} /> Import Another File
            </button>
          </div>
        </div>
      )}
    </div>
  );
}