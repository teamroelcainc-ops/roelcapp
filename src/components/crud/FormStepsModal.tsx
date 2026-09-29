import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { useUiConfig } from '../../hooks/useUiConfig';
import type { FormStep, ModuleConfig } from '../../types/models';
import './FormStepsModal.css';

interface FormStepsModalProps {
  base: ModuleConfig;
  onClose: () => void;
}

/** Paso al que pertenece cada campo hoy ('' = ninguno). */
function buildAssignment(steps: FormStep[], fieldKeys: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  fieldKeys.forEach((key) => {
    map[key] = steps.find((step) => step.fieldKeys.includes(key))?.id ?? '';
  });
  return map;
}

/**
 * Configura las pestañas del alta: su nombre, su orden y qué campo va en
 * cada una. Se guarda en la configuración compartida del módulo, así que el
 * cambio lo ven todos los usuarios sin tocar código.
 */
export function FormStepsModal({ base, onClose }: FormStepsModalProps) {
  const { overrides, saveModuleOverride, saveError } = useUiConfig();

  /** Campos capturables: los únicos que tiene sentido repartir en pestañas. */
  const fields = useMemo(
    () => base.fields.filter((field) => field.form !== false && field.compute === undefined),
    [base.fields],
  );

  const initialSteps = useMemo<FormStep[]>(() => {
    const saved = overrides.modules[base.id]?.formSteps ?? base.formSteps;
    if (saved && saved.length > 0) return saved.map((step) => ({ ...step }));
    return [{ id: 'step1', title: 'Step 1', fieldKeys: fields.map((f) => f.key) }];
  }, [overrides.modules, base.id, base.formSteps, fields]);

  const [steps, setSteps] = useState<FormStep[]>(initialSteps);
  const [assignment, setAssignment] = useState<Record<string, string>>(() =>
    buildAssignment(initialSteps, fields.map((f) => f.key)),
  );
  const [busy, setBusy] = useState(false);

  const rename = (id: string, title: string) =>
    setSteps((prev) => prev.map((step) => (step.id === id ? { ...step, title } : step)));

  const move = (index: number, delta: number) =>
    setSteps((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const addStep = () =>
    setSteps((prev) => [
      ...prev,
      { id: `step${Date.now()}`, title: `Step ${prev.length + 1}`, fieldKeys: [] },
    ]);

  const removeStep = (id: string) => {
    if (steps.length <= 1) return;
    setSteps((prev) => prev.filter((step) => step.id !== id));
    // Sus campos quedan sin asignar: caen al último paso automáticamente.
    setAssignment((prev) =>
      Object.fromEntries(
        Object.entries(prev).map(([key, value]) => [key, value === id ? '' : value]),
      ),
    );
  };

  const handleSave = async () => {
    setBusy(true);
    try {
      const formSteps: FormStep[] = steps.map((step) => ({
        id: step.id,
        title: step.title.trim() === '' ? 'Step' : step.title.trim(),
        // El orden dentro del paso es el del formulario, ya configurable
        // desde "Required fields".
        fieldKeys: fields.filter((f) => assignment[f.key] === step.id).map((f) => f.key),
      }));
      await saveModuleOverride(base.id, { formSteps });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      size="lg"
      layer="top"
      title={`Form steps · ${base.title}`}
      onClose={onClose}
      footer={
        <>
          {saveError ? <span className="crudform-error">{saveError}</span> : null}
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleSave()}
            disabled={busy}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <p className="fsteps-hint">
        Name each tab and choose which field goes in it. Fields left as “Last step” are added at
        the end, so none is ever lost.
      </p>

      <ul className="fsteps-list">
        {steps.map((step, index) => (
          <li key={step.id}>
            <span className="fsteps-num">{index + 1}</span>
            <input
              className="fsteps-name"
              value={step.title}
              aria-label={`Name of step ${index + 1}`}
              onChange={(e) => rename(step.id, e.target.value)}
            />
            <button
              type="button"
              className="fsteps-icon"
              aria-label="Move up"
              onClick={() => move(index, -1)}
            >
              <ChevronUp size={15} />
            </button>
            <button
              type="button"
              className="fsteps-icon"
              aria-label="Move down"
              onClick={() => move(index, 1)}
            >
              <ChevronDown size={15} />
            </button>
            <button
              type="button"
              className="fsteps-icon is-danger"
              aria-label="Remove step"
              disabled={steps.length <= 1}
              onClick={() => removeStep(step.id)}
            >
              <Trash2 size={15} />
            </button>
          </li>
        ))}
      </ul>

      <button type="button" className="btn btn-outline fsteps-add" onClick={addStep}>
        <Plus size={16} />
        Add step
      </button>

      <table className="fsteps-table">
        <thead>
          <tr>
            <th>Field</th>
            <th>Step</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => (
            <tr key={field.key}>
              <td>{field.label}</td>
              <td>
                <select
                  value={assignment[field.key] ?? ''}
                  aria-label={`Step for ${field.label}`}
                  onChange={(e) =>
                    setAssignment((prev) => ({ ...prev, [field.key]: e.target.value }))
                  }
                >
                  <option value="">Last step</option>
                  {steps.map((step, index) => (
                    <option key={step.id} value={step.id}>
                      {index + 1}. {step.title}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
