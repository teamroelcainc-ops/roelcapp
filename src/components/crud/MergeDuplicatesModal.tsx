import { useEffect, useMemo, useState } from 'react';
import { Merge } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import {
  countDocumentsSafe,
  deleteDocument,
  fetchDocumentsWhere,
  setDocument,
  updateDocument,
} from '../../services/firestoreService';
import type { EntityData, ModuleConfig } from '../../types/models';
import './MergeDuplicatesModal.css';

interface MergeDuplicatesModalProps {
  config: ModuleConfig;
  rows: EntityData[];
  onClose: () => void;
}

interface Member {
  row: EntityData;
  label: string;
  refs: number | null;
}

interface Group {
  key: string;
  members: Member[];
}

/** Misma normalización del importador: sin acentos, signos ni orden de palabras. */
function sortedCanonical(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .sort()
    .join(' ');
}

/**
 * Fusión de registros duplicados (misma persona escrita distinto): se
 * conserva el más referenciado (a igualdad, el más antiguo), se reapuntan
 * hacia él las referencias configuradas (los drivers que lo usan), se
 * completan en él los datos que la copia tuviera de más (teléfono, correo)
 * y las copias se eliminan. Todo con avance visible y confirmación.
 */
export function MergeDuplicatesModal({ config, rows, onClose }: MergeDuplicatesModalProps) {
  const dedupe = config.dedupe!;
  const [refCounts, setRefCounts] = useState<Record<string, number>>({});
  const [busyGroup, setBusyGroup] = useState<string | null>(null);
  const [mergedGroups, setMergedGroups] = useState<Set<string>>(new Set());
  const [log, setLog] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);

  /** Grupos de registros cuyo nombre normalizado coincide (2 o más). */
  const groups = useMemo((): Group[] => {
    const byKey = new Map<string, Member[]>();
    rows.forEach((row) => {
      const raw = row[dedupe.labelKey];
      const label = typeof raw === 'string' ? raw.trim() : '';
      if (label === '') return;
      const key = sortedCanonical(label);
      if (key === '') return;
      const list = byKey.get(key) ?? [];
      list.push({ row, label, refs: null });
      byKey.set(key, list);
    });
    return [...byKey.entries()]
      .filter(([, members]) => members.length > 1)
      .map(([key, members]) => ({ key, members }))
      .sort((a, b) => a.members[0].label.localeCompare(b.members[0].label));
  }, [rows, dedupe.labelKey]);

  // Cuántos registros referencian a cada copia: decide quién se conserva.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const group of groups) {
        for (const member of group.members) {
          if (cancelled) return;
          if (refCounts[member.row.id] !== undefined) continue;
          let total = 0;
          try {
            for (const ref of dedupe.references) {
              total += await countDocumentsSafe(ref.collection, {
                field: ref.key,
                value: member.row.id,
              });
            }
          } catch {
            total = 0;
          }
          if (cancelled) return;
          setRefCounts((prev) => ({ ...prev, [member.row.id]: total }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups]);

  /** El que se queda: más referenciado; a igualdad, el más antiguo. */
  const keeperOf = (group: Group): Member => {
    const withCounts = group.members.map((m) => ({
      ...m,
      refs: refCounts[m.row.id] ?? 0,
    }));
    return withCounts.sort((a, b) => {
      if (b.refs !== a.refs) return b.refs - a.refs;
      return String(a.row.createdAt ?? '').localeCompare(String(b.row.createdAt ?? ''));
    })[0];
  };

  const mergeGroup = async (group: Group) => {
    setBusyGroup(group.key);
    setError(null);
    try {
      const keeper = keeperOf(group);
      const keeperLabel = keeper.label;
      const losers = group.members.filter((m) => m.row.id !== keeper.row.id);
      for (const loser of losers) {
        // 1) Reapuntar todo lo que referencia a la copia hacia el que se queda.
        for (const ref of dedupe.references) {
          const referencing = await fetchDocumentsWhere(ref.collection, {
            field: ref.key,
            value: loser.row.id,
          });
          for (const record of referencing) {
            await updateDocument(ref.collection, record.id, {
              [ref.key]: keeper.row.id,
              ...(ref.alsoCopyLabelTo ? { [ref.alsoCopyLabelTo]: keeperLabel } : {}),
            });
          }
        }
        // 2) Completar en el que se queda los datos que solo tenía la copia.
        const extras: Record<string, string> = {};
        Object.entries(loser.row).forEach(([key, value]) => {
          if (['id', 'createdAt', 'updatedAt', dedupe.labelKey].includes(key)) return;
          const current = keeper.row[key];
          if (
            typeof value === 'string' &&
            value !== '' &&
            (current === null || current === undefined || current === '')
          ) {
            extras[key] = value;
          }
        });
        if (Object.keys(extras).length > 0) {
          await setDocument(config.collection, keeper.row.id, extras, true);
        }
        // 3) Eliminar la copia.
        await deleteDocument(config.collection, loser.row.id);
      }
      setMergedGroups((prev) => new Set(prev).add(group.key));
      setLog(`"${keeperLabel}": merged ${losers.length + 1} into 1`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The merge failed');
    } finally {
      setBusyGroup(null);
    }
  };

  const mergeAll = async () => {
    setConfirmAll(false);
    for (const group of groups) {
      if (mergedGroups.has(group.key)) continue;
      // Secuencial y con el mismo camino que el botón individual.
      await mergeGroup(group);
    }
  };

  const pendingGroups = groups.filter((g) => !mergedGroups.has(g.key));

  return (
    <Modal
      open
      title={`Merge duplicates · ${config.title}`}
      onClose={busyGroup ? () => undefined : onClose}
      size="lg"
      footer={
        <>
          {error ? <span className="crudform-error">{error}</span> : null}
          {log && !error ? <span className="mdup-log">{log}</span> : null}
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={busyGroup !== null}>
            Close
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setConfirmAll(true)}
            disabled={busyGroup !== null || pendingGroups.length === 0}
          >
            <Merge size={16} />
            Merge all ({pendingGroups.length} groups)
          </button>
        </>
      }
    >
      <p className="mdup-help">
        Each group below is the <strong>same person written in different ways</strong>. Merging
        keeps the copy that is most referenced (oldest one on a tie), repoints every record that
        used the other copies, completes missing data (phone, email) from them, and deletes them.
        Nothing referencing the person is lost.
      </p>
      {groups.length === 0 ? (
        <p className="mdup-empty">No duplicated names found. The catalog is clean.</p>
      ) : (
        <div className="mdup-groups">
          {groups.map((group) => {
            const keeper = keeperOf(group);
            const merged = mergedGroups.has(group.key);
            return (
              <div key={group.key} className={`mdup-group ${merged ? 'is-merged' : ''}`}>
                <div className="mdup-members">
                  {group.members.map((member) => (
                    <div
                      key={member.row.id}
                      className={`mdup-member ${member.row.id === keeper.row.id ? 'is-keeper' : ''}`}
                    >
                      <span className="mdup-name">{member.label}</span>
                      <span className="mdup-meta">
                        {refCounts[member.row.id] === undefined
                          ? 'counting uses…'
                          : `${refCounts[member.row.id]} record(s) use it`}
                        {member.row.id === keeper.row.id ? ' · KEPT' : ' · will be removed'}
                      </span>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn btn-outline mdup-merge-btn"
                  disabled={busyGroup !== null || merged}
                  onClick={() => void mergeGroup(group)}
                >
                  {merged ? 'Merged ✓' : busyGroup === group.key ? 'Merging…' : 'Merge'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={confirmAll}
        title="Merge all duplicates"
        message={`${pendingGroups.length} groups will be merged: references are repointed to the kept copy and the extra copies are deleted. This cannot be undone. Continue?`}
        busy={busyGroup !== null}
        onCancel={() => setConfirmAll(false)}
        onConfirm={() => void mergeAll()}
      />
    </Modal>
  );
}
