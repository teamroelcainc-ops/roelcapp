import { useMemo, useRef, useState, type ReactNode } from 'react';
import { FileUp, Upload } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Badge } from '../ui/Badge';
import { createDocument, setDocument } from '../../services/firestoreService';
import {
  normalizeHeader,
  normalizeText,
  parseCsv,
  parseCsvBool,
  inferDateOrder,
  parseCsvDate,
  parseCsvNumber,
  type DateOrder,
} from '../../services/csv';
import { COLLECTIONS, buildRefLabel } from '../../config/collections';
import type { RefMaps } from '../../hooks/useRefMaps';
import type { EntityData, FieldConfig, FieldValue } from '../../types/models';
import './ImportCsvModal.css';

interface ImportCsvModalProps {
  title: string;
  collection: string;
  fields: FieldConfig[];
  refMaps: RefMaps;
  /** Campo que se llena con el uid del usuario actual (si el módulo lo define). */
  autoUserField?: string;
  currentUid: string | null;
  /**
   * Escritor personalizado por fila (p. ej. usuarios, que además crean cuenta
   * en Firebase Auth). Si no se define, se escribe directo a la colección.
   */
  writeRow?: (docId: string | null, values: Record<string, FieldValue>) => Promise<void>;
  /** Acción extra en la zona de selección de archivo (p. ej. descargar plantilla). */
  headerExtra?: ReactNode;
  /**
   * Habilita el modo "actualizar existentes casando por nombre": junto con
   * `existingRows` permite palomear la opción que actualiza SOLO registros ya
   * dados de alta (los que no casan se saltan; nunca se crea ni duplica).
   */
  matchField?: { key: string; label: string; textField?: string };
  /** Registros actuales del módulo, para casar contra ellos. */
  existingRows?: EntityData[];
  onClose: () => void;
}

interface PreparedRow {
  index: number;
  /** ID de AppSheet (columna ID del CSV). Null = Firestore genera uno. */
  docId: string | null;
  values: Record<string, FieldValue>;
  display: string[];
  errors: string[];
  /** Avisos no bloqueantes (la fila SÍ se importa). */
  warnings: string[];
}

type Phase = 'pick' | 'preview' | 'importing' | 'done';

const AMBIGUOUS = '__AMBIGUO__';
const PREVIEW_LIMIT = 60;

/** "2,23135E+13" | "1.9E+14": número colapsado por Excel/Sheets — dato perdido. */
/** Nombre legible de cada colección para los avisos del importador. */
const COLLECTION_LABELS: Record<string, string> = {
  [COLLECTIONS.entities]: 'Entities',
  [COLLECTIONS.stations]: 'Stations',
  [COLLECTIONS.trucks]: 'Trucks',
  [COLLECTIONS.drivers]: 'Drivers',
  [COLLECTIONS.assets]: 'Assets',
  [COLLECTIONS.users]: 'Users',
  [COLLECTIONS.routes]: 'Routes',
  [COLLECTIONS.team]: 'Team',
  [COLLECTIONS.sizes]: 'Sizes',
  [COLLECTIONS.uniformItems]: 'Uniform items',
  [COLLECTIONS.requestTypes]: 'Request types',
  [COLLECTIONS.shopNames]: 'Shops',
  [COLLECTIONS.vendors]: 'Vendors',
  [COLLECTIONS.driverCategories]: 'Driver categories',
};

const SCIENTIFIC_NOTATION = /^\d+([.,]\d+)?E[+-]?\d+$/i;

/** Índices nombre-normalizado -> id por colección referenciada. */
function buildRefIndexes(refMaps: RefMaps) {
  const indexes: Record<
    string,
    { ids: Set<string>; exact: Map<string, string>; loose: Map<string, string> }
  > = {};
  Object.entries(refMaps).forEach(([collectionName, data]) => {
    const ids = new Set<string>();
    const exact = new Map<string, string>();
    const loose = new Map<string, string>();
    data.rows.forEach((row) => {
      ids.add(row.id);
      exact.set(normalizeText(buildRefLabel(collectionName, row)), row.id);
      Object.entries(row).forEach(([key, value]) => {
        if (key === 'id' || key === 'createdAt' || key === 'updatedAt') return;
        if (typeof value !== 'string' || value.trim() === '') return;
        const normalized = normalizeText(value);
        const existing = loose.get(normalized);
        if (existing !== undefined && existing !== row.id) {
          loose.set(normalized, AMBIGUOUS);
        } else {
          loose.set(normalized, row.id);
        }
      });
    });
    indexes[collectionName] = { ids, exact, loose };
  });
  return indexes;
}

