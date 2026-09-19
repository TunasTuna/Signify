<div align="center">

# Signify

![Python](https://img.shields.io/badge/Python-3.11-blue?logo=python)
![TypeScript](https://img.shields.io/badge/TypeScript-React-blue?logo=typescript)
![License](https://img.shields.io/badge/License-MIT-green)
![Status](https://img.shields.io/badge/Status-In%20Development-yellow)

<img src="./docs/asl-alphabet.png" alt="ASL fingerspelling alphabet chart" width="600">

</div>

Computer vision powered sign language fingerspelling translator. Signify watches your hand through a webcam, recognizes ASL fingerspelling letters in real time, lets you build up a message by holding each sign steady to confirm it, and speaks the finished message aloud.

Built as a two-person portfolio project: computer vision and backend by [Tan](https://github.com/TunasTuna), frontend by [V2.0](https://github.com/Version-20).

## How it works

1. **MediaPipe Hands** runs in the browser and extracts 21 hand landmark points from the live webcam feed.
2. Those landmarks are sent to a **FastAPI backend**, which runs them through a small trained classifier and returns the predicted letter and a confidence score.
3. Holding a sign steady for a set duration **confirms** it, locking the letter into a running message buffer. This avoids false triggers from noisy, momentary predictions.
4. Once you're done spelling, the message is read aloud using the browser's **Web Speech API**.

## Tech stack

| Layer | Tech |
|---|---|
| Hand tracking | [MediaPipe Hands](https://developers.google.com/mediapipe) |
| Sign classifier | PyTorch MLP (63 → 128 → 64 → 26) trained on landmark coordinates |
| Backend | FastAPI |
| Frontend | React + TypeScript + Vite |
| Text-to-speech | Web Speech API (`speechSynthesis`) |

## Model

The classifier is trained on the [ASL Alphabet dataset](https://www.kaggle.com/datasets/grassknoted/asl-alphabet), with MediaPipe used to extract hand landmarks from each training image rather than training directly on pixels. This keeps the model small and fast enough to run in real time on CPU.

- **Input:** 63 values (21 landmarks × x, y, z), normalized for translation and scale so hand position/distance from camera doesn't affect predictions
- **Validation accuracy:** 99.18% overall
- Letters involving heavy finger occlusion (M, N) are the hardest to classify, both in the dataset and in practice — this is a known limitation of static-image hand landmark detection, not specific to this model

## Project structure

```
signify/
├── backend/                  # FastAPI service + trained model
│   ├── main.py                 # API entrypoint — POST /predict, GET /health
│   ├── predict.py               # SignPredictor class wrapping the model
│   ├── requirements.txt
│   └── model/
│       └── model.pt              # trained classifier checkpoint
├── ml/                        # training pipeline (run manually, not at request time)
│   ├── extract_landmarks.py     # runs MediaPipe over a raw image dataset
│   ├── train_classifier.py      # trains the MLP on extracted landmarks
│   └── requirements.txt
├── src/                       # frontend (React + TypeScript + Vite)
│   ├── App.tsx
│   ├── useSignPredictor.ts      # MediaPipe extraction + live backend calls
│   ├── main.tsx
│   └── types.ts
├── CONTRACT.md                # the frontend/backend API contract
└── .env.example
```

## Running it locally

You'll need the backend and frontend running at the same time, in separate terminals.

**Backend**

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env   # then edit MODEL_PATH / CORS_ORIGINS if needed
uvicorn main:app --reload --port 8000
```

**Frontend**

```bash
npm install
echo "VITE_BACKEND_URL=http://127.0.0.1:8000/predict" > .env
npm run dev
```

Open the URL Vite prints (typically `http://localhost:5173`), allow camera access, and start spelling.

### Retraining the model

The trained checkpoint (`backend/model/model.pt`) is committed to the repo, so you don't need to retrain anything to run the app. If you want to reproduce or retrain it:

```bash
cd ml
pip install -r requirements.txt
python extract_landmarks.py --data_dir path/to/asl_alphabet_train --out landmarks.csv
python train_classifier.py --data landmarks.csv --out ../backend/model/model.pt
```

## API contract

The frontend/backend interface is documented in [`CONTRACT.md`](./CONTRACT.md) — request/response shape, error cases, and the current confidence threshold.

## Status

Actively in development. Core pipeline (webcam → landmarks → prediction → confirm → speak) is working end to end. Currently in integration testing and polish.

## License

MIT — see [`LICENSE`](./LICENSE).
