import { useState, type ReactNode } from 'react';
import './ChangeHistoryList.css';

interface DetailTab {
  id: string;
  title: string;
  content: ReactNode;
}

/**
 * Pestañas del visor de detalle (el historial del camión dividido en
 * Mantenimientos / Cambios de estación y entidad / Shop / Fleet / Bitácora):
 * cada pestaña se monta solo al abrirla, así las consultas relacionadas no
 * corren hasta que hacen falta.
 */
export function DetailTabs({ tabs }: { tabs: DetailTab[] }) {
  const [active, setActive] = useState(tabs[0]?.id ?? '');
  if (tabs.length === 0) return null;
  const current = tabs.find((tab) => tab.id === active) ?? tabs[0];
  return (
    <div>
      <div className="dtabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={tab.id === current.id ? 'is-active' : ''}
            onClick={() => setActive(tab.id)}
          >
            {tab.title}
          </button>
        ))}
      </div>
      {current.content}
    </div>
  );
}
