import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Moon, Sun } from 'lucide-react';
import { CameraStatus, MockPrediction } from './types.ts';

const CONFIDENCE_THRESHOLD = 0.7;
const DEFAULT_HOLD_DURATION_MS = 1000;

const MOCK_PHRASES = ['SIGNIFY', 'HELLO', 'WORLD', 'FAST'];

export default function App() {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(
    () => localStorage.getItem('signify-theme') === 'dark',
  );
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('idle');
  const [cameraErrorMsg, setCameraErrorMsg] = useState<string>('');

  useEffect(() => {
    localStorage.setItem('signify-theme', isDarkMode ? 'dark' : 'light');
    document.documentElement.style.colorScheme = isDarkMode ? 'dark' : 'light';
  }, [isDarkMode]);

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
    <div
      className="signify-theme min-h-screen bg-white text-slate-900 p-4 sm:p-6 lg:p-8"
      data-theme={isDarkMode ? 'dark' : 'light'}
    >
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-[28px] border border-[#1a2d41] bg-[#071b2b]/85 p-4 shadow-[0_0_36px_rgba(53,122,179,0.15)] backdrop-blur-sm sm:p-5">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-black tracking-[-0.05em] text-white sm:text-3xl">Signify</h1>
              <button
                id="btn-theme-toggle"
                type="button"
                onClick={() => setIsDarkMode((current) => !current)}
                aria-label={`Switch to ${isDarkMode ? 'light' : 'dark'} mode`}
                aria-pressed={isDarkMode}
                title={`Switch to ${isDarkMode ? 'light' : 'dark'} mode`}
                className="rounded-full border border-slate-300 bg-white p-2 text-slate-700 transition hover:bg-slate-100"
              >
                {isDarkMode ? <Sun aria-hidden="true" size={16} /> : <Moon aria-hidden="true" size={16} />}
              </button>
              <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-200">
                Frontend
              </span>
            </div>
            <p className="mt-1 font-mono text-[11px] text-slate-300 sm:text-xs">
              Sign Language Fingerspelling Translator &middot; Confirm-by-Hold Engine
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] sm:text-xs">
            <div
              id="camera-status-indicator"
              className={`rounded-full border px-2.5 py-1.5 font-semibold uppercase ${
                cameraStatus === 'connected'
                  ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300'
                  : cameraStatus === 'requesting'
                  ? 'border-amber-400/30 bg-amber-500/10 text-amber-300'
                  : 'border-slate-500/30 bg-slate-500/10 text-slate-300'
              }`}
            >
              CAM: {cameraStatus === 'connected' ? 'CONNECTED' : cameraStatus.toUpperCase()}
            </div>

            <div
              id="confidence-status-indicator"
              className={`rounded-full border px-2.5 py-1.5 font-semibold uppercase ${
                prediction.sign === null
                  ? 'border-slate-600/40 bg-slate-500/10 text-slate-400'
                  : isConfidenceTooLow
                  ? 'border-rose-400/30 bg-rose-500/10 text-rose-300'
                  : 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300'
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
            <div className="rounded-[26px] border border-[#1a2d41] bg-[#071b2b]/80 p-3 shadow-[0_0_30px_rgba(44,96,146,0.12)] sm:p-4">
              <div className="mb-3 flex items-center justify-between border-b border-slate-700/80 pb-3">
                <span className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-slate-300">
                  1. Raw Webcam Feed
                </span>
                <div className="flex items-center gap-2">
                  {cameraStatus === 'connected' ? (
                    <button
                      id="btn-stop-camera"
                      onClick={stopCamera}
                      className="rounded-xl border border-slate-600 bg-slate-700/80 px-2.5 py-1.5 text-[10px] font-mono font-bold uppercase text-slate-100 transition hover:bg-slate-600"
                    >
                      STOP CAM
                    </button>
                  ) : (
                    <button
                      id="btn-start-camera"
                      onClick={startCamera}
                      className="rounded-xl border border-sky-500/60 bg-sky-500/80 px-2.5 py-1.5 text-[10px] font-mono font-bold uppercase text-slate-950 transition hover:bg-sky-400"
                    >
                      START CAM
                    </button>
                  )}
                </div>
              </div>

              <div className="relative flex aspect-4/3 items-center justify-center overflow-hidden rounded-[22px] border border-slate-700 bg-slate-950">
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
                  <div className="max-w-sm p-6 text-center font-mono text-sm text-slate-400">
                    <p className="mb-2 text-base font-bold text-white">Webcam Inactive</p>
                    {cameraStatus === 'requesting' && <p>Requesting camera permission...</p>}
                    {cameraStatus === 'error' && (
                      <div className="space-y-3">
                        <p className="text-xs text-rose-300">{cameraErrorMsg}</p>
                        <button
                          onClick={startCamera}
                          className="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[10px] font-bold uppercase text-white transition hover:bg-white/20"
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

              <div className="mt-4 space-y-2 border-t border-slate-700/80 pt-3">
                <div className="flex items-center justify-between gap-2 font-mono text-[10px] font-bold uppercase sm:text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-300">Hold Timer:</span>
                    {candidateRef.current ? (
                      <span className="text-slate-100">
                        Holding &quot;{candidateRef.current}&quot; ({progress}%)
                      </span>
                    ) : (
                      <span className="text-slate-400">Idle (Hold sign to confirm)</span>
                    )}
                  </div>
                  <span className="text-slate-400">{holdDurationMs}ms target</span>
                </div>

                <div
                  id="hold-timer-container"
                  className="relative h-8 w-full overflow-hidden rounded-full border border-slate-700 bg-slate-800"
                >
                  <div
                    id="hold-timer-bar"
                    className={`h-full transition-all duration-75 ${
                      isCommittedRef.current
                        ? 'bg-emerald-500'
                        : isConfidenceTooLow
                        ? 'bg-rose-400'
                        : 'bg-sky-400'
                    }`}
                    style={{ width: `${progress}%` }}
                  />
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-[10px] font-bold uppercase text-slate-100">
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
            <div className="space-y-3 rounded-[26px] border border-[#1a2d41] bg-[#071b2b]/80 p-4 shadow-[0_0_30px_rgba(44,96,146,0.12)]">
              <div className="flex items-center justify-between border-b border-slate-700/80 pb-2">
                <label
                  htmlFor="message-buffer-input"
                  className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-slate-300"
                >
                  4. Message Buffer
                </label>
                <span className="font-mono text-[10px] text-slate-400">
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
                  className="w-full resize-none rounded-2xl border border-slate-700 bg-slate-900/80 p-3 font-mono text-lg font-bold tracking-[0.18em] text-slate-100 outline-none transition focus:border-sky-400 focus:bg-slate-900"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <button
                  id="btn-space"
                  onClick={handleAddSpace}
                  className="rounded-xl border border-slate-600 bg-slate-800 px-3 py-2 font-mono text-[10px] font-bold uppercase text-slate-100 transition hover:bg-slate-700"
                >
                  [Space]
                </button>
                <button
                  id="btn-backspace"
                  onClick={handleDeleteLast}
                  disabled={messageBuffer.length === 0}
                  className="rounded-xl border border-slate-600 bg-slate-800 px-3 py-2 font-mono text-[10px] font-bold uppercase text-slate-100 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Backspace
                </button>
                <button
                  id="btn-clear"
                  onClick={handleClearBuffer}
                  disabled={messageBuffer.length === 0}
                  className="rounded-xl border border-slate-600 bg-slate-800 px-3 py-2 font-mono text-[10px] font-bold uppercase text-slate-100 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Clear
                </button>
              </div>

              <div className="border-t border-slate-700/80 pt-2">
                <button
                  id="btn-speak"
                  onClick={handleSpeak}
                  disabled={messageBuffer.trim().length === 0 || isSpeaking}
                  className={`w-full rounded-2xl border px-4 py-3 font-mono text-sm font-black uppercase tracking-[0.12em] transition ${
                    isSpeaking
                      ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                      : messageBuffer.trim().length === 0
                      ? 'cursor-not-allowed border-slate-700 bg-slate-800 text-slate-500'
                      : 'border-sky-500/60 bg-sky-500/80 text-slate-950 hover:bg-sky-400'
                  }`}
                >
                  {isSpeaking ? 'Speaking...' : 'Speak Message (TTS)'}
                </button>
              </div>
            </div>

            <div className="space-y-4 rounded-[26px] border border-[#1a2d41] bg-[#071b2b]/80 p-4 shadow-[0_0_30px_rgba(44,96,146,0.12)]">
              <div className="flex items-center justify-between border-b border-slate-700/80 pb-2">
                <span className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-slate-300">
                  2. Mock Backend Simulator
                </span>
                <span className="font-mono text-[10px] font-semibold text-slate-400">
                  {isMockStreamRunning ? '[STREAMING]' : '[PAUSED]'}
                </span>
              </div>

              <div className="space-y-2 rounded-2xl border border-slate-700 bg-slate-900/70 p-3 font-mono text-[11px]">
                <div className="flex justify-between gap-3">
                  <span className="text-slate-400">Raw Prediction:</span>
                  <span className="font-bold text-slate-100">
                    {prediction.sign ? `"${prediction.sign}"` : 'null'}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-slate-400">Raw Confidence:</span>
                  <span
                    className={`font-bold ${
                      isConfidenceTooLow ? 'text-rose-300' : 'text-slate-100'
                    }`}
                  >
                    {prediction.confidence.toFixed(2)} ({(prediction.confidence * 100).toFixed(0)}%)
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-slate-400">Hold Duration:</span>
                  <span className="font-bold text-slate-100">{holdDurationMs}ms</span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    id="btn-toggle-stream"
                    onClick={() => setIsMockStreamRunning((prev) => !prev)}
                    className={`rounded-xl border px-2 py-2 font-mono text-[10px] font-bold uppercase transition ${
                      isMockStreamRunning
                        ? 'border-sky-500/50 bg-sky-500/80 text-slate-950 hover:bg-sky-400'
                        : 'border-slate-600 bg-slate-800 text-slate-100 hover:bg-slate-700'
                    }`}
                  >
                    {isMockStreamRunning ? 'Pause Auto Stream' : 'Resume Auto Stream'}
                  </button>

                  <button
                    id="btn-toggle-confidence"
                    onClick={() => setForceLowConfidence((prev) => !prev)}
                    className={`rounded-xl border px-2 py-2 font-mono text-[10px] font-bold uppercase transition ${
                      forceLowConfidence
                        ? 'border-rose-500/50 bg-rose-500/10 text-rose-200'
                        : 'border-slate-600 bg-slate-800 text-slate-100 hover:bg-slate-700'
                    }`}
                  >
                    {forceLowConfidence ? 'Force Low Conf: ON' : 'Force Low Conf: OFF'}
                  </button>
                </div>

                <div className="flex items-center justify-between gap-3 pt-1 font-mono text-[10px]">
                  <span className="font-bold uppercase tracking-[0.12em] text-slate-300">Hold Speed:</span>
                  <div className="flex gap-1.5">
                    {[600, 1000, 1500].map((ms) => (
                      <button
                        key={ms}
                        onClick={() => setHoldDurationMs(ms)}
                        className={`rounded-lg border px-2 py-1 font-bold transition ${
                          holdDurationMs === ms
                            ? 'border-sky-500/50 bg-sky-500/80 text-slate-950'
                            : 'border-slate-600 bg-slate-900 text-slate-200 hover:bg-slate-800'
                        }`}
                      >
                        {ms}ms
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-2 border-t border-slate-700/80 pt-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-slate-300">
                    Manual Sign Injection (Hold to test):
                  </span>
                  <span className="font-mono text-[10px] text-slate-500">Click &amp; Hold</span>
                </div>
                <div className="grid grid-cols-6 gap-1.5">
                  {['A', 'B', 'C', 'H', 'E', 'L', 'O', 'S', 'I', 'G', 'N', 'Y'].map((letter) => (
                    <button
                      key={letter}
                      onMouseDown={() => handleManualHold(letter)}
                      onMouseUp={handleManualRelease}
                      onTouchStart={() => handleManualHold(letter)}
                      onTouchEnd={handleManualRelease}
                      className="rounded-xl border border-slate-600 bg-slate-800 px-1 py-2 font-mono text-sm font-black text-slate-100 shadow-sm transition hover:bg-slate-700 active:bg-sky-400 active:text-slate-950"
                    >
                      {letter}
                    </button>
                  ))}
                </div>
                <p className="font-mono text-[10px] text-slate-400">
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
