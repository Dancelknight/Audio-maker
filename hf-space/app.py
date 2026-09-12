import os
import subprocess
import tempfile
import urllib.request
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

MODEL_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/de/de_DE/eva_k/x_low/de_DE-eva_k-x_low.onnx?download=true"
CONFIG_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/de/de_DE/eva_k/x_low/de_DE-eva_k-x_low.onnx.json?download=true"
MODEL_DIR = Path("/tmp/german-reader-model")
MODEL_PATH = MODEL_DIR / "de_DE-eva_k-x_low.onnx"
CONFIG_PATH = MODEL_DIR / "de_DE-eva_k-x_low.onnx.json"

app = FastAPI(title="German Neural Reader TTS")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=250000)
    speed: float = Field(default=0.94, ge=0.5, le=2.0)
    bitrate: int = Field(default=40, ge=24, le=192)
    sentence_pause_ms: int = Field(default=240, ge=0, le=3000)
    paragraph_pause_ms: int = Field(default=650, ge=0, le=5000)

def ensure_model():
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    if not MODEL_PATH.exists():
        urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
    if not CONFIG_PATH.exists():
        urllib.request.urlretrieve(CONFIG_URL, CONFIG_PATH)

@app.get("/health")
def health():
    return {"ok": True, "model": "de_DE-eva_k-x_low"}

@app.post("/tts")
def tts(req: TTSRequest):
    ensure_model()
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text is empty")

    work = Path(tempfile.mkdtemp(prefix="german-reader-"))
    wav = work / "output.wav"
    mp3 = work / "output.mp3"

    try:
        length_scale = 1.0 / float(req.speed)
        sentence_silence = float(req.sentence_pause_ms) / 1000.0

        piper_cmd = [
            "piper",
            "--model", str(MODEL_PATH),
            "--config", str(CONFIG_PATH),
            "--output_file", str(wav),
            "--length_scale", str(length_scale),
            "--sentence_silence", str(sentence_silence),
        ]
        p = subprocess.run(
            piper_cmd,
            input=text,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=1800,
        )
        if p.returncode != 0 or not wav.exists():
            raise RuntimeError("Piper failed: " + p.stderr[-1200:])

        ff = subprocess.run(
            [
                "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                "-i", str(wav),
                "-codec:a", "libmp3lame",
                "-b:a", f"{int(req.bitrate)}k",
                str(mp3),
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=600,
        )
        if ff.returncode != 0 or not mp3.exists():
            raise RuntimeError("ffmpeg failed: " + ff.stderr.decode("utf-8", "ignore")[-1200:])

        return FileResponse(
            path=str(mp3),
            media_type="audio/mpeg",
            filename="GermanReader_HF.mp3",
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="TTS job timed out")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
