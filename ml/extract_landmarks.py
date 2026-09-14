"""
extract_landmarks.py

Runs MediaPipe Hands over the ASL Alphabet dataset and saves a landmark
dataset (21 points per image, matching Signify's CONTRACT.md format) to CSV.

Expected input layout (this is how the Kaggle ASL Alphabet dataset ships):

    asl_alphabet_train/
        A/
            A1.jpg
            A2.jpg
            ...
        B/
            B1.jpg
            ...
        ...
        space/
        del/
        nothing/

Usage:
    python extract_landmarks.py --data_dir ./asl_alphabet_train --out landmarks.csv

Output CSV columns:
    label, x0, y0, z0, x1, y1, z1, ..., x20, y20, z20

Each row is one detected hand: 21 landmarks × (x, y, z) = 63 coordinate columns,
plus the label column. Images where MediaPipe fails to detect a hand are skipped
and counted, not written.
"""

import argparse
import csv
import os
import sys

import cv2
import mediapipe as mp

VALID_LABELS = set(chr(c) for c in range(ord("A"), ord("Z") + 1))


def extract_landmarks_from_image(hands, image_path):
    image = cv2.imread(image_path)
    if image is None:
        return None

    image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    result = hands.process(image_rgb)

    if not result.multi_hand_landmarks:
        return None

    hand_landmarks = result.multi_hand_landmarks[0]
    coords = []
    for lm in hand_landmarks.landmark:
        coords.extend([lm.x, lm.y, lm.z])
    return coords


def main():
    parser = argparse.ArgumentParser(description="Extract MediaPipe hand landmarks from ASL Alphabet dataset.")
    parser.add_argument("--data_dir", required=True, help="Path to asl_alphabet_train/ folder")
    parser.add_argument("--out", default="landmarks.csv", help="Output CSV path")
    parser.add_argument("--max_per_class", type=int, default=None,
                         help="Optional cap on images processed per letter (useful for a quick first pass)")
    args = parser.parse_args()

    if not os.path.isdir(args.data_dir):
        sys.exit(f"data_dir not found: {args.data_dir}")

    mp_hands = mp.solutions.hands
    header = ["label"] + [f"{axis}{i}" for i in range(21) for axis in ("x", "y", "z")]

    total_written = 0
    total_skipped = 0

    with mp_hands.Hands(
        static_image_mode=True,
        max_num_hands=1,
        min_detection_confidence=0.5,
    ) as hands, open(args.out, "w", newline="") as f:

        writer = csv.writer(f)
        writer.writerow(header)

        class_folders = sorted(
            d for d in os.listdir(args.data_dir)
            if os.path.isdir(os.path.join(args.data_dir, d)) and d.upper() in VALID_LABELS
        )

        if not class_folders:
            sys.exit(
                "No A-Z class folders found under data_dir. "
                "Check that --data_dir points at the folder containing per-letter subfolders."
            )

        for label in class_folders:
            label_dir = os.path.join(args.data_dir, label)
            image_files = sorted(os.listdir(label_dir))
            if args.max_per_class:
                image_files = image_files[: args.max_per_class]

            written_for_label = 0
            for fname in image_files:
                image_path = os.path.join(label_dir, fname)
                coords = extract_landmarks_from_image(hands, image_path)
                if coords is None:
                    total_skipped += 1
                    continue
                writer.writerow([label.upper()] + coords)
                written_for_label += 1
                total_written += 1

            print(f"{label}: {written_for_label} written, "
                  f"{len(image_files) - written_for_label} skipped (no hand detected)")

    print(f"\nDone. {total_written} rows written to {args.out}, {total_skipped} images skipped total.")


if __name__ == "__main__":
    main()
