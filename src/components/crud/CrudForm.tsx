import { ChevronLeft, ChevronRight, Columns3, Settings2 } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Modal } from '../ui/Modal';
import { FormField } from '../ui/FormField';
import {
  ACTIVE_FLAG_BY_COLLECTION,
  STATION_KEY_BY_COLLECTION,
  isActiveRecord,
} from '../../services/activeStatus';
import { QuickAddRefModal } from '../ui/QuickAddRefModal';
import { QuickEditRefModal } from '../ui/QuickEditRefModal';
import { CRUD_MODULES, catalogModules } from '../../config/modules';
import { COLLECTIONS } from '../../config/collections';
import { useAuth } from '../../hooks/useAuth';
import { texasToday } from '../../services/captureWindow';
import { SaveSummary } from './SaveSummary';
import { displayCell, scalar } from './displayValue';
import type { SelectOption } from '../ui/SearchableSelect';
import type { RefMaps } from '../../hooks/useRefMaps';
import type { EntityData, FieldConfig, FieldValue, FormStep } from '../../types/models';
import './CrudForm.css';

interface CrudFormProps {
  open: boolean;
  title: string;
  fields: FieldConfig[];
  initial: EntityData | null;
  refMaps: RefMaps;
  busy: boolean;
  error: string | null;
  /** Se incrementa cuando un "Guardar y agregar otro" fue exitoso: limpia el formulario. */
  resetSignal: number;
  /** Si se define, muestra el botón para configurar campos obligatorios (permiso Customization). */
  onConfigure?: () => void;
  /** Clave del campo capturista (idUsers) cuando el rol puede editarlo en el formulario. */
  editableCapturedByKey?: string;
  /**
   * Campo del capturista. Siempre se MUESTRA, para que quien captura vea a
   * nombre de quién queda el registro; solo es editable si además llega en
   * `editableCapturedByKey`.
   */
  capturedByKey?: string;
  /** Uid del usuario actual: valor inicial del capturista en altas. */
  currentUid?: string | null;
  /** Valores iniciales extra en altas (p. ej. entidad/estación del usuario). */
  presetValues?: Record<string, FieldValue>;
  /**
   * Prellenado EXPLÍCITO de un alta (p. ej. un mantenimiento creado desde el
   * Fleet Report): a diferencia de presetValues, SÍ reemplaza los valores
   * por defecto, para no volver a escribir lo que ya se capturó.
   */
  prefillValues?: Record<string, FieldValue>;
  /** Contenido extra bajo el formulario (p. ej. los uniformes ya cargados). */
  extraSection?: ReactNode;
  /**
   * Igual que extraSection, pero recibe lo capturado hasta ahora: sirve para
   * secciones que solo aplican según un valor del propio formulario (la
   * subtabla de uniformes aparece al elegir tipo de solicitud "Uniforms").
   */
  renderExtra?: (values: Record<string, FieldValue>) => ReactNode;
  /** Id del módulo dueño del formulario, para resolver sus permisos. */
  ownerModuleId?: string;
  /** Pestañas del alta. Sin esto el formulario se muestra completo, como antes. */
  steps?: FormStep[];
  /** Abre el editor de pestañas (solo administradores). */
  onConfigureSteps?: () => void;
  /** Aviso en vivo que depende de lo capturado (p. ej. existencia disponible). */
  renderBanner?: (values: Record<string, FieldValue>) => ReactNode;
  /** Alcance (entidad/estación) por usuario, para rellenar al elegir capturista. */
  userScopes?: Record<string, { entity: string | null; station: string | null }>;
  /** Si el rol NO puede editar Entity/Station, esos campos se muestran bloqueados. */
  contextEditable?: boolean;
  /**
   * Opciones que hoy NO se pueden elegir en un campo de referencia, con el
   * motivo (clave del campo -> id -> motivo). Salen del desplegable y, si de
   * todos modos llegan al guardar (el valor ya estaba puesto), se rechazan
   * mostrando el motivo. Sirve para el camión que ya entró en otro BC Report
   * de la misma ventana, o el que está en taller.
   */
  blockedRefs?: Record<string, Map<string, string>>;
  onClose: () => void;
  onSubmit: (values: Record<string, FieldValue>, keepOpen: boolean) => void;
}

