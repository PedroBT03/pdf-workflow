import os
import sys
import uuid
import shutil
import traceback
from pathlib import Path
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import fitz

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "uploads"
RESULTS_DIR = BASE_DIR / "results"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

app.mount("/files", StaticFiles(directory=str(UPLOAD_DIR)), name="files")

@app.post("/api/upload")
async def upload_and_process(file: UploadFile = File(...)):
    try:
        from pdf2data.pdf2data_pipeline import PDF2Data
    except ModuleNotFoundError as e:
        # Keep the API alive even if optional ML dependencies are missing.
        raise HTTPException(
            status_code=500,
            detail=(
                f"Dependencia em falta para processamento de PDF: '{e.name}'. "
                "Instala as dependencias de ML para usar /api/upload."
            ),
        )

    file_id = str(uuid.uuid4())
    filename = f"{file_id}.pdf"
    file_path = UPLOAD_DIR / filename

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    try:
        pipeline = PDF2Data(
            layout_model="DocLayout-YOLO-DocStructBench",
            layout_model_threshold=0.5,
            table_model=None,
            table_model_threshold=0.5,
            device="cpu",
            input_folder=str(UPLOAD_DIR),
            output_folder=str(RESULTS_DIR),
            extract_text=True,
        )

        doc_layout = pipeline._mask.get_layout(str(file_path))
        doc = fitz.open(str(file_path))
        page = doc[0]

        blocks_data = []
        if "boxes" in doc_layout and len(doc_layout["boxes"]) > 0:
            boxes = doc_layout["boxes"][0]
            print(f"DEBUG: IA detectou {len(boxes)} blocos.")
            for i, box in enumerate(boxes):
                rect = fitz.Rect(box)
                blocks_data.append(
                    {
                        "id": i,
                        "box": [float(c) for c in box],
                        "originalBox": [float(c) for c in box],
                        "content": page.get_textbox(rect).strip() or " ",
                        "font_size": 11.0,
                        "color": (0, 0, 0),
                    }
                )

        pdf_size = {"width": page.rect.width, "height": page.rect.height}
        doc.close()

        return {
            "id": file_id,
            "pdf_url": f"http://localhost:8000/files/{filename}",
            "blocks": blocks_data,
            "pdf_size": pdf_size,
        }

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)