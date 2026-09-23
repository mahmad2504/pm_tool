import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Resource, listResources } from "../api";
import { projectListLabel } from "../utils/projectLabel";

const UTILIZATION_CHANGED = "pm-utilization-changed";

export function notifyUtilizationChanged() {
  window.dispatchEvent(new Event(UTILIZATION_CHANGED));
}

export function OverUtilizationNotice() {
  const location = useLocation();
  const [items, setItems] = useState<Resource[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await listResources({ over_utilized: true, limit: 200 });
      const over = data.items.filter((item) => (item.total_utilization_percent ?? 0) > 100);
      setItems(over);
      if (over.length === 0) {
        setOpen(false);
      }
    } catch {
      // Keep the last known list so a failed refresh does not hide a real alert.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, location.pathname]);

  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener(UTILIZATION_CHANGED, refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener(UTILIZATION_CHANGED, refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [load]);

  if (items.length === 0) {
    return null;
  }

  const label =
    items.length === 1
      ? "1 person is over 100% utilization"
      : `${items.length} people are over 100% utilization`;

  return (
    <>
      <button type="button" className="over-notice" onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)} role="presentation">
          <div
            className="modal modal--wide"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="over-utilization-title"
          >
            <header className="modal__header">
              <h2 id="over-utilization-title">Over-utilization</h2>
              <button type="button" className="icon-btn" onClick={() => setOpen(false)}>
                ×
              </button>
            </header>
            <ul className="over-notice__list">
              {items.map((resource) => (
                <li key={resource.id}>
                  <p className="over-notice__person">
                    {resource.name}
                    <span className="utilization-over">
                      {" "}
                      {resource.total_utilization_percent}%
                    </span>
                  </p>
                  <ul className="over-notice__assignments">
                    {(resource.project_assignments ?? []).map((assignment) => (
                      <li key={assignment.project_id}>
                        {projectListLabel(
                          assignment.project_name,
                          !assignment.parent_name,
                          assignment.parent_name,
                        )}{" "}
                        -&gt; {assignment.utilization_percent}%
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
