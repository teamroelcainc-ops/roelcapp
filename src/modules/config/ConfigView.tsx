import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAppConfig } from '../../context/AppConfigContext';
import { useCollection } from '../../hooks/useCollection';
import { MODULE_DEFS } from '../../config/modules';
import { FORM_DEFS, isReportDef } from '../../config/formDefs';
import { COLLECTIONS, type CheckSettings, type FormFieldConfig, type SystemUser } from '../../types/models';
import { SearchableSelect } from '../../components/ui/SearchableSelect';
import { Toolbar } from '../../components/ui/Toolbar';
import './ConfigView.css';


type Section = 'nav' | 'viewas' | string;

export function ConfigView() {
  const { canAdmin, viewAsProfile, setViewAs } = useAuth();
  const { sortNav, navLabel, navParentOf, saveNavigation, fieldsFor, saveFormFields, checkSettings, saveCheckSettings } = useAppConfig();
  const { data: systemUsers } = useCollection<SystemUser>(COLLECTIONS.SYSTEM_USERS);

  const canNav = canAdmin('navOrder');
  const canLabels = canAdmin('formLabels');
  const canOrder = canAdmin('formOrder');
  const canRequired = canAdmin('requiredFields');
  const canViewAs = canAdmin('viewAs');
  const canChecks = canAdmin('checkDesign');
  const canForms = canLabels || canOrder || canRequired;

  const sections = useMemo(() => {
    const list: { id: Section; label: string }[] = [];
    if (canNav) list.push({ id: 'nav', label: 'Navigation menu' });
    if (canForms) for (const form of FORM_DEFS) list.push({ id: form.id, label: form.label });
    if (canChecks) list.push({ id: 'checks-design', label: 'Check customization' });
    if (canViewAs) list.push({ id: 'viewas', label: 'View as user' });
    return list;
  }, [canNav, canForms, canViewAs, canChecks]);

  const [section, setSection] = useState<Section>(sections[0]?.id ?? 'nav');
  useEffect(() => {
    if (sections.length > 0 && !sections.some((s) => s.id === section)) setSection(sections[0].id);
  }, [sections, section]);

  /* ---- Navegacion ---- */
  const navItems = useMemo(
    () => sortNav(MODULE_DEFS.map((m) => ({ key: m.id, label: navLabel(m.id, m.label), defaultLabel: m.label, parent: navParentOf(m.id) ?? '' }))),
    [sortNav, navLabel, navParentOf],
  );
  const [navDraft, setNavDraft] = useState<{ key: string; label: string; defaultLabel: string; parent: string }[]>([]);
  useEffect(() => setNavDraft(navItems), [navItems]);

  const moveNav = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= navDraft.length) return;
    const next = [...navDraft];
    [next[index], next[target]] = [next[target], next[index]];
    setNavDraft(next);
  };

  /* ---- Campos de formularios ---- */
  const formDef = FORM_DEFS.find((f) => f.id === section) ?? null;
  const [fieldsDraft, setFieldsDraft] = useState<FormFieldConfig[]>([]);
  useEffect(() => {
    if (formDef) setFieldsDraft(fieldsFor(formDef.id, formDef.fields));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  const moveField = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= fieldsDraft.length) return;
    const next = [...fieldsDraft];
    [next[index], next[target]] = [next[target], next[index]];
    setFieldsDraft(next);
  };

  const patchField = (index: number, patch: Partial<FormFieldConfig>) => {
    setFieldsDraft((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  };

  /* ---- View as ---- */
  const userOptions = useMemo(
    () =>
      [...systemUsers]
        .map((u) => ({ id: u.id, name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [systemUsers],
  );
  const [viewAsDraft, setViewAsDraft] = useState('');

  /* ---- Personalizacion de cheques ---- */
  const [checksDraft, setChecksDraft] = useState<CheckSettings>({});
  useEffect(() => setChecksDraft({ ...checkSettings }), [checkSettings]);

  if (sections.length === 0) {
    return (
      <div className="config">
        <Toolbar title="Configurator" />
        <p className="config__no-access">Your role has no configurator capabilities. Ask an administrator.</p>
      </div>
    );
  }

  return (
    <div className="config">
      <Toolbar title="Configurator" subtitle="Navigation, forms and impersonation" />

      <div className="config__layout">
        <nav className="config__sections">
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`config__section-btn${section === s.id ? ' config__section-btn--active' : ''}`}
              onClick={() => setSection(s.id)}
            >
              {s.label}
            </button>
          ))}
        </nav>

        <div className="config__content">
          {section === 'nav' && canNav && (
            <div className="config__card">
              <h3 className="config__card-title">Navigation menu order</h3>
              <p className="config__hint">
                Order, names and grouping of the sidebar for every user. Use "Inside of" to show a
                module as a sub-item of another (one level). Each person still only sees the modules
                their role allows.
              </p>
              <ul className="config__list">
                {navDraft.map((item, index) => (
                  <li className="config__row" key={item.key}>
                    <span className="config__row-order">{index + 1}</span>
                    <span className="config__field-main">
                      <input
                        className="input config__field-label"
                        value={item.label}
                        title={`Rename (default: ${item.defaultLabel})`}
                        onChange={(e) =>
                          setNavDraft((prev) => prev.map((n, i) => (i === index ? { ...n, label: e.target.value } : n)))
                        }
                      />
                      {item.label !== item.defaultLabel && (
                        <span className="config__field-default">default: {item.defaultLabel}</span>
                      )}
                    </span>
                    <label className="config__nav-parent">
                      <span className="config__nav-parent-label">Inside of</span>
                      <select
                        className="input config__nav-parent-select"
                        value={item.parent}
                        disabled={navDraft.some((n) => n.parent === item.key)}
                        title={navDraft.some((n) => n.parent === item.key) ? 'This module has sub-items; move them out first' : 'Show this module as a sub-item of another module'}
                        onChange={(e) =>
                          setNavDraft((prev) => prev.map((n, i) => (i === index ? { ...n, parent: e.target.value } : n)))
                        }
                      >
                        <option value="">&#8212; Top level &#8212;</option>
                        {navDraft
                          .filter((n) => n.key !== item.key && !n.parent)
                          .map((n) => (
                            <option key={n.key} value={n.key}>{n.label}</option>
                          ))}
                      </select>
                    </label>
                    <span className="config__row-actions">
                      <button type="button" className="config__arrow" disabled={index === 0} onClick={() => moveNav(index, -1)} aria-label="Move up">▲</button>
                      <button type="button" className="config__arrow" disabled={index === navDraft.length - 1} onClick={() => moveNav(index, 1)} aria-label="Move down">▼</button>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="config__actions">
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => {
                    const labels: Record<string, string> = {};
                    for (const item of navDraft) {
                      const trimmed = item.label.trim();
                      if (trimmed && trimmed !== item.defaultLabel) labels[item.key] = trimmed;
                    }
                    const parents: Record<string, string> = {};
                    for (const item of navDraft) {
                      if (item.parent && item.parent !== item.key) parents[item.key] = item.parent;
                    }
                    saveNavigation(navDraft.map((i) => i.key), labels, parents);
                  }}
                >
                  Save order
                </button>
              </div>
            </div>
          )}

          {formDef && canForms && (
            <div className="config__card">
              <h3 className="config__card-title">{formDef.label}</h3>
              <p className="config__hint">
                {isReportDef(formDef.id)
                  ? 'Choose which columns belong to this report and their order. Unchecked columns are hidden from the table and the Excel export.'
                  : 'The order here is the order of the fields in the form — both when creating and when opening a row to edit. Renamed labels appear everywhere the field is shown.'}
              </p>
              <ul className="config__list">
                {fieldsDraft.map((field, index) => (
                  <li className="config__row" key={field.key}>
                    <span className="config__row-order">{index + 1}</span>
                    <span className="config__field-main">
                      <input
                        className="input config__field-label"
                        value={field.label}
                        disabled={!canLabels}
                        title={canLabels ? `Rename (default: ${field.key})` : 'Your role cannot rename fields'}
                        onChange={(e) => patchField(index, { label: e.target.value })}
                      />
                      {field.label !== field.key && <span className="config__field-default">default: {field.key}</span>}
                    </span>
                    {isReportDef(formDef.id) ? (
                      <label className={`config__required${canRequired ? '' : ' config__required--locked'}`}>
                        <input
                          type="checkbox"
                          className="config__checkbox"
                          checked={!field.hidden}
                          disabled={!canRequired}
                          onChange={(e) => patchField(index, { hidden: !e.target.checked })}
                        />
                        Visible
                      </label>
                    ) : (
                      <label className={`config__required${canRequired ? '' : ' config__required--locked'}`}>
                        <input
                          type="checkbox"
                          className="config__checkbox"
                          checked={field.required}
                          disabled={!canRequired}
                          onChange={(e) => patchField(index, { required: e.target.checked })}
                        />
                        Required
                      </label>
                    )}
                    <span className="config__row-actions">
                      <button type="button" className="config__arrow" disabled={!canOrder || index === 0} onClick={() => moveField(index, -1)} aria-label="Move up">▲</button>
                      <button type="button" className="config__arrow" disabled={!canOrder || index === fieldsDraft.length - 1} onClick={() => moveField(index, 1)} aria-label="Move down">▼</button>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="config__actions">
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() => setFieldsDraft(formDef.fields.map((key) => ({ key, label: key, required: false })))}
                >
                  Reset to defaults
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => saveFormFields(formDef.id, fieldsDraft.map((f) => ({ ...f, label: f.label.trim() || f.key })))}
                >
                  Save fields
                </button>
              </div>
            </div>
          )}

          {section === 'checks-design' && canChecks && (
            <div className="config__card">
              <h3 className="config__card-title">Check customization</h3>
              <p className="config__hint">
                Controls how printed checks look and where the numbering starts. Company data and
                bank accounts come from the Company Info module.
              </p>
              <div className="config__checks-grid">
                <div>
                  <span className="config__field-label-title">Starting check number</span>
                  <input
                    className="input mono"
                    type="number"
                    min="1"
                    value={checksDraft.startNumber ?? ''}
                    placeholder="e.g. 12043"
                    onChange={(e) =>
                      setChecksDraft((d) => ({ ...d, startNumber: e.target.value ? parseInt(e.target.value, 10) : undefined }))
                    }
                  />
                  <p className="config__field-default">New checks continue from the highest of this number or the last check saved.</p>
                </div>
                <div>
                  <span className="config__field-label-title">Signature line text</span>
                  <input
                    className="input"
                    value={checksDraft.signatureText ?? ''}
                    placeholder="Authorized signature"
                    onChange={(e) => setChecksDraft((d) => ({ ...d, signatureText: e.target.value }))}
                  />
                </div>
                <div>
                  <span className="config__field-label-title">Bank fractional number</span>
                  <input
                    className="input"
                    value={checksDraft.fractional ?? ''}
                    placeholder="e.g. 67-76890"
                    onChange={(e) => setChecksDraft((d) => ({ ...d, fractional: e.target.value }))}
                  />
                  <p className="config__field-default">Printed under the check number (top right), per US bank check standards.</p>
                </div>
              </div>
              <div className="config__toggles">
                <label className="config__required">
                  <input type="checkbox" className="config__checkbox" checked={checksDraft.showLogo !== false}
                    onChange={(e) => setChecksDraft((d) => ({ ...d, showLogo: e.target.checked }))} />
                  Show company logo
                </label>
                <label className="config__required">
                  <input type="checkbox" className="config__checkbox" checked={checksDraft.showAddress !== false}
                    onChange={(e) => setChecksDraft((d) => ({ ...d, showAddress: e.target.checked }))} />
                  Show company address
                </label>
                <label className="config__required">
                  <input type="checkbox" className="config__checkbox" checked={checksDraft.showBankInfo !== false}
                    onChange={(e) => setChecksDraft((d) => ({ ...d, showBankInfo: e.target.checked }))} />
                  Show bank info and routing line
                </label>
              </div>
              <div className="config__actions">
                <button type="button" className="btn btn--primary" onClick={() => saveCheckSettings(checksDraft)}>
                  Save check settings
                </button>
              </div>
            </div>
          )}

          {section === 'viewas' && canViewAs && (
            <div className="config__card">
              <h3 className="config__card-title">View as another user</h3>
              <p className="config__hint">
                See the app exactly as another user sees it — same menu, same buttons, same limits.
                While active, a banner at the top lets you exit at any time.
              </p>
              {viewAsProfile ? (
                <div className="config__viewas-active">
                  <span>
                    Currently viewing as <strong>{`${viewAsProfile.firstName ?? ''} ${viewAsProfile.lastName ?? ''}`.trim() || viewAsProfile.email}</strong>
                  </span>
                  <button type="button" className="btn btn--secondary" onClick={() => setViewAs(null)}>
                    Exit view
                  </button>
                </div>
              ) : (
                <div className="config__viewas-picker">
                  <SearchableSelect
                    value={viewAsDraft}
                    onChange={setViewAsDraft}
                    options={userOptions}
                    placeholder="Search a user…"
                  />
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={!viewAsDraft}
                    onClick={() => setViewAs(viewAsDraft)}
                  >
                    Start viewing
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
