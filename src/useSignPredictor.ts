/**
 * useSignPredictor.ts
 *
 * Runs MediaPipe Hands on a live <video> element in the browser, extracts the
 * 21-point landmark set per CONTRACT.md, and sends it to the Signify backend
 * on a fixed interval. Returns a `prediction` object in the same shape as the
 * MockPrediction type already used in App.tsx, so it's a drop-in replacement
 * for getNextMockPrediction() — no changes needed to the hold-timer or buffer
 * logic downstream.
 *
 * Usage in App.tsx:
 *
 *   import { useSignPredictor } from './useSignPredictor';
 *
 *   // Replace the mock stream effect with:
 *   const { prediction, isConnected, error } = useSignPredictor(videoRef, {
 *     enabled: cameraStatus === 'connected',
 *   });
 *
 * Requires: npm install @mediapipe/hands @mediapipe/camera_utils
 */

import { useEffect, useRef, useState } from 'react';
import { Hands, Results as HandsResults } from '@mediapipe/hands';

// -----------------------------------------------------------------------------
// Config — adjust these to match CONTRACT.md if it changes
// -----------------------------------------------------------------------------
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:8000/predict';
const SEND_INTERVAL_MS = 150; // matches CONTRACT.md's starting interval

export interface SignPrediction {
  sign: string | null;
  confidence: number;
}

interface UseSignPredictorOptions {
  enabled: boolean; // pass cameraStatus === 'connected' — don't run MediaPipe on a dead feed
}

interface UseSignPredictorResult {
  prediction: SignPrediction;
  isConnected: boolean; // whether the backend is currently reachable
  error: string | null;
}

export function useSignPredictor(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  { enabled }: UseSignPredictorOptions
): UseSignPredictorResult {
  const [prediction, setPrediction] = useState<SignPrediction>({ sign: null, confidence: 0 });
  const [isConnected, setIsConnected] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const handsRef = useRef<Hands | null>(null);
  const lastSendTimeRef = useRef<number>(0);
  const inFlightRef = useRef<boolean>(false); // avoid overlapping requests if backend is slow

  useEffect(() => {
    if (!enabled || !videoRef.current) {
      return;
    }

    const hands = new Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });

    hands.setOptions({
      maxNumHands: 1, // fingerspelling only needs one hand
      modelComplexity: 1,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    hands.onResults(async (results: HandsResults) => {
      const now = performance.now();

      // Throttle: only send to the backend every SEND_INTERVAL_MS, not every frame
      if (now - lastSendTimeRef.current < SEND_INTERVAL_MS) {
        return;
      }
      if (inFlightRef.current) {
        return; // previous request still pending, skip this frame
      }

      const landmarks = results.multiHandLandmarks?.[0];
      if (!landmarks) {
        // No hand detected this frame — treat like a "no sign" frame, same as
        // the mock stream's pause state. Don't hit the backend for empty frames.
        setPrediction({ sign: null, confidence: 0 });
        return;
      }

      lastSendTimeRef.current = now;
      inFlightRef.current = true;

      try {
        const body = {
          landmarks: landmarks.map((lm) => ({ x: lm.x, y: lm.y, z: lm.z })),
        };

        const response = await fetch(BACKEND_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          throw new Error(`Backend returned ${response.status}`);
        }

        const data = await response.json();

        if (data.error) {
          // Matches CONTRACT.md's error shape: {"error": "no_hand_detected" | "invalid_landmarks"}
          setPrediction({ sign: null, confidence: 0 });
        } else {
          setPrediction({ sign: data.predicted_sign, confidence: data.confidence });
        }

        setIsConnected(true);
        setError(null);
      } catch (err) {
        console.warn('Prediction request failed:', err);
        setIsConnected(false);
        setError(err instanceof Error ? err.message : 'Could not reach the recognizer');
        setPrediction({ sign: null, confidence: 0 }); // don't let a stale prediction sit on screen
      } finally {
        inFlightRef.current = false;
      }
    });

    handsRef.current = hands;

    // Feed video frames into MediaPipe on every animation frame
    let animationFrameId: number;
    const processFrame = async () => {
      if (videoRef.current && videoRef.current.readyState >= 2) {
        await hands.send({ image: videoRef.current });
      }
      animationFrameId = requestAnimationFrame(processFrame);
    };
    animationFrameId = requestAnimationFrame(processFrame);

    return () => {
      cancelAnimationFrame(animationFrameId);
      hands.close();
      handsRef.current = null;
    };
  }, [enabled, videoRef]);

  return { prediction, isConnected, error };
}
