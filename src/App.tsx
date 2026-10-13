import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CameraStatus, MockPrediction } from './types.ts';

const CONFIDENCE_THRESHOLD = 0.7;
const DEFAULT_HOLD_DURATION_MS = 1000;

const MOCK_PHRASES = ['SIGNIFY', 'HELLO', 'WORLD', 'FAST'];

export default function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('idle');
  const [cameraErrorMsg, setCameraErrorMsg] = useState<string>('');

  const startCamera = useCallback(async () => {
    setCameraStatus('requesting');
    setCameraErrorMsg('');
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('getUserMedia not supported in this browser');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user',
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraStatus('connected');
    } catch (err: unknown) {
      console.warn('Webcam access error:', err);
      const msg = err instanceof Error ? err.message : 'Webcam permission denied or unavailable';
      setCameraStatus('error');
      setCameraErrorMsg(msg);
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraStatus('idle');
  }, []);

  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  const [prediction, setPrediction] = useState<MockPrediction>({
    sign: null,
    confidence: 0,
  });

  const [isMockStreamRunning, setIsMockStreamRunning] = useState<boolean>(true);
  const [forceLowConfidence, setForceLowConfidence] = useState<boolean>(false);
  const [holdDurationMs, setHoldDurationMs] = useState<number>(DEFAULT_HOLD_DURATION_MS);

  const mockStateRef = useRef<{
    phraseIndex: number;
    charIndex: number;
    holdTicksRemaining: number;
    pauseTicksRemaining: number;
  }>({
    phraseIndex: 0,
    charIndex: 0,
    holdTicksRemaining: 5,
    pauseTicksRemaining: 0,
  });

  const getNextMockPrediction = useCallback((): MockPrediction => {
    if (forceLowConfidence) {
      return {
        sign: 'A',
        confidence: Number((0.35 + Math.random() * 0.25).toFixed(2)),
      };
    }

    const state = mockStateRef.current;
    const currentPhrase = MOCK_PHRASES[state.phraseIndex % MOCK_PHRASES.length];

    if (state.pauseTicksRemaining > 0) {
      state.pauseTicksRemaining -= 1;
      return { sign: null, confidence: 0.1 };
    }

    if (state.holdTicksRemaining > 0) {
      state.holdTicksRemaining -= 1;
      const currentChar = currentPhrase[state.charIndex % currentPhrase.length];
      const confidence = Number((0.82 + Math.random() * 0.16).toFixed(2));
      return { sign: currentChar, confidence };
    }

    state.charIndex += 1;
    if (state.charIndex >= currentPhrase.length) {
      state.charIndex = 0;
      state.phraseIndex += 1;
      state.pauseTicksRemaining = 4;
    } else {
      state.pauseTicksRemaining = 2;
    }
    state.holdTicksRemaining = 6;

    return { sign: null, confidence: 0.2 };
  }, [forceLowConfidence]);

  useEffect(() => {
    if (!isMockStreamRunning) return;

    const interval = setInterval(() => {
      const next = getNextMockPrediction();
      setPrediction(next);
    }, 200);

    return () => clearInterval(interval);
  }, [isMockStreamRunning, getNextMockPrediction]);

  const handleManualHold = (sign: string) => {
    setIsMockStreamRunning(false);
    setPrediction({
      sign,
      confidence: forceLowConfidence ? 0.52 : 0.95,
    });
  };

  const handleManualRelease = () => {
    setPrediction({ sign: null, confidence: 0 });
  };

  const [progress, setProgress] = useState<number>(0);
  const [messageBuffer, setMessageBuffer] = useState<string>('');
  const [lockedNotice, setLockedNotice] = useState<string | null>(null);

  const candidateRef = useRef<string | null>(null);
  const holdStartTimeRef = useRef<number>(0);
  const isCommittedRef = useRef<boolean>(false);
  const lockedNoticeTimeoutRef = useRef<number | null>(null);

  const commitLetter = useCallback((letter: string) => {
    setMessageBuffer((prev) => prev + letter);

    setLockedNotice(letter);
    if (lockedNoticeTimeoutRef.current) {
      window.clearTimeout(lockedNoticeTimeoutRef.current);
    }
    lockedNoticeTimeoutRef.current = window.setTimeout(() => {
      setLockedNotice(null);
    }, 1200);
  }, []);

  useEffect(() => {
    const isConfidenceValid = prediction.confidence >= CONFIDENCE_THRESHOLD;
    const currentSign = prediction.sign;

    if (!isConfidenceValid || !currentSign) {
      candidateRef.current = null;
      isCommittedRef.current = false;
      setProgress(0);
      return;
    }

    if (currentSign !== candidateRef.current) {
      candidateRef.current = currentSign;
      holdStartTimeRef.current = performance.now();
      isCommittedRef.current = false;
      setProgress(0);
    }
  }, [prediction]);

  useEffect(() => {
    let animationFrameId: number;

    const tick = () => {
      const candidate = candidateRef.current;

      if (candidate && !isCommittedRef.current) {
        const elapsed = performance.now() - holdStartTimeRef.current;
        const currentProgress = Math.min(100, Math.floor((elapsed / holdDurationMs) * 100));
        setProgress(currentProgress);

        if (elapsed >= holdDurationMs) {
          isCommittedRef.current = true;
          setProgress(100);
          commitLetter(candidate);
        }
      } else if (candidate && isCommittedRef.current) {
        setProgress(100);
      } else {
        setProgress(0);
      }

      animationFrameId = requestAnimationFrame(tick);
    };

    animationFrameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrameId);
  }, [holdDurationMs, commitLetter]);

  const handleClearBuffer = () => {
    setMessageBuffer('');
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  };

  const handleDeleteLast = () => {
    setMessageBuffer((prev) => prev.slice(0, -1));
  };

  const handleAddSpace = () => {
    setMessageBuffer((prev) => prev + ' ');
  };

  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);

  const handleSpeak = () => {
    const textToSpeak = messageBuffer.trim();
    if (!textToSpeak) return;

    if (!('speechSynthesis' in window)) {
      alert('Text-to-Speech is not supported in this browser.');
      return;
    }

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    utterance.rate = 0.95;
    utterance.pitch = 1.0;

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = (e) => {
      console.warn('TTS error:', e);
      setIsSpeaking(false);
    };

    window.speechSynthesis.speak(utterance);
  };

  const isConfidenceTooLow =
    prediction.sign !== null && prediction.confidence < CONFIDENCE_THRESHOLD;

  return (
    <div className="min-h-screen bg-[#f3efe8] text-zinc-900 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-[28px] border border-zinc-200 bg-white/80 p-4 shadow-[0_12px_30px_rgba(15,23,42,0.06)] backdrop-blur-sm sm:p-5">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-black tracking-[-0.05em] text-zinc-900 sm:text-3xl">Signify</h1>
              <span className="rounded-full border border-zinc-300 bg-zinc-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
                Frontend
              </span>
            </div>
            <p className="mt-1 font-mono text-[11px] text-zinc-600 sm:text-xs">
              Sign Language Fingerspelling Translator &middot; Confirm-by-Hold Engine
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] sm:text-xs">
            <div
              id="camera-status-indicator"
              className={`rounded-full border px-2.5 py-1.5 font-semibold uppercase ${
                cameraStatus === 'connected'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : cameraStatus === 'requesting'
                  ? 'border-amber-200 bg-amber-50 text-amber-700'
                  : 'border-zinc-200 bg-zinc-100 text-zinc-700'
              }`}
            >
              CAM: {cameraStatus === 'connected' ? 'CONNECTED' : cameraStatus.toUpperCase()}
            </div>

            <div
              id="confidence-status-indicator"
              className={`rounded-full border px-2.5 py-1.5 font-semibold uppercase ${
                prediction.sign === null
                  ? 'border-zinc-200 bg-zinc-100 text-zinc-500'
                  : isConfidenceTooLow
                  ? 'border-rose-200 bg-rose-50 text-rose-700'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-700'
              }`}
            >
              {prediction.sign === null
                ? 'CONFIDENCE: IDLE'
                : isConfidenceTooLow
                ? `CONFIDENCE: ${(prediction.confidence * 100).toFixed(0)}% (TOO LOW <70%)`
                : `CONFIDENCE: ${(prediction.confidence * 100).toFixed(0)}% (OK)`}
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <section className="flex flex-col gap-4 lg:col-span-7">
            <div className="rounded-[26px] border border-zinc-200 bg-white p-3 shadow-[0_12px_30px_rgba(15,23,42,0.04)] sm:p-4">
              <div className="mb-3 flex items-center justify-between border-b border-zinc-200 pb-3">
                <span className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-zinc-600">
                  1. Raw Webcam Feed
                </span>
                <div className="flex items-center gap-2">
                  {cameraStatus === 'connected' ? (
                    <button
                      id="btn-stop-camera"
                      onClick={stopCamera}
                      className="rounded-xl border border-zinc-300 bg-zinc-100 px-2.5 py-1.5 text-[10px] font-mono font-bold uppercase text-zinc-700 transition hover:bg-zinc-200"
                    >
                      STOP CAM
                    </button>
                  ) : (
                    <button
                      id="btn-start-camera"
                      onClick={startCamera}
                      className="rounded-xl border border-zinc-900 bg-zinc-900 px-2.5 py-1.5 text-[10px] font-mono font-bold uppercase text-white transition hover:bg-zinc-700"
                    >
                      START CAM
                    </button>
                  )}
                </div>
              </div>

              <div className="relative flex aspect-4/3 items-center justify-center overflow-hidden rounded-[22px] border border-zinc-200 bg-zinc-950">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`h-full w-full object-cover ${
                    cameraStatus === 'connected' ? 'block' : 'hidden'
                  }`}
                />

                {cameraStatus !== 'connected' && (
                  <div className="max-w-sm p-6 text-center font-mono text-sm text-zinc-400">
                    <p className="mb-2 text-base font-bold text-white">Webcam Inactive</p>
                    {cameraStatus === 'requesting' && <p>Requesting camera permission...</p>}
                    {cameraStatus === 'error' && (
                      <div className="space-y-3">
                        <p className="text-xs text-rose-400">{cameraErrorMsg}</p>
                        <button
                          onClick={startCamera}
                          className="rounded-lg border border-white bg-white px-3 py-1.5 text-[10px] font-bold uppercase text-zinc-900 transition hover:bg-zinc-200"
                        >
                          Retry Camera Permission
                        </button>
                      </div>
                    )}
                    {cameraStatus === 'idle' && (
                      <p className="text-xs">
                        Camera is stopped. Click &quot;START CAM&quot; above to begin live feed.
                      </p>
                    )}
                  </div>
                )}

                <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full border border-white/40 bg-black/70 px-3 py-1.5 font-mono text-[10px] font-bold uppercase text-white shadow-lg backdrop-blur-sm">
                  <span>PREDICTED:</span>
                  <span className="text-base text-amber-300">{prediction.sign ?? '—'}</span>
                </div>

                {lockedNotice && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/45 backdrop-blur-[2px]">
                    <div className="border border-white/20 bg-white/95 p-4 text-center shadow-2xl">
                      <div className="text-[10px] font-mono font-bold uppercase tracking-[0.22em] text-zinc-500">
                        LOCKED IN
                      </div>
                      <div className="mt-2 font-mono text-6xl font-black text-zinc-900">{lockedNotice}</div>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-4 space-y-2 border-t border-zinc-200 pt-3">
                <div className="flex items-center justify-between gap-2 font-mono text-[10px] font-bold uppercase sm:text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-600">Hold Timer:</span>
                    {candidateRef.current ? (
                      <span className="text-zinc-900">
                        Holding &quot;{candidateRef.current}&quot; ({progress}%)
                      </span>
                    ) : (
                      <span className="text-zinc-400">Idle (Hold sign to confirm)</span>
                    )}
                  </div>
                  <span className="text-zinc-500">{holdDurationMs}ms target</span>
                </div>

                <div
                  id="hold-timer-container"
                  className="relative h-8 w-full overflow-hidden rounded-full border border-zinc-200 bg-zinc-100"
                >
                  <div
                    id="hold-timer-bar"
                    className={`h-full transition-all duration-75 ${
                      isCommittedRef.current
                        ? 'bg-emerald-500'
                        : isConfidenceTooLow
                        ? 'bg-rose-400'
                        : 'bg-zinc-900'
                    }`}
                    style={{ width: `${progress}%` }}
                  />
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-[10px] font-bold uppercase text-zinc-700">
                    {isCommittedRef.current
                      ? `LOCKED: ${candidateRef.current}`
                      : progress > 0
                      ? `${progress}%`
                      : 'HOLD SIGN TO CONFIRM'}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-4 lg:col-span-5">
            <div className="space-y-3 rounded-[26px] border border-zinc-200 bg-white p-4 shadow-[0_12px_30px_rgba(15,23,42,0.04)]">
              <div className="flex items-center justify-between border-b border-zinc-200 pb-2">
                <label
                  htmlFor="message-buffer-input"
                  className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-zinc-600"
                >
                  4. Message Buffer
                </label>
                <span className="font-mono text-[10px] text-zinc-500">
                  {messageBuffer.length} chars &middot; {messageBuffer.trim().split(/\s+/).filter(Boolean).length} words
                </span>
              </div>

              <div className="relative">
                <textarea
                  id="message-buffer-input"
                  rows={4}
                  value={messageBuffer}
                  onChange={(e) => setMessageBuffer(e.target.value)}
                  placeholder="Confirmed letters will lock in here..."
                  className="w-full resize-none rounded-2xl border border-zinc-200 bg-zinc-50 p-3 font-mono text-lg font-bold tracking-[0.18em] text-zinc-900 outline-none transition focus:border-zinc-400 focus:bg-white"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <button
                  id="btn-space"
                  onClick={handleAddSpace}
                  className="rounded-xl border border-zinc-300 bg-zinc-100 px-3 py-2 font-mono text-[10px] font-bold uppercase text-zinc-700 transition hover:bg-zinc-200"
                >
                  [Space]
                </button>
                <button
                  id="btn-backspace"
                  onClick={handleDeleteLast}
                  disabled={messageBuffer.length === 0}
                  className="rounded-xl border border-zinc-300 bg-zinc-100 px-3 py-2 font-mono text-[10px] font-bold uppercase text-zinc-700 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Backspace
                </button>
                <button
                  id="btn-clear"
                  onClick={handleClearBuffer}
                  disabled={messageBuffer.length === 0}
                  className="rounded-xl border border-zinc-300 bg-zinc-100 px-3 py-2 font-mono text-[10px] font-bold uppercase text-zinc-700 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Clear
                </button>
              </div>

              <div className="border-t border-zinc-200 pt-2">
                <button
                  id="btn-speak"
                  onClick={handleSpeak}
                  disabled={messageBuffer.trim().length === 0 || isSpeaking}
                  className={`w-full rounded-2xl border px-4 py-3 font-mono text-sm font-black uppercase tracking-[0.12em] transition ${
                    isSpeaking
                      ? 'border-amber-200 bg-amber-100 text-amber-800'
                      : messageBuffer.trim().length === 0
                      ? 'cursor-not-allowed border-zinc-200 bg-zinc-100 text-zinc-400'
                      : 'border-zinc-900 bg-zinc-900 text-white hover:bg-zinc-700'
                  }`}
                >
                  {isSpeaking ? 'Speaking...' : 'Speak Message (TTS)'}
                </button>
              </div>
            </div>

            <div className="space-y-4 rounded-[26px] border border-zinc-200 bg-white p-4 shadow-[0_12px_30px_rgba(15,23,42,0.04)]">
              <div className="flex items-center justify-between border-b border-zinc-200 pb-2">
                <span className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-zinc-600">
                  2. Mock Backend Simulator
                </span>
                <span className="font-mono text-[10px] font-semibold text-zinc-500">
                  {isMockStreamRunning ? '[STREAMING]' : '[PAUSED]'}
                </span>
              </div>

              <div className="space-y-2 rounded-2xl border border-zinc-200 bg-zinc-50 p-3 font-mono text-[11px]">
                <div className="flex justify-between gap-3">
                  <span className="text-zinc-600">Raw Prediction:</span>
                  <span className="font-bold text-zinc-900">
                    {prediction.sign ? `"${prediction.sign}"` : 'null'}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-zinc-600">Raw Confidence:</span>
                  <span
                    className={`font-bold ${
                      isConfidenceTooLow ? 'text-rose-600' : 'text-zinc-900'
                    }`}
                  >
                    {prediction.confidence.toFixed(2)} ({(prediction.confidence * 100).toFixed(0)}%)
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-zinc-600">Hold Duration:</span>
                  <span className="font-bold text-zinc-900">{holdDurationMs}ms</span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    id="btn-toggle-stream"
                    onClick={() => setIsMockStreamRunning((prev) => !prev)}
                    className={`rounded-xl border px-2 py-2 font-mono text-[10px] font-bold uppercase transition ${
                      isMockStreamRunning
                        ? 'border-zinc-900 bg-zinc-900 text-white hover:bg-zinc-700'
                        : 'border-zinc-300 bg-zinc-100 text-zinc-800 hover:bg-zinc-200'
                    }`}
                  >
                    {isMockStreamRunning ? 'Pause Auto Stream' : 'Resume Auto Stream'}
                  </button>

                  <button
                    id="btn-toggle-confidence"
                    onClick={() => setForceLowConfidence((prev) => !prev)}
                    className={`rounded-xl border px-2 py-2 font-mono text-[10px] font-bold uppercase transition ${
                      forceLowConfidence
                        ? 'border-rose-200 bg-rose-50 text-rose-700'
                        : 'border-zinc-300 bg-zinc-100 text-zinc-800 hover:bg-zinc-200'
                    }`}
                  >
                    {forceLowConfidence ? 'Force Low Conf: ON' : 'Force Low Conf: OFF'}
                  </button>
                </div>

                <div className="flex items-center justify-between gap-3 pt-1 font-mono text-[10px]">
                  <span className="font-bold uppercase tracking-[0.12em] text-zinc-600">Hold Speed:</span>
                  <div className="flex gap-1.5">
                    {[600, 1000, 1500].map((ms) => (
                      <button
                        key={ms}
                        onClick={() => setHoldDurationMs(ms)}
                        className={`rounded-lg border px-2 py-1 font-bold transition ${
                          holdDurationMs === ms
                            ? 'border-zinc-900 bg-zinc-900 text-white'
                            : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100'
                        }`}
                      >
                        {ms}ms
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-2 border-t border-zinc-200 pt-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-zinc-600">
                    Manual Sign Injection (Hold to test):
                  </span>
                  <span className="font-mono text-[10px] text-zinc-400">Click &amp; Hold</span>
                </div>
                <div className="grid grid-cols-6 gap-1.5">
                  {['A', 'B', 'C', 'H', 'E', 'L', 'O', 'S', 'I', 'G', 'N', 'Y'].map((letter) => (
                    <button
                      key={letter}
                      onMouseDown={() => handleManualHold(letter)}
                      onMouseUp={handleManualRelease}
                      onTouchStart={() => handleManualHold(letter)}
                      onTouchEnd={handleManualRelease}
                      className="rounded-xl border border-zinc-300 bg-white px-1 py-2 font-mono text-sm font-black text-zinc-800 shadow-sm transition hover:bg-zinc-100 active:bg-zinc-900 active:text-white"
                    >
                      {letter}
                    </button>
                  ))}
                </div>
                <p className="font-mono text-[10px] text-zinc-500">
                  Tip: Hold down any letter button above to fill the hold bar and lock it in.
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
