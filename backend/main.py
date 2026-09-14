"""
main.py

Signify backend — exposes POST /predict per CONTRACT.md, wrapping the
trained SignPredictor. This is what Kervin's frontend calls once his
mocked prediction data gets swapped for the real thing (Phase 4 checkpoint).

Run locally:
    uvicorn main:app --reload --port 8000

Then POST to http://localhost:8000/predict with a JSON body like:
    {"landmarks": [{"x": 0.42, "y": 0.61, "z": -0.03}, ... 21 total]}
"""

import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from predict import SignPredictor

load_dotenv()

MODEL_PATH = os.getenv("MODEL_PATH", "model.pt")
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")

app = FastAPI(title="Signify Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["POST"],
    allow_headers=["*"],
)

predictor = SignPredictor(model_path=MODEL_PATH)


class Landmark(BaseModel):
    x: float
    y: float
    z: float


class PredictRequest(BaseModel):
    landmarks: list[Landmark] = Field(..., min_length=21, max_length=21)


@app.post("/predict")
def predict(request: PredictRequest):
    landmarks = [lm.model_dump() for lm in request.landmarks]
    result = predictor.predict(landmarks)
    return result


@app.get("/health")
def health():
    """Simple check Kervin's frontend (or you) can hit to confirm the backend is up."""
    return {"status": "ok"}
