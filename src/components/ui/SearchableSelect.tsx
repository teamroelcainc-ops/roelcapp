import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import './SearchableSelect.css';

export interface SelectOption {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  value: string;
  options: SelectOption[];
  placeholder?: string;
  invalid?: boolean;
  onChange: (value: string) => void;
}

/** Select con buscador integrado. Reutilizado por todos los refs y enums. */
export function SearchableSelect({
  value,
  options,
  placeholder = 'Select…',
  invalid = false,
  onChange,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return options;
    return options.filter((o) => o.label.toLowerCase().includes(term));
  }, [options, search]);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const pick = (optionValue: string) => {
    onChange(optionValue);
    setOpen(false);
    setSearch('');
  };

  return (
    <div className={`sselect ${invalid ? 'sselect-invalid' : ''}`} ref={wrapRef}>
      <button
        type="button"
        className="sselect-control"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={selected ? 'sselect-value' : 'sselect-placeholder'}>
          {selected ? selected.label : placeholder}
        </span>
        <span className="sselect-icons">
          {selected ? (
            <span
              className="sselect-clear"
              role="button"
              aria-label="Clear"
              onClick={(e) => {
                e.stopPropagation();
                pick('');
              }}
            >
              <X size={14} />
            </span>
          ) : null}
          <ChevronDown size={16} />
        </span>
      </button>
      {open ? (
        <div className="sselect-menu">
          <input
            className="sselect-search"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          <ul role="listbox">
            {filtered.length === 0 ? <li className="sselect-empty">No results</li> : null}
            {filtered.map((option) => (
              <li key={option.value}>
                <button
                  type="button"
                  className={option.value === value ? 'is-selected' : ''}
                  onClick={() => pick(option.value)}
                >
                  {option.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