function buildInitialValues(fields: FieldConfig[], initial: EntityData | null) {
  const values: Record<string, FieldValue> = {};
  fields.forEach((field) => {
    if (initial && field.key in initial) {
      values[field.key] = scalar(initial[field.key]);
    } else if (field.defaultValue !== undefined) {
      values[field.key] = field.defaultValue;
    } else if (field.type === 'bool') {
      values[field.key] = false;
    } else if (field.type === 'date' && field.required) {
      // Las fechas del app son las de Texas, entre desde donde entre el usuario.
      values[field.key] = texasToday();
    } else {
      values[field.key] = field.type === 'number' || field.type === 'currency' ? null : '';
    }
  });
  return values;
}

function isEmpty(value: FieldValue): boolean {
  return value === null || value === '' || value === undefined;
}

/**
 * Formulario modal genérico: valida requeridos con resaltado rojo
 * y bloquea el guardado hasta que estén completos.
 */
export function CrudForm({
  open,
  title,
  fields,
  initial,
  refMaps,
  busy,
  error,
  resetSignal,
  onConfigure,
  editableCapturedByKey,
  capturedByKey,
  currentUid,
  presetValues,
  prefillValues,
  userScopes,
  extraSection,
  renderExtra,
  steps,
  ownerModuleId,
  onConfigureSteps,
  renderBanner,
  contextEditable = true,
  blockedRefs,
  onClose,
  onSubmit,
}: CrudFormProps) {
  const [values, setValues] = useState<Record<string, FieldValue>>({});
  const [touchedSubmit, setTouchedSubmit] = useState(false);
  /** Motivo por el que no se dejó guardar (p. ej. camión ya capturado). */
  const [blockedError, setBlockedError] = useState<string | null>(null);

  /** Campos que sí se capturan (los form:false los llena el sistema),
      más el capturista cuando el rol tiene permiso de editarlo. */
  /**
   * Campos que forman el registro guardado. Incluye los que no se muestran en
   * el alta (hideOnCreate) para que conserven su valor por omisión; excluye
   * los calculados, que no se persisten.
   */
  const valueFields = useMemo(() => fields.filter((f) => f.compute === undefined), [fields]);

  const formFields = useMemo(
    () =>
      fields.filter((f) => {
        if (f.compute) return false;
        if (f.form === false) return f.key === editableCapturedByKey || f.key === capturedByKey;
        // Se pide solo al editar: en el alta toma su valor por omisión.
        if (f.hideOnCreate && initial === null) return false;
        return true;
      }),
    [fields, editableCapturedByKey, capturedByKey, initial],
  );

  useEffect(() => {
    if (open) {
      setStepIndex(0);
      const base = buildInitialValues(valueFields, initial);
      // Alta: las fechas de registro arrancan en el día de hoy (hora de Texas).
      if (!initial) {
        const iso = texasToday();
        valueFields.forEach((field) => {
          if (field.defaultToday && (base[field.key] === null || base[field.key] === '')) {
            base[field.key] = iso;
          }
        });
      }
      // Alta: el capturista arranca con los datos del usuario actual.
      const ownerKey = editableCapturedByKey ?? capturedByKey;
      if (!initial && ownerKey && currentUid) {
        base[ownerKey] = currentUid;
      }
      // Alta: valores del alcance del usuario (su entidad/estación).
      if (!initial && presetValues) {
        Object.entries(presetValues).forEach(([key, value]) => {
          if (value !== null && value !== '' && key in base && (base[key] === null || base[key] === '')) {
            base[key] = value;
          }
        });
      }
      // Alta con prellenado explícito: manda sobre los valores por defecto.
      if (!initial && prefillValues) {
        Object.entries(prefillValues).forEach(([key, value]) => {
          if (key in base && value !== null && value !== '') base[key] = value;
        });
      }
      // Entidad y estación del capturista: hasta ahora solo se rellenaban al
      // CAMBIAR el capturista, así que en un alta normal quedaban vacías.
      if (!initial) {
        const ownerId = base[editableCapturedByKey ?? capturedByKey ?? ''];
        const scope = typeof ownerId === 'string' ? userScopes?.[ownerId] : undefined;
        if (scope) {
          valueFields.forEach((f) => {
            if (f.defaultFromUserScope === 'entity' && scope.entity && !base[f.key]) {
              base[f.key] = scope.entity;
            }
            if (f.defaultFromUserScope === 'station' && scope.station && !base[f.key]) {
              base[f.key] = scope.station;
            }
          });
        }
      }
      setValues(base);
      setTouchedSubmit(false);
      setBlockedError(null);
    }
  }, [
    open,
    valueFields,
    initial,
    resetSignal,
    editableCapturedByKey,
    capturedByKey,
    currentUid,
    presetValues,
    prefillValues,
    userScopes,
  ]);

  const { can, canOr, isAdminView, profile, role, viewAs } = useAuth();
  /**
   * Estaciones del usuario EFECTIVO (el simulado en View as): acotan los
   * desplegables de camiones a su Current station. Admin y oficina ven todo.
   */
  const effectiveScope = viewAs ?? profile;
  const optionScopeStations = useMemo(
    () =>
      isAdminView || effectiveScope?.isOffice === true ? [] : (effectiveScope?.scopeStations ?? []),
    [isAdminView, effectiveScope],
  );

  /**
   * Estaciones a las que el usuario está limitado. Vacío = sin límite (admin,
   * personal de oficina o alcance "All"), y entonces se ofrece todo.
   */
  const scopeStations = useMemo(() => {
    if (isAdminView || profile?.isOffice === true) return [];
    if (ownerModuleId === undefined) return [];
    const alcance = role?.permissions?.[ownerModuleId]?.alcance ?? 'all';
    if (alcance !== 'station' && alcance !== 'entity_station') return [];
    return profile?.scopeStations ?? [];
  }, [isAdminView, profile, role, ownerModuleId]);

  const refOptionsByField = useMemo(() => {
    const map: Record<string, SelectOption[]> = {};
    formFields.forEach((field) => {
      if (field.type !== 'ref' || !field.refCollection) return;
      const refData = refMaps[field.refCollection];
      if (!refData) {
        map[field.key] = [];
        return;
      }
      let rows = refData.rows;
      // Los registros INACTIVOS no se ofrecen; si el registro que se edita
      // ya apuntaba a uno, ese se conserva para no vaciar el campo.
      const activeFlag = ACTIVE_FLAG_BY_COLLECTION[field.refCollection];
      if (activeFlag) {
        const current = values[field.key];
        rows = rows.filter((row) => isActiveRecord(row, activeFlag) || row.id === current);
      }
      // Camiones: solo los de la Current station del usuario (el ya elegido
      // en un registro viejo se conserva para no vaciar el campo).
      const stationKey = STATION_KEY_BY_COLLECTION[field.refCollection];
      if (stationKey && optionScopeStations.length > 0) {
        const current = values[field.key];
        rows = rows.filter((row) => {
          const st = row[stationKey];
          return (
            (typeof st === 'string' && optionScopeStations.includes(st)) || row.id === current
          );
        });
      }
      // Filtro fijo, o dependiente del valor actual de otro campo del formulario.
      let filter = field.refFilter;
      if (field.refFilterFromField) {
        const source = values[field.refFilterFromField.field];
        const mapped =
          typeof source === 'string' ? field.refFilterFromField.map[source] : undefined;
        filter = mapped ? { field: field.refFilterFromField.targetField, value: mapped } : undefined;
      }
      // Filtro tomado del registro referenciado por otro campo
      // (p. ej. las tallas del tipo que usa la prenda elegida).
      if (field.refFilterFromRefField) {
        const spec = field.refFilterFromRefField;
        const sourceField = fields.find((f) => f.key === spec.field);
        const sourceId = values[spec.field];
        const sourceRows =
          sourceField?.refCollection ? refMaps[sourceField.refCollection]?.rows : undefined;
        const sourceRow =
          typeof sourceId === 'string' ? sourceRows?.find((r) => r.id === sourceId) : undefined;
        const targetValue = sourceRow?.[spec.sourceField];
        filter =
          typeof targetValue === 'string' && targetValue !== ''
            ? { field: spec.targetField, value: targetValue }
            : undefined;
      }
      if (filter) {
        // Comparación sin distinguir mayúsculas: los datos migrados traen
        // "Scanner"/"Truck" y la configuración usa "SCANNER"/"TRUCK".
        const target = String(filter.value).toUpperCase();
        const filterKey = filter.field;
        rows = rows.filter((r) => String(r[filterKey] ?? '').toUpperCase() === target);
      }
      // Alcance por estación: si el rol solo ve lo de su estación, tampoco
      // debe poder ELEGIR algo de otra. Se filtra por el campo de estación
      // del catálogo apuntado (el marcado con scopeKey, o cualquiera que
      // apunte al catálogo de estaciones).
      // Los catálogos abiertos a todos (Drivers, Assets/escáneres) NO se
      // acotan aunque el rol marque Station/Entity+Station.
      const targetModule = CRUD_MODULES.find((m) => m.collection === field.refCollection);
      if (scopeStations.length > 0 && targetModule?.alwaysVisible !== true) {
        const target = targetModule;
        const stationKeys = (target?.fields ?? [])
          .filter(
            (f) =>
              f.scopeKey === 'station' ||
              (f.scopeKey === undefined && f.type === 'ref' && f.refCollection === COLLECTIONS.stations),
          )
          .map((f) => f.key);
        if (stationKeys.length > 0) {
          rows = rows.filter((r) =>
            stationKeys.some((key) => {
              const value = r[key];
              return typeof value === 'string' && scopeStations.includes(value);
            }),
          );
        }
      }
      // Opciones bloqueadas (ya capturadas en la ventana, en taller…): fuera
      // del desplegable. La que ya estaba elegida se conserva para que el
      // formulario la muestre y el guardado explique por qué no procede.
      const blocked = blockedRefs?.[field.key];
      if (blocked && blocked.size > 0) {
        const chosen = values[field.key];
        rows = rows.filter((r) => !blocked.has(r.id) || r.id === chosen);
      }
      map[field.key] = rows
        .map((r) => ({ value: r.id, label: refData.labels.get(r.id) ?? r.id }))
        .sort((a, b) => a.label.localeCompare(b.label));
    });
    return map;
  }, [formFields, fields, refMaps, values, scopeStations, blockedRefs, optionScopeStations]);

  /** Diferencia de millaje en vivo: Next mant − Actual Mileage. */
  const mileageDiff = useMemo(() => {
    const hasBoth = 'nextMant' in values && 'mileage' in values;
    if (!hasBoth) return null;
    const next = values.nextMant;
    const current = values.mileage;
    if (typeof next !== 'number' || typeof current !== 'number') return null;
    return next - current;
  }, [values]);

  /** Campos visibles según las condiciones (p. ej. tipo Preventive/Corrective). */
  /** ¿Se cumple la condición de visibilidad de un campo? */
  const isVisible = (field: FieldConfig): boolean => {
    const rule = field.visibleWhen;
    if (!rule) return true;
    const current = values[rule.field];
    if (rule.refNameIn) {
      // Se compara contra el nombre del catálogo, no contra su id.
      const source = formFields.find((f) => f.key === rule.field);
      if (!source?.refCollection || typeof current !== 'string' || current === '') return false;
      const label = refMaps[source.refCollection]?.labels.get(current) ?? '';
      return rule.refNameIn.some((name) => name.toLowerCase() === label.trim().toLowerCase());
    }
    if (rule.valueIn) return rule.valueIn.includes(current);
    return current === rule.value;
  };

  const visibleFields = useMemo(
    () => formFields.filter(isVisible),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [formFields, values, refMaps],
  );

  /** Un campo se muestra bloqueado si es de solo lectura, o si ya se fijó al crear. */
  const canEditProtected =
    isAdminView || (ownerModuleId !== undefined && can(ownerModuleId, 'editarProtegidos'));

  const isLocked = (field: FieldConfig) =>
    // El capturista se ve siempre; solo se edita con el permiso correspondiente.
    (field.key === capturedByKey && field.key !== editableCapturedByKey) ||
    field.readOnly === true ||
    field.fixedOnCreate === true ||
    (field.lockedAfterCreate === true && initial !== null) ||
    // Campo protegido: se ve, pero solo lo edita quien tenga el permiso.
    (field.editRequiresAction === true && !canEditProtected);

  /**
   * Qué NO se reenvía al guardar. Un campo `fixedOnCreate` sí viaja en el alta
   * (es cuando el sistema lo fija); a partir de ahí queda intacto.
   */
  const isStripped = (field: FieldConfig) =>
    field.readOnly === true || (isLocked(field) && initial !== null);

  const missing = useMemo(
    () =>
      visibleFields
        .filter((f) => f.required && !isLocked(f) && isEmpty(values[f.key]))
        .map((f) => f.key),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleFields, values, initial],
  );

  const handleChange = (key: string, value: FieldValue) => {
    setBlockedError(null);
    setValues((prev) => {
      const next = { ...prev, [key]: value };
      // Al elegir una referencia, se copian los datos que dependen de ella
      // (p. ej. el Next mant del camión seleccionado).
      if (typeof value === 'string' && value !== '') {
        const sourceField = fields.find((f) => f.key === key);
        const sourceRows = sourceField?.refCollection
          ? refMaps[sourceField.refCollection]?.rows
          : undefined;
        const sourceRow = sourceRows?.find((r) => r.id === value);
        if (sourceRow) {
          fields.forEach((target) => {
            if (target.copyFromRefField?.field !== key) return;
            const copied = sourceRow[target.copyFromRefField.sourceField];
            next[target.key] =
              typeof copied === 'number' || typeof copied === 'string' ? copied : null;
          });
        }
      }
      // Al cambiar el capturista, Entity/Station se rellenan con SU asignación.
      if (key === editableCapturedByKey && typeof value === 'string' && userScopes) {
        const scope = userScopes[value];
        if (scope) {
          fields.forEach((f) => {
            if (f.defaultFromUserScope === 'entity' && scope.entity) next[f.key] = scope.entity;
            if (f.defaultFromUserScope === 'station' && scope.station) next[f.key] = scope.station;
          });
        }
      }
      return next;
    });
  };

  /**
   * Alta rápida: un campo de referencia muestra "+" cuando apunta a un
   * catálogo y el rol puede crear en él. Al guardar, el nuevo registro llega
   * solo a las opciones (los catálogos van suscritos en vivo) y se selecciona.
   */
  /**
   * Permiso para tocar los campos protegidos de ESTE módulo. Se resuelve una
   * vez y de ahí sale tanto el bloqueo visual como la exclusión al guardar.
   */
  const [quickAdd, setQuickAdd] = useState<FieldConfig | null>(null);
  /** Referencia cuyo registro seleccionado se está editando (el lápiz). */
  const [quickEdit, setQuickEdit] = useState<FieldConfig | null>(null);

  /**
   * Módulo destino del botón "+" de un campo de referencia, o null si este
   * rol no lo puede usar. El permiso se decide desde la matriz de Roles con
   * la acción "Quick add (+)"; los roles guardados antes de que existiera
   * heredan su permiso de crear, para que nadie pierda un botón que ya usaba.
   */
  const catalogFor = (field: FieldConfig) => {
    if (field.type !== 'ref' || !field.refCollection) return null;
    // Los catálogos se administran todos con el id 'catalogs': es con el que
    // CatalogosPage monta el motor y el único que existe en la matriz.
    const catalog = catalogModules.find((module) => module.collection === field.refCollection);
    const target =
      catalog ?? CRUD_MODULES.find((module) => module.collection === field.refCollection);
    if (!target) return null;
    const moduleId = catalog ? 'catalogs' : target.id;
    if (isAdminView) return target;
    return canOr(moduleId, 'altaRapida', 'crear') ? target : null;
  };

  /**
   * ¿Puede EDITAR el registro referenciado desde aquí (el lápiz)? Mismo
   * destino que el alta rápida, pero con el permiso de editar: corrige el
   * nombre de la persona de Team sin salir del formulario del driver.
   */
  const catalogEditFor = (field: FieldConfig) => {
    if (field.type !== 'ref' || !field.refCollection) return null;
    // Solo catálogos (Team, Stations…): editar un registro de un módulo
    // grande se hace en su propio módulo, no en un modal chico.
    const catalog = catalogModules.find((module) => module.collection === field.refCollection);
    if (!catalog) return null;
    if (isAdminView) return catalog;
    return canOr('catalogs', 'editar', 'editar') ? catalog : null;
  };

  /**
   * Reparto de los campos visibles por pestaña. Los que no estén asignados a
   * ningún paso se agregan al último: así, si se configura mal o se agrega un
   * campo nuevo al código, nunca desaparece del alta.
   */
  const [stepIndex, setStepIndex] = useState(0);

  const stepGroups = useMemo(() => {
    if (!steps || steps.length === 0) return null;
    const assigned = new Set(steps.flatMap((step) => step.fieldKeys));
    const leftovers = visibleFields.filter((field) => !assigned.has(field.key));
    return steps.map((step, index) => ({
      ...step,
      fields: [
        ...step.fieldKeys
          .map((key) => visibleFields.find((field) => field.key === key))
          .filter((field): field is FieldConfig => field !== undefined),
        ...(index === steps.length - 1 ? leftovers : []),
      ],
    }));
  }, [steps, visibleFields]);

  // Una pestaña sin campos (porque su bloque no aplica a este tipo) se salta.
  const activeGroups = useMemo(
    () => stepGroups?.filter((group) => group.fields.length > 0) ?? null,
    [stepGroups],
  );

  const current = activeGroups
    ? (activeGroups[Math.min(stepIndex, activeGroups.length - 1)] ?? null)
    : null;
  const shownFields = current ? current.fields : visibleFields;
  const isLastStep = !activeGroups || stepIndex >= activeGroups.length - 1;

  /** Campos obligatorios sin llenar dentro de la pestaña actual. */
  const missingHere = current
    ? missing.filter((key) => current.fields.some((field) => field.key === key))
    : missing;

  const handleSubmit = (keepOpen: boolean) => {
    setTouchedSubmit(true);
    if (missing.length > 0) return;
    // Un valor que hoy no se puede capturar (el camión ya está en otro BC
    // Report de esta ventana, o está en taller): se explica y no se guarda.
    if (blockedRefs) {
      for (const field of visibleFields) {
        const chosen = values[field.key];
        const reason = typeof chosen === 'string' ? blockedRefs[field.key]?.get(chosen) : undefined;
        if (reason) {
          setBlockedError(`${field.label} "${refLabel(field.refCollection ?? '', chosen as string)}": ${reason}.`);
          return;
        }
      }
    }
    setBlockedError(null);
    // Los campos de solo lectura los mantiene el sistema: no se reenvían para
    // no pisar un valor que pudo cambiar mientras el formulario estaba abierto.
    const payload = { ...values };
    fields.forEach((field) => {
      if (isStripped(field)) delete payload[field.key];
    });
    onSubmit(payload, keepOpen);
  };

  const refLabel = (collection: string, id: string): string =>
    refMaps[collection]?.labels.get(id) ?? '—';

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      size="lg"
      footer={
        <>
          {error || blockedError ? (
            <span className="crudform-error">{error ?? blockedError}</span>
          ) : null}
          {onConfigure ? (
            <button
              type="button"
              className="btn btn-outline crudform-config"
              title="Configure required fields, headers and order"
              onClick={onConfigure}
              disabled={busy}
            >
              <Settings2 size={15} />
              <span className="crud-btn-text">Required fields</span>
            </button>
          ) : null}
          {onConfigureSteps ? (
            <button
              type="button"
              className="btn btn-outline crudform-config"
              title="Name the tabs and choose which field goes in each one"
              onClick={onConfigureSteps}
              disabled={busy}
            >
              <Columns3 size={15} />
              <span className="crud-btn-text">Form steps</span>
            </button>
          ) : null}
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          {activeGroups && stepIndex > 0 ? (
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => setStepIndex((n) => Math.max(0, n - 1))}
              disabled={busy}
            >
              <ChevronLeft size={16} />
              Back
            </button>
          ) : null}
          {activeGroups && !isLastStep ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                // No se avanza dejando obligatorios sin llenar en este paso.
                setTouchedSubmit(true);
                if (missingHere.length > 0) return;
                setStepIndex((n) => Math.min(activeGroups.length - 1, n + 1));
              }}
              disabled={busy}
            >
              Next
              <ChevronRight size={16} />
            </button>
          ) : null}
          {initial === null && isLastStep ? (
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => handleSubmit(true)}
              disabled={busy}
            >
              {busy ? 'Saving…' : 'Save and add another'}
            </button>
          ) : null}
          {isLastStep ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => handleSubmit(false)}
            disabled={busy}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
          ) : null}
        </>
      }
    >
      <div className="crudform-layout">
        {activeGroups && activeGroups.length > 1 ? (
          <nav className="crudform-steps" aria-label="Form steps">
            {activeGroups.map((group, index) => (
              <button
                key={group.id}
                type="button"
                className={`crudform-step ${index === stepIndex ? 'is-active' : ''} ${
                  index < stepIndex ? 'is-done' : ''
                }`}
                onClick={() => setStepIndex(index)}
              >
                <span className="crudform-step-num">{index + 1}</span>
                {group.title}
              </button>
            ))}
          </nav>
        ) : null}
        <div className="crudform-grid">
          {shownFields.map((field) => {
            // Dato que mantiene el sistema (p. ej. el millaje actual del
            // camión): se muestra, pero no se captura.
            if (isLocked(field)) {
              return (
                <div key={field.key} className="crudform-locked">
                  <span className="crudform-locked-label">{field.label}</span>
                  <span
                    className="crudform-locked-value"
                    title={
                      field.key === capturedByKey
                        ? 'The record is saved under this user'
                        : field.readOnly
                        ? 'Kept up to date by the system'
                        : field.fixedOnCreate
                          ? 'Set automatically by the system and cannot be changed'
                          : 'Set when the record was created and cannot be changed'
                    }
                  >
                    {displayCell(field, { id: '', ...values }, refLabel)}
                  </span>
                </div>
              );
            }
            if (field.defaultFromUserScope !== undefined && !contextEditable) {
              const options = refOptionsByField[field.key] ?? [];
              const current = values[field.key];
              const label =
                options.find((o) => o.value === current)?.label ??
                (typeof current === 'string' && current !== '' ? current : '—');
              return (
                <div key={field.key} className="crudform-locked">
                  <span className="crudform-locked-label">{field.label}</span>
                  <span className="crudform-locked-value" title="Set from the capturing user's assignment">
                    {label}
                  </span>
                </div>
              );
            }
            return (
            <FormField
              key={field.key}
              field={field}
              value={values[field.key] ?? null}
              invalid={touchedSubmit && missing.includes(field.key)}
              refOptions={refOptionsByField[field.key] ?? []}
              onQuickAdd={catalogFor(field) ? () => setQuickAdd(field) : undefined}
              onQuickEdit={catalogEditFor(field) ? () => setQuickEdit(field) : undefined}
              onChange={handleChange}
            />
            );
          })}
        </div>
        <SaveSummary fields={visibleFields} values={values} refLabels={refLabel} />
      </div>

      {mileageDiff !== null ? (
        <div className={`crudform-diff ${mileageDiff < 0 ? 'is-over' : ''}`}>
          <span>Difference mileage</span>
          <strong>{mileageDiff.toLocaleString('en-US')}</strong>
          <small>
            {mileageDiff < 0
              ? 'The truck is past its next maintenance'
              : 'Miles left before the next maintenance'}
          </small>
        </div>
      ) : null}

      {renderBanner ? <div className="crudform-banner">{renderBanner(values)}</div> : null}

      {extraSection ? <div className="crudform-extra">{extraSection}</div> : null}

      {renderExtra ? <div className="crudform-extra">{renderExtra(values)}</div> : null}

      {quickEdit
        ? (() => {
            const catalog = catalogEditFor(quickEdit);
            const chosen = values[quickEdit.key];
            const record =
              catalog && typeof chosen === 'string' && chosen !== '' && quickEdit.refCollection
                ? refMaps[quickEdit.refCollection]?.rows.find((r) => r.id === chosen)
                : undefined;
            if (!catalog || !record) return null;
            return (
              <QuickEditRefModal
                collection={catalog.collection}
                title={catalog.title}
                fields={catalog.fields}
                record={record}
                onSaved={() => setQuickEdit(null)}
                onClose={() => setQuickEdit(null)}
              />
            );
          })()
        : null}

      {quickAdd
        ? (() => {
            const catalog = catalogFor(quickAdd);
            if (!catalog) return null;
            return (
              <QuickAddRefModal
                collection={catalog.collection}
                title={catalog.title}
                fields={catalog.fields}
                autoUserField={catalog.autoUserField}
                currentUid={currentUid}
                onCreated={(id) => {
                  handleChange(quickAdd.key, id);
                  setQuickAdd(null);
                }}
                onClose={() => setQuickAdd(null)}
              />
            );
          })()
        : null}
    </Modal>
  );
}