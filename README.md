# PM Tool

People **resources** and **projects** (groups, sub-projects, assignments, status reports) with a **FastAPI REST API** and **React** UI. No authentication yet.

## Prerequisites

- Python 3.11+
- Node.js 18+

## Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

API: http://localhost:8000  
Interactive docs: http://localhost:8000/docs

SQLite database file: `backend/pm.db`

### REST endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/resources` | List (`role`, `q`, `project_id`, `limit`, `offset`) |
| GET | `/api/resources/{id}` | Get one (includes project assignments and total utilization) |
| POST | `/api/resources` | Create |
| PUT | `/api/resources/{id}` | Full update |
| PATCH | `/api/resources/{id}` | Partial update |
| DELETE | `/api/resources/{id}` | Delete |
| GET | `/api/roles` | Role codes and labels |
| POST | `/api/resources/import` | CSV bulk import (`file`) |
| GET | `/api/resources/import/template` | CSV template |

### Projects

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects` | List (`q`, `group_id`, `parent_id`, `roots_only`, pagination) |
| POST | `/api/projects` | Create **root** project (`group_name` optional) |
| POST | `/api/projects/{id}/sub-projects` | Create sub-project (inherits root group) |
| GET/PATCH/DELETE | `/api/projects/{id}` | Detail / update / delete subtree |
| POST/PATCH/DELETE | `/api/projects/{id}/resources` | Assign (with `utilization_percent`), update utilization, remove |
| GET/POST/PATCH/DELETE | `/api/projects/{id}/status-reports` | Status reports (`?limit=2` for recent) |
| GET | `/api/groups` | Groups (auto-created; removed when empty) |

**Groups** are optional and apply only to **root** projects. Sub-projects inherit the root’s group when set and **cannot** have their own sub-projects (one level only). Search `q` matches project name, description, or group name.

### CSV import (resources)

Columns: `name`, `role`, `email`, `notes`

**Utilization** is set per project when assigning a person (`utilization_percent` 0–100 on `POST/PATCH .../resources`).

Role may be a code (`software_engineer`, `hardware_engineer`, `lead`) or label (`Software engineer`, etc.).

### Tests

```bash
cd backend
pytest
```

## Frontend

```bash
cd frontend
npm install
npm run dev
```

UI: http://localhost:5173

Optional: set `VITE_API_URL` (default `http://localhost:8000`).
