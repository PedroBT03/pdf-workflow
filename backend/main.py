import uuid
import shutil
import traceback
import tempfile
from pathlib import Path
from fastapi import FastAPI, UploadFile, File, HTTPException
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

@app.post("/api/upload")
async def upload_and_process(file: UploadFile = File(...)):
    try:
        from pdf2data.pdf2data_pipeline import PDF2Data
    except ModuleNotFoundError as e:
        # Keep the API alive even if optional ML dependencies are missing.
        raise HTTPException(
            status_code=500,
            detail=(
                f"Missing dependency for PDF processing: '{e.name}'. "
                "Install the ML dependencies to use /api/upload."
            ),
        )

    file_id = str(uuid.uuid4())

    try:
        with tempfile.TemporaryDirectory(prefix="pdfwf_in_") as input_tmp, tempfile.TemporaryDirectory(
            prefix="pdfwf_out_"
        ) as output_tmp:
            filename = f"{file_id}.pdf"
            file_path = Path(input_tmp) / filename

            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)

            pipeline = PDF2Data(
                layout_model="DocLayout-YOLO-DocStructBench",
                layout_model_threshold=0.5,
                table_model=None,
                table_model_threshold=0.5,
                device="cpu",
                input_folder=input_tmp,
                output_folder=output_tmp,
                extract_text=True,
            )

            doc_layout = pipeline._mask.get_layout(str(file_path))
            doc = fitz.open(str(file_path))

            blocks_data = []
            page_sizes = []
            boxes_by_page = doc_layout.get("boxes", []) if isinstance(doc_layout, dict) else []
            next_id = 0

            for page_idx in range(doc.page_count):
                page_number = page_idx + 1
                page = doc[page_idx]
                page_sizes.append(
                    {
                        "page": page_number,
                        "width": page.rect.width,
                        "height": page.rect.height,
                    }
                )

                page_boxes = boxes_by_page[page_idx] if page_idx < len(boxes_by_page) else []
                print(f"DEBUG: AI detected {len(page_boxes)} blocks on page {page_number}.")

                for box in page_boxes:
                    rect = fitz.Rect(box)
                    blocks_data.append(
                        {
                            "id": next_id,
                            "page": page_number,
                            "box": [float(c) for c in box],
                            "originalBox": [float(c) for c in box],
                            "content": page.get_textbox(rect).strip() or " ",
                            "font_size": 11.0,
                            "color": (0, 0, 0),
                        }
                    )
                    next_id += 1

            pdf_size = (
                {"width": page_sizes[0]["width"], "height": page_sizes[0]["height"]}
                if page_sizes
                else {"width": 0, "height": 0}
            )
            doc.close()

            return {
                "id": file_id,
                "blocks": blocks_data,
                "pdf_size": pdf_size,
                "page_sizes": page_sizes,
            }

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)