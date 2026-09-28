import { useId, useState, type RefObject } from "react";
import { TagRef } from "../api";

export function tagsWithDraft(tags: string[], draft: string): string[] {
  const parts = draft
    .split(",")
    .map((part) => part.trim().replace(/\s+/g, " "))
    .filter(Boolean);
  const next = [...tags];
  for (const name of parts) {
    if (next.some((tag) => tag.toLowerCase() === name.toLowerCase())) continue;
    next.push(name);
  }
  return next;
}

export function TagChips({
  tags,
  activeId,
  onSelect,
}: {
  tags: TagRef[];
  activeId?: number | "";
  onSelect?: (tagId: number) => void;
}) {
  if (tags.length === 0) return null;
  return (
    <div className="tag-row">
      {tags.map((tag) => {
        const active = activeId === tag.id;
        const className = active ? "tag-chip tag-chip--active" : "tag-chip";
        if (!onSelect) {
          return (
            <span key={tag.id} className={`${className} tag-chip--static`}>
              {tag.name}
            </span>
          );
        }
        return (
          <button
            key={tag.id}
            type="button"
            className={className}
            aria-pressed={active}
            onClick={() => onSelect(tag.id)}
          >
            {tag.name}
          </button>
        );
      })}
    </div>
  );
}

export function TagEditor({
  tags,
  suggestions,
  onChange,
  disabled = false,
  draftRef,
}: {
  tags: string[];
  suggestions: string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
  draftRef?: RefObject<string | null>;
}) {
  const listId = useId();
  const [draft, setDraft] = useState("");
  if (draftRef) draftRef.current = draft;

  function commit(raw: string) {
    const parts = raw
      .split(",")
      .map((part) => part.trim().replace(/\s+/g, " "))
      .filter(Boolean);
    if (parts.length === 0) return;
    const next = [...tags];
    for (const name of parts) {
      if (next.some((tag) => tag.toLowerCase() === name.toLowerCase())) continue;
      next.push(name);
    }
    if (next.length !== tags.length) onChange(next);
    setDraft("");
  }

  function remove(name: string) {
    onChange(tags.filter((tag) => tag.toLowerCase() !== name.toLowerCase()));
  }

  return (
    <div className="tag-editor">
      {tags.map((tag) => (
        <span key={tag.toLowerCase()} className="tag-chip tag-chip--static">
          {tag}
          <button
            type="button"
            className="tag-chip__remove"
            aria-label={`Remove tag ${tag}`}
            disabled={disabled}
            onClick={() => remove(tag)}
          >
            ×
          </button>
        </span>
      ))}
      <input
        className="tag-editor__input"
        list={listId}
        value={draft}
        placeholder="Add a tag"
        aria-label="Add a tag"
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            commit(draft);
          }
        }}
      />
      <datalist id={listId}>
        {suggestions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        disabled={disabled || !draft.trim()}
        onClick={() => commit(draft)}
      >
        Add
      </button>
    </div>
  );
}
