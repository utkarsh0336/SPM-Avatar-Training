"use client";

import { PlusIcon, TrashIcon } from "../../sessions/icons";
import styles from "./page.module.css";

export interface ChecklistItemDraft {
  /** React key — the item's real id once saved, or a client-generated id for a new, unsaved row. */
  key: string;
  /** Present only for an item that already exists server-side; absent means "create" on save. */
  id?: string;
  title: string;
  description: string;
}

export interface ChecklistEditorProps {
  items: ChecklistItemDraft[];
  onChange: (items: ChecklistItemDraft[]) => void;
}

function emptyDraft(): ChecklistItemDraft {
  return { key: crypto.randomUUID(), title: "", description: "" };
}

/**
 * Local, in-memory ordered-list editor for a Curriculum's optional
 * InductionChecklist — mirrors ObjectiveList.tsx's add/reorder/remove-then-
 * save-the-whole-list shape exactly, but for the simpler two-field
 * (title/description) checklist item, a self-attested task rather than an
 * AI-graded objective. See .claude/specs/induction-checklist.md's UI
 * Changes.
 */
export function ChecklistEditor({ items, onChange }: ChecklistEditorProps) {
  function updateAt(index: number, patch: Partial<ChecklistItemDraft>): void {
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function removeAt(index: number): void {
    onChange(items.filter((_, i) => i !== index));
  }

  function swap(a: number, b: number): void {
    const next = [...items];
    const temp = next[a]!;
    next[a] = next[b]!;
    next[b] = temp;
    onChange(next);
  }

  return (
    <div className={styles.objectiveList}>
      {items.length === 0 && <p className={styles.empty}>No checklist items yet — add one below.</p>}
      {items.map((item, index) => (
        <div key={item.key} className={styles.objectiveRow}>
          <div className={styles.objectiveRowHeader}>
            <span className={styles.objectiveIndex}>{index + 1}</span>
            <input
              type="text"
              className={styles.textInput}
              placeholder="Task, e.g. Complete IT setup"
              value={item.title}
              onChange={(e) => updateAt(index, { title: e.target.value })}
            />
            <div className={styles.objectiveRowActions}>
              <button
                type="button"
                className={styles.iconButton}
                disabled={index === 0}
                onClick={() => swap(index, index - 1)}
                aria-label="Move up"
              >
                ↑
              </button>
              <button
                type="button"
                className={styles.iconButton}
                disabled={index === items.length - 1}
                onClick={() => swap(index, index + 1)}
                aria-label="Move down"
              >
                ↓
              </button>
              <button type="button" className={styles.iconButton} onClick={() => removeAt(index)} aria-label="Remove item">
                <TrashIcon size={14} />
              </button>
            </div>
          </div>
          <textarea
            className={styles.textArea}
            placeholder="Details for the learner (optional)"
            value={item.description}
            onChange={(e) => updateAt(index, { description: e.target.value })}
          />
        </div>
      ))}
      <button type="button" className={styles.addButton} onClick={() => onChange([...items, emptyDraft()])}>
        <PlusIcon size={16} /> Add Checklist Item
      </button>
    </div>
  );
}
