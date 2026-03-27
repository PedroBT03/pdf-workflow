# PDF Workflow

Project with a FastAPI backend and a React + Vite frontend.

## Requirements

- Python 3.10+ (recommended: 3.12 for ML)
- Node.js 18+ and npm

## 1. Backend: virtual environment and dependencies

From the terminal, starting at the project root:

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt

# Optional: required to use /api/upload with AI extraction
python -m pip install -r requirements-ml.txt
```

ML dependencies in `backend/`:

- `requirements-ml.txt`
- includes the required stack for the active processors in this release

If the virtual environment already exists, just activate it:

```bash
cd backend
source venv/bin/activate
```

## 2. Run the backend

With the virtual environment active:

```bash
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

API available at `http://localhost:8000`.

## 3. Frontend: install dependencies

In another terminal, starting at the project root:

```bash
cd frontend
npm install
```

## 4. Run the frontend

Still inside `frontend`:

```bash
npm run dev
```

App available at `http://localhost:5173` (default Vite port).

## 5. Quick full flow (2 terminals)

Terminal A (backend):

```bash
cd backend
source venv/bin/activate
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Terminal B (frontend):

```bash
cd frontend
npm install
npm run dev
```