/**
 * Importador CSV genérico: valida obligatorios, enums, fechas, números y
 * referencias por NOMBRE antes de escribir. Solo importa filas válidas.
 * Reutilizado por todos los módulos y catálogos.
 */
export function ImportCsvModal({
  title,
  collection,
  fields,
  refMaps,
  autoUserField,
  currentUid,
  writeRow,
  headerExtra,
  matchField,
  existingRows,
  onClose,
}: ImportCsvModalProps) {
  const [phase, setPhase] = useState<Phase>('pick');
  const [fileName, setFileName] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PreparedRow[]>([]);
  const [missingColumns, setMissingColumns] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [imported, setImported] = useState(0);
  const [failures, setFailures] = useState<{ index: number; message: string }[]>([]);
  const [hasIdColumn, setHasIdColumn] = useState(false);
  /** Claves de los campos que SÍ vienen en el archivo (para el previo). */
  const [presentKeys, setPresentKeys] = useState<Set<string> | null>(null);
  /** true = actualiza solo las columnas del archivo y conserva el resto. */
  const [partialUpdate, setPartialUpdate] = useState(false);
  /** true = casa por nombre contra los registros existentes; nunca crea. */
  const [matchUpdate, setMatchUpdate] = useState(false);
  /**
   * En modo casado: true = las columnas del archivo REEMPLAZAN el valor
   * actual (renombrar en lote); false (por omisión) = solo llenan vacíos.
   */
  const [replaceValues, setReplaceValues] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const refIndexes = useMemo(() => buildRefIndexes(refMaps), [refMaps]);
  const validRows = prepared.filter((r) => r.errors.length === 0);

  const convertCell = (
    field: FieldConfig,
    raw: string,
    dateOrder: DateOrder = 'dmy',
  ): { value: FieldValue; error?: string; warning?: string } => {
    const trimmed = raw.trim();
    if (trimmed === '') {
      if (field.required) return { value: null, error: `"${field.label}" is required` };
      return { value: field.type === 'bool' ? false : null };
    }
    switch (field.type) {
      case 'number':
      case 'currency': {
        const value = parseCsvNumber(trimmed);
        return value === null
          ? { value: null, error: `"${field.label}": "${trimmed}" is not a number` }
          : { value };
      }
      case 'date': {
        const value = parseCsvDate(trimmed, dateOrder);
        return value === null
          ? {
              value: null,
              error: `"${field.label}": "${trimmed}" is not a date (use DD/MM/YYYY or MM/DD/YYYY)`,
            }
          : { value };
      }
      case 'bool': {
        const value = parseCsvBool(trimmed);
        return value === null
          ? { value: null, error: `"${field.label}": use YES or NO` }
          : { value };
      }
      case 'enum': {
        const match = (field.enumValues ?? []).find(
          (option) => normalizeText(option) === normalizeText(trimmed),
        );
        return match === undefined
          ? {
              value: null,
              error: `"${field.label}": "${trimmed}" is not one of: ${(field.enumValues ?? []).join(', ')}`,
            }
          : { value: match };
      }
      case 'ref': {
        const index = field.refCollection ? refIndexes[field.refCollection] : undefined;
        if (!index) return { value: null, error: `"${field.label}": catalog not available` };
        // Primero: ¿es directamente un ID existente (AppSheet)?
        if (index.ids.has(trimmed)) return { value: trimmed };
        const normalized = normalizeText(trimmed);
        const exactId = index.exact.get(normalized);
        if (exactId !== undefined) return { value: exactId };
        const looseId = index.loose.get(normalized);
        if (looseId === AMBIGUOUS) {
          return { value: null, error: `"${field.label}": "${trimmed}" is ambiguous, use the full name` };
        }
        if (looseId !== undefined) return { value: looseId };
        // ¿El valor existe como ID en OTRA colección? Casi siempre significa
        // que dos columnas del CSV están intercambiadas.
        const otherCollection = Object.entries(refIndexes).find(
          ([name, other]) => name !== field.refCollection && other.ids.has(trimmed),
        );
        if (otherCollection) {
          const otherLabel = COLLECTION_LABELS[otherCollection[0]] ?? otherCollection[0];
          return {
            value: trimmed,
            warning: `"${field.label}": "${trimmed}" is not in this catalog, but it does exist in ${otherLabel} — check whether those two columns are swapped in your file`,
          };
        }
        // Referencia a un registro que aún no existe (p. ej. driver dado de baja
        // que no viene en tu CSV): se guarda el ID tal cual y se resolverá solo
        // cuando importes ese registro con el mismo ID de AppSheet.
        return {
          value: trimmed,
          warning: `"${field.label}": "${trimmed}" does not exist yet — it will be saved and resolved once you import that record`,
        };
      }
      default:
        if (SCIENTIFIC_NOTATION.test(trimmed)) {
          return {
            value: null,
            error: `"${field.label}": "${trimmed}" is Excel scientific notation — format that column as Plain text in your sheet and re-export the CSV`,
          };
        }
        return { value: trimmed };
    }
  };

  /**
   * Forma canónica de un nombre para casar "ADAMS, Rayjohnal" con
   * "Adams Rayjohnal" o "Rayjohnal Adams": minúsculas, sin acentos ni
   * signos, espacios colapsados; la segunda forma ordena las palabras para
   * ignorar el orden apellido/nombre.
   */
  const canonicalName = (value: string): string =>
    normalizeText(value)
      .replace(/[^a-z0-9ñ ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const sortedName = (value: string): string => canonicalName(value).split(' ').sort().join(' ');

  const handleFile = async (file: File) => {
    setFileError(null);
    setFileName(file.name);
    const text = await file.text();
    const { headers, rows } = parseCsv(text);
    if (headers.length === 0 || rows.length === 0) {
      setFileError('The file is empty or has no data rows');
      return;
    }

    const columnByField = new Map<string, number>();
    const normalizedHeaders = headers.map((h) => normalizeHeader(h));
    fields.forEach((field) => {
      // Se acepta la etiqueta del campo o cualquiera de sus nombres alternos.
      const candidates = [field.label, ...(field.importAliases ?? [])].map((name) =>
        normalizeHeader(name),
      );
      const idx = normalizedHeaders.findIndex((h) => candidates.includes(h));
      if (idx !== -1) columnByField.set(field.key, idx);
    });
    const idColumnIndex = normalizedHeaders.findIndex((h) => h === 'id');

    const matchMode = matchUpdate && matchField !== undefined && existingRows !== undefined;
    if (matchMode && !columnByField.has(matchField.key)) {
      setFileError(`To update by ${matchField.label} the file needs a "${matchField.label}" column`);
      return;
    }
    const missing =
      partialUpdate || matchMode
        ? []
        : fields.filter((f) => f.required && !columnByField.has(f.key)).map((f) => f.label);
    setMissingColumns(missing);
    if (missing.length > 0) {
      setFileError(null);
      setPrepared([]);
      setPhase('preview');
      return;
    }

    // Orden de fecha por columna: el archivo puede traer DD/MM en una y MM/DD en otra.
    const dateOrders = new Map<string, DateOrder>();
    fields.forEach((field) => {
      if (field.type !== 'date') return;
      const columnIndex = columnByField.get(field.key);
      if (columnIndex === undefined) return;
      const columnValues = rows.map((row) => row[columnIndex] ?? '');
      dateOrders.set(field.key, inferDateOrder(columnValues));
    });

    const seenIds = new Set<string>();
    const preparedRows: PreparedRow[] = rows.map((row, rowIndex) => {
      const values: Record<string, FieldValue> = {};
      const display: string[] = [];
      const errors: string[] = [];
      const warnings: string[] = [];
      /** Aviso por campo: permite sustituirlo si se detecta un cruce de columnas. */
      const warningByField = new Map<string, string>();

      let docId: string | null = null;
      if (idColumnIndex !== -1) {
        const rawId = (row[idColumnIndex] ?? '').trim();
        if (rawId !== '') {
          if (rawId.includes('/')) {
            errors.push('The ID cannot contain "/"');
          } else if (seenIds.has(rawId)) {
            // El ID ya venía en el archivo: la fila SÍ se importa, pero con un
            // identificador nuevo para no sobrescribir a la primera que lo usó.
            warnings.push(
              `ID "${rawId}" is repeated in the file — this row will be imported with a new ID`,
            );
          } else {
            seenIds.add(rawId);
            docId = rawId;
          }
        }
        display.push(rawId === '' ? '—' : rawId);
      }

      fields.forEach((field) => {
        const columnIndex = columnByField.get(field.key);
        if (columnIndex === undefined && (partialUpdate || matchMode)) return;
        const raw = columnIndex === undefined ? '' : (row[columnIndex] ?? '');
        const { value, error, warning } = convertCell(
          field,
          raw,
          dateOrders.get(field.key) ?? 'dmy',
        );
        values[field.key] = value;
        display.push(raw.trim() === '' ? '—' : raw.trim());
        if (error) errors.push(error);
        if (warning) warningByField.set(field.key, warning);
      });

      // Columnas intercambiadas: si el valor de A pertenece al catálogo de B y
      // el de B al catálogo de A, se corrige el cruce automáticamente.
      const refFields = fields.filter(
        (f) => f.type === 'ref' && f.refCollection && typeof values[f.key] === 'string',
      );
      for (let i = 0; i < refFields.length; i += 1) {
        for (let j = i + 1; j < refFields.length; j += 1) {
          const fieldA = refFields[i];
          const fieldB = refFields[j];
          if (fieldA.refCollection === fieldB.refCollection) continue;
          const valueA = values[fieldA.key];
          const valueB = values[fieldB.key];
          if (typeof valueA !== 'string' || typeof valueB !== 'string') continue;
          if (valueA === '' || valueB === '') continue;
          const indexA = refIndexes[fieldA.refCollection!];
          const indexB = refIndexes[fieldB.refCollection!];
          if (!indexA || !indexB) continue;
          // Cruce inequívoco: cada valor existe en el catálogo del otro campo.
          if (indexB.ids.has(valueA) && indexA.ids.has(valueB)) {
            values[fieldA.key] = valueB;
            values[fieldB.key] = valueA;
            warningByField.set(
              fieldA.key,
              `"${fieldA.label}" and "${fieldB.label}" were swapped in the file — corrected automatically`,
            );
            warningByField.delete(fieldB.key);
          }
        }
      }
      warningByField.forEach((message) => warnings.push(message));
      // Copia el nombre resuelto de las referencias marcadas con copyLabelTo.
      fields.forEach((field) => {
        if (!field.copyLabelTo || !field.refCollection) return;
        const chosen = values[field.key];
        if (typeof chosen === 'string' && chosen !== '') {
          values[field.copyLabelTo] =
            refMaps[field.refCollection]?.labels.get(chosen) ?? chosen;
        }
      });
      // ── Modo "actualizar existentes": casar la fila con su registro ──
      if (matchMode && matchField && existingRows) {
        const rawName = (row[columnByField.get(matchField.key) ?? -1] ?? '').trim();
        const resolved = values[matchField.key];
        const refCatalog = fields.find((f) => f.key === matchField.key)?.refCollection;
        const catalogIds = refCatalog ? refIndexes[refCatalog]?.ids : undefined;
        const resolvedIsId =
          typeof resolved === 'string' && resolved !== '' && catalogIds?.has(resolved) === true;

        /** 1º por la referencia resuelta; 2º por el nombre guardado en texto. */
        let matches = resolvedIsId
          ? existingRows.filter((record) => record[matchField.key] === resolved)
          : [];
        if (matches.length === 0 && rawName !== '') {
          const canonical = canonicalName(rawName);
          const sorted = sortedName(rawName);
          const nameOf = (record: EntityData): string => {
            const viaRef =
              refCatalog && typeof record[matchField.key] === 'string'
                ? (refMaps[refCatalog]?.labels.get(record[matchField.key] as string) ?? '')
                : '';
            const viaText =
              matchField.textField && typeof record[matchField.textField] === 'string'
                ? (record[matchField.textField] as string)
                : '';
            return viaRef !== '' ? viaRef : viaText;
          };
          matches = existingRows.filter((record) => canonicalName(nameOf(record)) === canonical);
          if (matches.length === 0) {
            matches = existingRows.filter((record) => sortedName(nameOf(record)) === sorted);
          }
        }

        // El aviso genérico "does not exist yet" del campo de nombre no aplica
        // en este modo (aquí se casa contra los registros existentes): fuera.
        const stale = warnings.findIndex((w) => w.startsWith(`"${matchField.label}"`));
        if (stale !== -1) warnings.splice(stale, 1);
        if (matches.length === 1) {
          docId = matches[0].id;
          if (!replaceValues) {
            // Solo se LLENAN campos vacíos: lo que el registro ya tiene
            // capturado en el app no se toca (Entity, Station, o cualquier
            // otro valor ya trabajado ahí manda sobre el archivo).
            const existing = matches[0];
            Object.keys(values).forEach((key) => {
              const current = existing[key];
              const isEmpty = current === null || current === undefined || current === '';
              if (!isEmpty) delete values[key];
            });
          }
          if (!resolvedIsId && (refCatalog !== undefined || !replaceValues)) {
            // El nombre casó por texto pero la referencia no resolvió: se
            // conserva la referencia y el nombre que el registro ya tiene.
            // (Con "replace" y un campo de TEXTO, el valor del archivo es
            // justamente el nombre nuevo: sí se escribe — renombrado.)
            delete values[matchField.key];
            const copyTo = fields.find((f) => f.key === matchField.key)?.copyLabelTo;
            if (copyTo) delete values[copyTo];
          }
          // Referencias de otras columnas que no resolvieron a catálogo: en
          // modo actualización no se guarda texto crudo; esa columna se deja
          // como está en el registro y se avisa.
          fields.forEach((field) => {
            if (field.type !== 'ref' || field.key === matchField.key) return;
            const value = values[field.key];
            if (typeof value !== 'string' || value === '') return;
            const ids = field.refCollection ? refIndexes[field.refCollection]?.ids : undefined;
            if (ids && !ids.has(value)) {
              delete values[field.key];
              warnings.push(
                `"${field.label}": "${value}" is not in the catalog — that column was left unchanged for this row`,
              );
            }
          });
        } else if (matches.length > 1) {
          errors.push(
            `${matchField.label} "${rawName}" matches ${matches.length} existing records — update it manually`,
          );
        } else {
          errors.push(
            `${matchField.label} "${rawName}" was not found among the existing records — in update mode nothing is created, so this row is skipped`,
          );
        }
      }

      return { index: rowIndex + 2, docId, values, display, errors, warnings };
    });
    setHasIdColumn(idColumnIndex !== -1);
    // El previo dibuja SOLO las columnas del archivo: dibujar las 28 del
    // módulo con valores salteados es lo que hacía ver "columnas corridas".
    setPresentKeys(
      partialUpdate || matchMode ? new Set([...columnByField.keys()]) : null,
    );
    setPrepared(preparedRows);
    setPhase('preview');
  };

  const handleImport = async () => {
    setPhase('importing');
    let count = 0;
    let processed = 0;
    const failed: { index: number; message: string }[] = [];
    const matchMode = matchUpdate && matchField !== undefined && existingRows !== undefined;
    for (const row of validRows) {
      const payload = { ...row.values };
      // El capturista de la sesión solo se usa cuando la fila no trae uno —
      // y nunca en modo actualización, donde se respeta el que ya quedó.
      if (autoUserField && currentUid && !matchMode) {
        const provided = payload[autoUserField];
        if (typeof provided !== 'string' || provided === '') {
          payload[autoUserField] = currentUid;
        }
      }
      try {
        if (matchMode) {
          // Solo actualiza lo casado; jamás crea un registro nuevo. Una celda
          // VACÍA del archivo significa "sin dato": no borra lo que el
          // registro ya tenga guardado en ese campo.
          if (!row.docId) throw new Error('Row without a matched record');
          Object.keys(payload).forEach((key) => {
            if (payload[key] === null || payload[key] === '') delete payload[key];
          });
          await setDocument(collection, row.docId, payload, true);
        } else if (writeRow) {
          await writeRow(row.docId, payload);
        } else if (row.docId) {
          await setDocument(collection, row.docId, payload, partialUpdate);
        } else {
          await createDocument(collection, payload);
        }
        count += 1;
      } catch (err) {
        failed.push({
          index: row.index,
          message: err instanceof Error ? err.message : 'Could not save',
        });
      }
      processed += 1;
      setProgress(processed);
    }
    setImported(count);
    setFailures(failed);
    setPhase('done');
  };

  const errorRows = prepared.filter((r) => r.errors.length > 0);
  const warningRows = prepared.filter((r) => r.errors.length === 0 && r.warnings.length > 0);

  return (
    <Modal open title={`Import CSV · ${title}`} onClose={onClose} size="lg"
      footer={
        phase === 'preview' && missingColumns.length === 0 ? (
          <>
            <span className="imp-footer-info">
              {validRows.length} rows ready · {errorRows.length} with errors
          {matchUpdate ? ` · update by match (${replaceValues ? 'REPLACING values' : 'fill empty only'}, no new records)` : partialUpdate ? ' · partial update' : ''}
            </span>
            <button type="button" className="btn btn-outline" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleImport()}
              disabled={validRows.length === 0}
            >
              <Upload size={16} />
              Import {validRows.length} rows
            </button>
          </>
        ) : phase === 'done' ? (
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        ) : undefined
      }
    >
      {phase === 'pick' ? (
        <div className="imp-pick">
          <button type="button" className="imp-drop" onClick={() => inputRef.current?.click()}>
            <FileUp size={30} />
            <strong>Select the CSV file</strong>
            <span>Exported from Google Sheets: File → Download → CSV</span>
            {headerExtra ? <div className="imp-drop-extra">{headerExtra}</div> : null}
            <label className="imp-partial" onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={partialUpdate}
                onChange={(e) => setPartialUpdate(e.target.checked)}
              />
              <span>
                <strong>Update only the columns in this file</strong>
                <small>
                  Rows are matched by their ID and the fields you don&apos;t include keep their
                  current value. Ideal to update just one column.
                </small>
              </span>
            </label>
            {matchField && existingRows ? (
              <label className="imp-partial" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={matchUpdate}
                  onChange={(e) => setMatchUpdate(e.target.checked)}
                />
                <span>
                  <strong>Update existing records by {matchField.label}</strong>
                  <small>
                    Rows are matched by the name in the &quot;{matchField.label}&quot; column
                    (surname/first-name order and capitals don&apos;t matter). It only FILLS
                    fields that are currently empty in the app — values already captured are
                    never replaced — rows that don&apos;t match are skipped, and{' '}
                    <strong>nothing new is ever created or duplicated</strong>.
                  </small>
                </span>
              </label>
            ) : null}
            {matchField && existingRows && matchUpdate ? (
              <label className="imp-partial imp-sub" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={replaceValues}
                  onChange={(e) => setReplaceValues(e.target.checked)}
                />
                <span>
                  <strong>Also REPLACE values that already exist</strong>
                  <small>
                    The columns in the file overwrite the current value (used to fix names in
                    bulk). Empty cells still never erase anything, and nothing new is created.
                  </small>
                </span>
              </label>
            ) : null}
            {fileName ? <em>{fileName}</em> : null}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="imp-file-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
          {fileError ? <p className="imp-error">{fileError}</p> : null}

          <div className="imp-guide">
            <h3>Filling guide</h3>
            <p className="imp-guide-note">
              Optional <strong>ID</strong> column: the AppSheet ID. When present it becomes the
              identifier (re-importing with the same ID updates instead of duplicating) and
              reference columns accept that ID or the name.
            </p>
            <table>
              <thead>
                <tr>
                  <th>Column</th>
                  <th>Required</th>
                  <th>Format / allowed values</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((field) => (
                  <tr key={field.key}>
                    <td>{field.label}</td>
                    <td>{field.required ? 'Yes' : 'No'}</td>
                    <td>
                      {field.type === 'enum'
                        ? (field.enumValues ?? []).join(', ')
                        : field.type === 'date'
                          ? 'DD/MM/YYYY'
                          : field.type === 'bool'
                            ? 'YES or NO'
                            : field.type === 'ref'
                              ? 'Exact name as shown in the app'
                              : field.type === 'number' || field.type === 'currency'
                                ? 'Number'
                                : 'Text'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {phase === 'preview' && missingColumns.length > 0 ? (
        <div className="imp-missing">
          <p className="imp-error">
            The CSV is missing these required columns: {missingColumns.join(', ')}
          </p>
          <button type="button" className="btn btn-outline" onClick={() => setPhase('pick')}>
            Choose another file
          </button>
        </div>
      ) : null}

      {phase === 'preview' && missingColumns.length === 0 ? (
        <div className="imp-preview">
          {errorRows.length > 0 ? (
            <div className="imp-errors-box">
              <strong>Rows with errors (they will NOT be imported):</strong>
              <ul>
                {errorRows.slice(0, 12).map((row) => (
                  <li key={row.index}>
                    Row {row.index}: {row.errors.join(' · ')}
                  </li>
                ))}
                {errorRows.length > 12 ? <li>…and {errorRows.length - 12} more</li> : null}
              </ul>
            </div>
          ) : null}
          {warningRows.length > 0 ? (
            <div className="imp-warnings-box">
              <strong>
                Rows with warnings (they ARE imported; the references will resolve once you
                import those records):
              </strong>
              <ul>
                {warningRows.slice(0, 8).map((row) => (
                  <li key={row.index}>
                    Row {row.index}: {row.warnings.join(' · ')}
                  </li>
                ))}
                {warningRows.length > 8 ? <li>…and {warningRows.length - 8} more</li> : null}
              </ul>
            </div>
          ) : null}
          <div className="imp-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Status</th>
                  {hasIdColumn ? <th>ID</th> : null}
                  {fields
                    .filter((f) => presentKeys === null || presentKeys.has(f.key))
                    .map((f) => (
                      <th key={f.key}>{f.label}</th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {prepared.slice(0, PREVIEW_LIMIT).map((row) => (
                  <tr key={row.index} className={row.errors.length > 0 ? 'is-invalid' : ''}>
                    <td>{row.index}</td>
                    <td>
                      <Badge
                        value={
                          row.errors.length > 0 ? 'MAL' : row.warnings.length > 0 ? 'AVISO' : 'OK'
                        }
                      />
                    </td>
                    {row.display.map((cell, i) => (
                      <td key={i}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {prepared.length > PREVIEW_LIMIT ? (
            <p className="imp-more">Showing {PREVIEW_LIMIT} of {prepared.length} rows</p>
          ) : null}
        </div>
      ) : null}

      {phase === 'importing' ? (
        <p className="imp-progress">
          Importing… {progress} of {validRows.length}
        </p>
      ) : null}

      {phase === 'done' ? (
        <div className="imp-done">
          <p className="imp-done-ok">
            ✔ {imported} records imported into {title}
            {hasIdColumn ? ' (rows with an existing ID were updated)' : ''}.
          </p>
          {errorRows.length > 0 ? (
            <p>
              {errorRows.length} rows were left out due to errors: fix them in your sheet and
              re-import just those.
            </p>
          ) : null}
          {failures.length > 0 ? (
            <div className="imp-errors-box">
              <strong>{failures.length} rows failed to save:</strong>
              <ul>
                {failures.slice(0, 10).map((f) => (
                  <li key={f.index}>
                    Row {f.index}: {f.message}
                  </li>
                ))}
                {failures.length > 10 ? <li>…and {failures.length - 10} more</li> : null}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}