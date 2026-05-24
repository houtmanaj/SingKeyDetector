import os
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from key_detector import detect_key_from_file

app = FastAPI(title="SingKey API", version="1.0.0")

_origins_env = os.getenv("ALLOWED_ORIGINS", "*")
allowed_origins = [o.strip() for o in _origins_env.split(",")]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/detect-key")
async def detect_key_route(file: UploadFile = File(...)):
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(400, "Recording too large (max 10 MB).")

    suffix = Path(file.filename or "rec.wav").suffix.lower() or ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        return detect_key_from_file(tmp_path)
    except Exception as exc:
        raise HTTPException(500, f"Key detection failed: {exc}")
    finally:
        try:
            Path(tmp_path).unlink(missing_ok=True)
        except Exception:
            pass


@app.get("/health")
async def health():
    return {"status": "ok"}
