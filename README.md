# PM Tool — Resource management (increment 1)

People resources (name, role, email, notes) with a **FastAPI REST API** and a **React** UI. No authentication yet.

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
| GET | `/api/resources` | List (`role`, `q`, `limit`, `offset`) |
| GET | `/api/resources/{id}` | Get one |
| POST | `/api/resources` | Create |
| PUT | `/api/resources/{id}` | Full update |
| PATCH | `/api/resources/{id}` | Partial update |
| DELETE | `/api/resources/{id}` | Delete |
| GET | `/api/roles` | Role codes and labels |
| POST | `/api/resources/import` | CSV bulk import (`file`) |
| GET | `/api/resources/import/template` | CSV template |

### CSV import

Columns: `name`, `role`, `email`, `notes`

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
