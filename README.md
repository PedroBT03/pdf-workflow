# PDF Workflow

Projeto com backend em FastAPI e frontend em React + Vite.

## Requisitos

- Python 3.10+ (recomendado)
- Node.js 18+ e npm

## 1. Backend: ambiente virtual e dependencias

No terminal, a partir da raiz do projeto:

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt

# Opcional: necessario para usar /api/upload com deteccao IA
python -m pip install -r requirements-ml.txt
```

Se o ambiente virtual ja existir, basta entrar com:

```bash
cd backend
source venv/bin/activate
```

## 2. Correr o backend

Com o ambiente virtual ativo:

```bash
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

API disponivel em `http://localhost:8000`.

## 3. Frontend: instalar dependencias

Noutro terminal, a partir da raiz do projeto:

```bash
cd frontend
npm install
```

## 4. Correr o frontend

Ainda no `frontend`:

```bash
npm run dev
```

App disponivel em `http://localhost:5173` (porta padrao do Vite).

## 5. Fluxo completo rapido (2 terminais)

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

## Nota sobre `pdf2data`

O backend tenta importar `pdf2data` em `backend/main.py`. Se esse modulo nao estiver instalado/disponivel no teu ambiente, o endpoint de upload pode falhar. Garante que a libraria/modulo `pdf2data` esta acessivel no mesmo ambiente Python.

Para usar o endpoint `/api/upload` com o stack de ML completo, instala tambem:

```bash
cd backend
source venv/bin/activate
python -m pip install -r requirements-ml.txt
```

To use `processor=mineru`, make sure the MinerU CLI is installed in the same environment:

```bash
cd backend
source venv/bin/activate
python -m pip install -r requirements-ml.txt
command -v mineru
```

`requirements-ml.txt` includes MinerU runtime dependencies such as `ultralytics` and `accelerate`.

Note: this backend forces MinerU to run with `-b pipeline -d cpu` to avoid CUDA out-of-memory failures on low-VRAM GPUs.
It also sets `TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD=1` for the MinerU subprocess to keep compatibility with checkpoints that fail under PyTorch's newer `weights_only=True` default.

## Resolucao de problemas

Se aparecer este erro ao usar `pip`:

```bash
bash: .../venv/bin/pip: cannot execute: required file not found
```

Significa que o `venv` ficou inconsistente (muito comum apos mover/renomear a pasta do projeto). Recria o ambiente:

```bash
cd backend
rm -rf venv
python3 -m venv venv
source venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```
