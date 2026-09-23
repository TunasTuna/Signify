"""
train_classifier.py

Trains an MLP baseline on landmarks.csv (produced by extract_landmarks.py) to
classify ASL fingerspelling letters from MediaPipe hand landmarks.

Usage:
    python train_classifier.py --data landmarks.csv --out model.pt

Outputs:
    - model.pt: trained weights + label mapping, ready to load for inference
    - Prints overall + per-letter validation accuracy
"""

import argparse
import json

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder


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


def normalize_landmarks(coords):
    coords = coords.reshape(-1, 21, 3).copy()
    wrist = coords[:, 0:1, :]
    coords -= wrist
    scale = np.linalg.norm(coords, axis=2).max(axis=1, keepdims=True)
    scale = np.where(scale == 0, 1, scale)
    coords /= scale[:, :, np.newaxis]
    return coords.reshape(-1, 63)


def main():
    parser = argparse.ArgumentParser(description="Train the Signify landmark classifier.")
    parser.add_argument("--data", default="landmarks.csv", help="Path to landmarks.csv")
    parser.add_argument("--out", default="model.pt", help="Output path for trained model")
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument("--batch_size", type=int, default=64)
    parser.add_argument("--lr", type=float, default=1e-3)
    args = parser.parse_args()

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Using device: {device}")

    df = pd.read_csv(args.data)
    labels_raw = df["label"].values
    coords_raw = df.drop(columns=["label"]).values.astype(np.float32)

    coords = normalize_landmarks(coords_raw)

    encoder = LabelEncoder()
    labels = encoder.fit_transform(labels_raw)
    num_classes = len(encoder.classes_)
    print(f"Classes ({num_classes}): {list(encoder.classes_)}")

    X_train, X_val, y_train, y_val = train_test_split(
        coords, labels, test_size=0.15, random_state=42, stratify=labels
    )

    X_train = torch.tensor(X_train, dtype=torch.float32).to(device)
    y_train = torch.tensor(y_train, dtype=torch.long).to(device)
    X_val = torch.tensor(X_val, dtype=torch.float32).to(device)
    y_val = torch.tensor(y_val, dtype=torch.long).to(device)

    model = LandmarkMLP(input_dim=63, num_classes=num_classes).to(device)
    criterion = nn.CrossEntropyLoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=args.lr)

    n_samples = X_train.shape[0]
    best_val_acc = 0.0

    for epoch in range(1, args.epochs + 1):
        model.train()
        perm = torch.randperm(n_samples)
        total_loss = 0.0

        for i in range(0, n_samples, args.batch_size):
            idx = perm[i : i + args.batch_size]
            xb, yb = X_train[idx], y_train[idx]

            optimizer.zero_grad()
            logits = model(xb)
            loss = criterion(logits, yb)
            loss.backward()
            optimizer.step()
            total_loss += loss.item() * xb.size(0)

        avg_loss = total_loss / n_samples

        model.eval()
        with torch.no_grad():
            val_logits = model(X_val)
            val_preds = val_logits.argmax(dim=1)
            val_acc = (val_preds == y_val).float().mean().item()

        if val_acc > best_val_acc:
            best_val_acc = val_acc
            best_state = {k: v.clone() for k, v in model.state_dict().items()}

        if epoch % 5 == 0 or epoch == 1:
            print(f"Epoch {epoch:3d}/{args.epochs} | train_loss={avg_loss:.4f} | val_acc={val_acc:.4f}")

    model.load_state_dict(best_state)
    model.eval()

    print(f"\nBest validation accuracy: {best_val_acc:.4f}")

    with torch.no_grad():
        val_logits = model(X_val)
        val_preds = val_logits.argmax(dim=1).cpu().numpy()
    y_val_np = y_val.cpu().numpy()

    print("\nPer-letter validation accuracy:")
    for class_idx, class_name in enumerate(encoder.classes_):
        mask = y_val_np == class_idx
        if mask.sum() == 0:
            continue
        acc = (val_preds[mask] == class_idx).mean()
        print(f"  {class_name}: {acc:.3f}  (n={mask.sum()})")

    torch.save(
        {
            "model_state_dict": model.state_dict(),
            "label_classes": encoder.classes_.tolist(),
            "input_dim": 63,
            "num_classes": num_classes,
        },
        args.out,
    )
    print(f"\nSaved model to {args.out}")


if __name__ == "__main__":
    main()
