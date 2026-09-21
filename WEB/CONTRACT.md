# Signify API Contract

This is the agreed interface between the frontend (bro) and the backend/model (you).
Both sides build against this — if it needs to change, update this file first, then tell each other before changing code.

## Endpoint

```
POST /predict
```

## Request

The frontend sends **hand landmarks**, not raw frames — MediaPipe runs client-side (in the browser, via `@mediapipe/hands` or similar), and only the extracted landmark coordinates are sent over the network. This keeps payloads small and avoids sending image data.

```json
{
  "landmarks": [
    { "x": 0.42, "y": 0.61, "z": -0.03 },
    { "x": 0.45, "y": 0.58, "z": -0.02 }
  ]
}
```

- Always exactly **21 points** (MediaPipe Hands' fixed landmark count).
- `x`, `y` are normalized image coordinates (0.0–1.0). `z` is relative depth from MediaPipe.
- Sending interval: frontend sends on a timer, not every frame — **every 150ms** to start. Adjust together if recognition feels laggy or the backend can't keep up.

## Response

```json
{
  "predicted_sign": "A",
  "confidence": 0.94
}
```

- `predicted_sign`: single uppercase letter (A–Z), matching ASL fingerspelling alphabet labels.
- `confidence`: float between 0.0 and 1.0.

## Error responses

```json
{ "error": "no_hand_detected" }
```
```json
{ "error": "invalid_landmarks" }
```

Frontend should treat any non-200 response, a timeout, or an `error` field as "no confident prediction this frame" — not crash, just skip updating the hold-timer.

## Confidence threshold

Frontend treats predictions below **0.75 confidence** as "not confident enough to count toward the hold timer." This number is a starting point — tune together once real model accuracy is known (Phase 6).

## Open items (fill in once decided)

- [ ] Final confidence threshold after real-world testing
- [ ] Whether `/predict` needs a session/request ID for logging
- [ ] Rate limit / max requests per second the backend can realistically handle
