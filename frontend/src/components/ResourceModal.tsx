import { FormEvent } from "react";
import { RESOURCE_LOCATIONS, ResourceInput, ResourceLocation, ResourceRole, RoleItem } from "../api";

type Props = {
  open: boolean;
  title: string;
  roles: RoleItem[];
  form: ResourceInput;
  saving: boolean;
  onChange: (form: ResourceInput) => void;
  onClose: () => void;
  onSubmit: (e: FormEvent) => void;
};

export function ResourceModal({
  open,
  title,
  roles,
  form,
  saving,
  onChange,
  onClose,
  onSubmit,
}: Props) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="resource-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal__header">
          <h2 id="resource-modal-title">{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <form className="modal__form" onSubmit={onSubmit}>
          <label>
            Full name
            <input
              required
              autoFocus
              placeholder="e.g. Ada Lovelace"
              value={form.name}
              onChange={(e) => onChange({ ...form, name: e.target.value })}
            />
          </label>
          <label>
            Role
            <select
              value={form.role}
              onChange={(e) =>
                onChange({ ...form, role: e.target.value as ResourceRole })
              }
            >
              {roles.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Location
            <select
              value={form.location ?? ""}
              onChange={(e) =>
                onChange({
                  ...form,
                  location: (e.target.value || null) as ResourceLocation | null,
                })
              }
            >
              <option value="">Not set</option>
              {RESOURCE_LOCATIONS.map((location) => (
                <option key={location.code} value={location.code}>
                  {location.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Email
            <input
              required
              type="email"
              placeholder="name@company.com"
              value={form.email}
              onChange={(e) => onChange({ ...form, email: e.target.value })}
            />
          </label>
          <label>
            Notes
            <textarea
              rows={3}
              placeholder="Optional context, skills, or team…"
              value={form.notes ?? ""}
              onChange={(e) => onChange({ ...form, notes: e.target.value })}
            />
          </label>
          <footer className="modal__footer">
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? "Saving…" : "Save resource"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
