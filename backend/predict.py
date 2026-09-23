"""
predict.py

Loads the trained model.pt and exposes a predict() function matching
Signify's CONTRACT.md shape: takes 21 hand landmarks, returns
{"predicted_sign": ..., "confidence": ...}.

This is the piece Phase 4's backend service will import and call directly.

Standalone usage (for a quick sanity check against a few rows of landmarks.csv):
    python predict.py --model model.pt --data landmarks.csv --n 5
"""

import argparse

import numpy as np
import pandas as pd
import torch
import torch.nn as nn


class LandmarkMLP(nn.Module):

    def __init__(self, input_dim=63, num_classes=26):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_dim, 128),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(128, 64),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(64, num_classes),
        )

    def forward(self, x):
        return self.net(x)


class SignPredictor:
    def __init__(self, model_path="model.pt", device=None):
        self.device = device or torch.device("cuda" if torch.cuda.is_available() else "cpu")
        checkpoint = torch.load(model_path, map_location=self.device)

        self.label_classes = checkpoint["label_classes"]
        self.model = LandmarkMLP(
            input_dim=checkpoint["input_dim"],
            num_classes=checkpoint["num_classes"],
        ).to(self.device)
        self.model.load_state_dict(checkpoint["model_state_dict"])
        self.model.eval()

    @staticmethod
    def _normalize(coords):
        coords = coords.reshape(21, 3).copy()
        wrist = coords[0:1, :]
        coords -= wrist
        scale = np.linalg.norm(coords, axis=1).max()
        if scale == 0:
            scale = 1
        coords /= scale
        return coords.reshape(-1)

    def predict(self, landmarks):
        if landmarks is None or len(landmarks) != 21:
            return {"error": "invalid_landmarks"}

        try:
            coords = np.array(
                [[p["x"], p["y"], p["z"]] for p in landmarks], dtype=np.float32
            ).reshape(-1)
        except (KeyError, TypeError):
            return {"error": "invalid_landmarks"}

        coords = self._normalize(coords)
        x = torch.tensor(coords, dtype=torch.float32, device=self.device).unsqueeze(0)

        with torch.no_grad():
            logits = self.model(x)
            probs = torch.softmax(logits, dim=1)
            confidence, pred_idx = probs.max(dim=1)

        predicted_sign = self.label_classes[pred_idx.item()]
        return {
            "predicted_sign": predicted_sign,
            "confidence": round(confidence.item(), 4),
        }


def main():
    parser = argparse.ArgumentParser(description="Quick sanity check for the trained model.")
    parser.add_argument("--model", default="model.pt")
    parser.add_argument("--data", default="landmarks.csv", help="landmarks.csv to sample test rows from")
    parser.add_argument("--n", type=int, default=5, help="Number of random rows to test")
    args = parser.parse_args()

    predictor = SignPredictor(model_path=args.model)

    df = pd.read_csv(args.data)
    sample = df.sample(n=args.n, random_state=None)

    print(f"Testing {args.n} random rows from {args.data}:\n")
    for _, row in sample.iterrows():
        true_label = row["label"]
        coord_values = row.drop("label").values.astype(np.float32)
        landmarks = [
            {"x": coord_values[i * 3], "y": coord_values[i * 3 + 1], "z": coord_values[i * 3 + 2]}
            for i in range(21)
        ]
        result = predictor.predict(landmarks)
        match = "✓" if result.get("predicted_sign") == true_label else "✗"
        print(f"  true={true_label}  predicted={result.get('predicted_sign')}  "
              f"confidence={result.get('confidence')}  {match}")


if __name__ == "__main__":
    main()
