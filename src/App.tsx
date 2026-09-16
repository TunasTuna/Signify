import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CameraStatus, MockPrediction } from './types.ts';
import { useSignPredictor } from './useSignPredictor';

const CONFIDENCE_THRESHOLD = 0.7;
const DEFAULT_HOLD_DURATION_MS = 1000;

// Sample simulated fingerspelling test phrases
const MOCK_PHRASES = ['SIGNIFY', 'HELLO', 'WORLD', 'FAST'];

export default function App() {
  // ---------------------------------------------------------------------------
  // 1. Camera State & Ref
  // ---------------------------------------------------------------------------
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
    // Attempt camera connection on initial mount
    startCamera();
    return () => {
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  // ---------------------------------------------------------------------------
  // 2. Mock Backend State & Prediction Stream
  // ---------------------------------------------------------------------------
  const [prediction, setPrediction] = useState<MockPrediction>({
    sign: null,
    confidence: 0,
  });

  const [isMockStreamRunning, setIsMockStreamRunning] = useState<boolean>(true);

  // Real backend predictions — active whenever the mock stream is paused.
  // This lets the existing "Pause/Resume Auto Stream" button double as a
  // mock-vs-live switch: paused = live predictions from the real backend.
  const { prediction: livePrediction, isConnected, error: backendError } = useSignPredictor(
    videoRef,
    { enabled: cameraStatus === 'connected' && !isMockStreamRunning }
  );

  useEffect(() => {
    if (!isMockStreamRunning) {
      setPrediction(livePrediction);
    }
  }, [livePrediction, isMockStreamRunning]);

  const [forceLowConfidence, setForceLowConfidence] = useState<boolean>(false);
  const [holdDurationMs, setHoldDurationMs] = useState<number>(DEFAULT_HOLD_DURATION_MS);

  // Auto-stream generator simulator state
  const mockStateRef = useRef<{
    phraseIndex: number;
    charIndex: number;
    holdTicksRemaining: number;
    pauseTicksRemaining: number;
  }>({
    phraseIndex: 0,
    charIndex: 0,
    holdTicksRemaining: 5, // ~1250ms at 250ms/tick
    pauseTicksRemaining: 0,
  });

  // Dummy prediction generator simulating incoming ML inference frames (e.g. every 200ms)
  const getNextMockPrediction = useCallback((): MockPrediction => {
    if (forceLowConfidence) {
      return {
        sign: 'A',
        confidence: Number((0.35 + Math.random() * 0.25).toFixed(2)), // 0.35 - 0.60 (too low)
      };
    }

    const state = mockStateRef.current;
    const currentPhrase = MOCK_PHRASES[state.phraseIndex % MOCK_PHRASES.length];

    // If in pause between signs (transition / rest state)
    if (state.pauseTicksRemaining > 0) {
      state.pauseTicksRemaining -= 1;
      return { sign: null, confidence: 0.1 };
    }

    // In active hold state for current sign
    if (state.holdTicksRemaining > 0) {
      state.holdTicksRemaining -= 1;
      const currentChar = currentPhrase[state.charIndex % currentPhrase.length];
      const confidence = Number((0.82 + Math.random() * 0.16).toFixed(2)); // 0.82 - 0.98
      return { sign: currentChar, confidence };
    }

    // Finished hold: switch to brief rest, then next character
    state.charIndex += 1;
    if (state.charIndex >= currentPhrase.length) {
      state.charIndex = 0;
      state.phraseIndex += 1;
      state.pauseTicksRemaining = 4; // Longer pause between words
    } else {
      state.pauseTicksRemaining = 2; // Short pause between letters (~500ms)
    }
    state.holdTicksRemaining = 6; // 6 ticks * 200ms = 1200ms of stable hold

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

  // Manual sign override for testing individual signs
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

  // ---------------------------------------------------------------------------
  // 3. The Hold-Timer Logic (Visual Feedback & Confirmation)
  // ---------------------------------------------------------------------------
  const [progress, setProgress] = useState<number>(0);
  const [messageBuffer, setMessageBuffer] = useState<string>('');
  const [lockedNotice, setLockedNotice] = useState<string | null>(null);

  // Refs to track continuous hold state accurately across animation frames
  const candidateRef = useRef<string | null>(null);
  const holdStartTimeRef = useRef<number>(0);
  const isCommittedRef = useRef<boolean>(false);
  const lockedNoticeTimeoutRef = useRef<number | null>(null);

  // Commit function when hold timer reaches 100%
  const commitLetter = useCallback((letter: string) => {
    setMessageBuffer((prev) => prev + letter);

    // Brief visual flash for locked letter
    setLockedNotice(letter);
    if (lockedNoticeTimeoutRef.current) {
      window.clearTimeout(lockedNoticeTimeoutRef.current);
    }
    lockedNoticeTimeoutRef.current = window.setTimeout(() => {
      setLockedNotice(null);
    }, 1200);
  }, []);

  // Update candidate tracker whenever incoming prediction updates
  useEffect(() => {
    const isConfidenceValid = prediction.confidence >= CONFIDENCE_THRESHOLD;
    const currentSign = prediction.sign;

    if (!isConfidenceValid || !currentSign) {
      // Prediction dropped or confidence too low -> reset hold immediately
      candidateRef.current = null;
      isCommittedRef.current = false;
      setProgress(0);
      return;
    }

    if (currentSign !== candidateRef.current) {
      // Different sign detected -> start fresh hold cycle for this sign
      candidateRef.current = currentSign;
      holdStartTimeRef.current = performance.now();
      isCommittedRef.current = false;
      setProgress(0);
    }
    // If sign is the same as candidateRef, continuous hold continues in the rAF loop
  }, [prediction]);

  // High-frequency animation loop for smooth progress bar and exact millisecond lock-in
  useEffect(() => {
    let animationFrameId: number;

    const tick = () => {
      const candidate = candidateRef.current;

      if (candidate && !isCommittedRef.current) {
        const elapsed = performance.now() - holdStartTimeRef.current;
        const currentProgress = Math.min(100, Math.floor((elapsed / holdDurationMs) * 100));
        setProgress(currentProgress);

        if (elapsed >= holdDurationMs) {
          // Locked in!
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

  // ---------------------------------------------------------------------------
  // 4. Message Buffer Actions
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // 5. Text-to-Speech (Web Speech API)
  // ---------------------------------------------------------------------------
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);

  const handleSpeak = () => {
    const textToSpeak = messageBuffer.trim();
    if (!textToSpeak) return;

    if (!('speechSynthesis' in window)) {
      alert('Text-to-Speech is not supported in this browser.');
      return;
    }

    window.speechSynthesis.cancel(); // Stop any pending utterance

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

  // ---------------------------------------------------------------------------
  // 6. Status Evaluations
  // ---------------------------------------------------------------------------
  const isConfidenceTooLow =
    prediction.sign !== null && prediction.confidence < CONFIDENCE_THRESHOLD;

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-900 font-sans p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header: Brutalist, High-Contrast Title & Metadata */}
        <header className="border-2 border-black bg-white p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight uppercase">Signify</h1>
              <span className="text-xs uppercase tracking-widest font-mono bg-black text-white px-2 py-0.5 font-bold">
                Frontend Skeleton
              </span>
            </div>
            <p className="text-xs sm:text-sm text-zinc-600 font-mono mt-1">
              Sign Language Fingerspelling Translator &middot; Confirm-by-Hold Engine
            </p>
          </div>

          {/* Quick Hardware & Engine Status Bar */}
          <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
            <div
              id="camera-status-indicator"
              className={`px-2.5 py-1 border-2 font-bold uppercase ${
                cameraStatus === 'connected'
                  ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                  : cameraStatus === 'requesting'
                  ? 'border-amber-600 bg-amber-50 text-amber-800'
                  : 'border-zinc-800 bg-zinc-200 text-zinc-800'
              }`}
            >
              CAM: {cameraStatus === 'connected' ? 'CONNECTED' : cameraStatus.toUpperCase()}
            </div>

            <div
              id="confidence-status-indicator"
              className={`px-2.5 py-1 border-2 font-bold uppercase ${
                prediction.sign === null
                  ? 'border-zinc-300 bg-zinc-50 text-zinc-500'
                  : isConfidenceTooLow
                  ? 'border-rose-600 bg-rose-50 text-rose-800'
                  : 'border-emerald-600 bg-emerald-50 text-emerald-800'
              }`}
            >
              {prediction.sign === null
                ? 'CONFIDENCE: IDLE'
                : isConfidenceTooLow
                ? `CONFIDENCE: ${(prediction.confidence * 100).toFixed(0)}% (TOO LOW <70%)`
                : `CONFIDENCE: ${(prediction.confidence * 100).toFixed(0)}% (OK)`}
            </div>

            {/* Backend connection status — only relevant once the mock stream is paused
                and we're actually talking to the real /predict endpoint. */}
            {!isMockStreamRunning && (
              <div
                id="backend-status-indicator"
                title={backendError ?? undefined}
                className={`px-2.5 py-1 border-2 font-bold uppercase ${
                  isConnected
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                    : 'border-rose-600 bg-rose-50 text-rose-800'
                }`}
              >
                {isConnected ? 'BACKEND: LIVE' : `BACKEND: UNREACHABLE`}
              </div>
            )}
          </div>
        </header>

        {/* Main Grid: Webcam View (Left) & Controls/Buffer (Right) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* =============================================================== */}
          {/* LEFT: Webcam View Container + Hold-Timer Progress Overlay       */}
          {/* =============================================================== */}
          <section className="lg:col-span-7 flex flex-col gap-4">
            <div className="border-2 border-black bg-white p-3 sm:p-4">
              <div className="flex items-center justify-between pb-3 mb-3 border-b-2 border-zinc-200">
                <span className="text-xs font-mono font-bold tracking-wider uppercase text-zinc-700">
                  1. Raw Webcam Feed
                </span>
                <div className="flex items-center gap-2">
                  {cameraStatus === 'connected' ? (
                    <button
                      id="btn-stop-camera"
                      onClick={stopCamera}
                      className="px-2 py-1 text-xs font-mono font-bold border border-black bg-zinc-100 hover:bg-zinc-200 cursor-pointer"
                    >
                      STOP CAM
                    </button>
                  ) : (
                    <button
                      id="btn-start-camera"
                      onClick={startCamera}
                      className="px-2 py-1 text-xs font-mono font-bold border border-black bg-black text-white hover:bg-zinc-800 cursor-pointer"
                    >
                      START CAM
                    </button>
                  )}
                </div>
              </div>

              {/* Video Frame */}
              <div className="relative aspect-4/3 bg-zinc-950 border-2 border-black overflow-hidden flex items-center justify-center">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`w-full h-full object-cover transform -scale-x-100 ${
                    cameraStatus === 'connected' ? 'block' : 'hidden'
                  }`}
                />

                {/* Camera Fallback / Disconnected Notice */}
                {cameraStatus !== 'connected' && (
                  <div className="p-6 text-center text-zinc-400 font-mono text-sm max-w-sm">
                    <p className="font-bold text-white mb-2">Webcam Inactive</p>
                    {cameraStatus === 'requesting' && <p>Requesting camera permission...</p>}
                    {cameraStatus === 'error' && (
                      <div className="space-y-3">
                        <p className="text-rose-400 text-xs">{cameraErrorMsg}</p>
                        <button
                          onClick={startCamera}
                          className="px-3 py-1.5 bg-white text-black font-bold text-xs border border-white hover:bg-zinc-200 cursor-pointer"
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

                {/* Candidate Sign Badge Over Video */}
                <div className="absolute top-3 left-3 bg-black text-white px-3 py-1.5 font-mono text-xs border border-white font-bold flex items-center gap-2">
                  <span>PREDICTED:</span>
                  <span className="text-base text-yellow-400 font-black">
                    {prediction.sign ?? '—'}
                  </span>
                </div>

                {/* Locked In Letter Alert */}
                {lockedNotice && (
                  <div className="absolute inset-0 bg-black/60 flex items-center justify-center pointer-events-none">
                    <div className="bg-white border-4 border-black p-4 text-center">
                      <div className="text-xs font-mono font-bold tracking-widest text-zinc-500">
                        LOCKED IN
                      </div>
                      <div className="text-6xl font-black font-mono">{lockedNotice}</div>
                    </div>
                  </div>
                )}
              </div>

              {/* =========================================================== */}
              {/* Feature 3: The Hold-Timer (Visual Feedback Bar)             */}
              {/* =========================================================== */}
              <div className="mt-4 pt-3 border-t-2 border-zinc-200 space-y-2">
                <div className="flex items-center justify-between text-xs font-mono font-bold">
                  <div className="flex items-center gap-2">
                    <span className="uppercase text-zinc-700">Hold Timer:</span>
                    {candidateRef.current ? (
                      <span className="text-black">
                        Holding &quot;{candidateRef.current}&quot; ({progress}%)
                      </span>
                    ) : (
                      <span className="text-zinc-400">Idle (Hold sign to confirm)</span>
                    )}
                  </div>
                  <span className="text-zinc-600">{holdDurationMs}ms target</span>
                </div>

                {/* Linear High-Contrast Brutalist Progress Track */}
                <div
                  id="hold-timer-container"
                  className="w-full h-7 bg-zinc-200 border-2 border-black relative overflow-hidden"
                >
                  <div
                    id="hold-timer-bar"
                    className={`h-full transition-none ${
                      isCommittedRef.current
                        ? 'bg-emerald-600'
                        : isConfidenceTooLow
                        ? 'bg-rose-500'
                        : 'bg-black'
                    }`}
                    style={{ width: `${progress}%` }}
                  />
                  <div className="absolute inset-0 flex items-center justify-center font-mono text-xs font-bold pointer-events-none mix-blend-difference text-white">
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

          {/* =============================================================== */}
          {/* RIGHT: Message Buffer, TTS, Status & Mock Backend Controller    */}
          {/* =============================================================== */}
          <section className="lg:col-span-5 flex flex-col gap-4">
            {/* Feature 4: Message Buffer */}
            <div className="border-2 border-black bg-white p-4 space-y-3">
              <div className="flex items-center justify-between border-b-2 border-zinc-200 pb-2">
                <label
                  htmlFor="message-buffer-input"
                  className="text-xs font-mono font-bold tracking-wider uppercase text-zinc-700"
                >
                  4. Message Buffer
                </label>
                <span className="text-xs font-mono text-zinc-500">
                  {messageBuffer.length} chars &middot; {messageBuffer.trim().split(/\s+/).filter(Boolean).length} words
                </span>
              </div>

              {/* Text Area */}
              <div className="relative">
                <textarea
                  id="message-buffer-input"
                  rows={4}
                  value={messageBuffer}
                  onChange={(e) => setMessageBuffer(e.target.value)}
                  placeholder="Confirmed letters will lock in here..."
                  className="w-full border-2 border-black p-3 font-mono text-lg font-bold tracking-widest bg-zinc-50 focus:bg-white focus:outline-none resize-none"
                />
              </div>

              {/* Buffer Action Buttons */}
              <div className="grid grid-cols-3 gap-2">
                <button
                  id="btn-space"
                  onClick={handleAddSpace}
                  className="py-2 px-3 border-2 border-black bg-zinc-100 hover:bg-zinc-200 font-mono text-xs font-bold uppercase cursor-pointer"
                >
                  [Space]
                </button>
                <button
                  id="btn-backspace"
                  onClick={handleDeleteLast}
                  disabled={messageBuffer.length === 0}
                  className="py-2 px-3 border-2 border-black bg-zinc-100 hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed font-mono text-xs font-bold uppercase cursor-pointer"
                >
                  Backspace
                </button>
                <button
                  id="btn-clear"
                  onClick={handleClearBuffer}
                  disabled={messageBuffer.length === 0}
                  className="py-2 px-3 border-2 border-black bg-zinc-100 hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed font-mono text-xs font-bold uppercase cursor-pointer"
                >
                  Clear
                </button>
              </div>

              {/* Feature 5: Text-to-Speech (TTS) */}
              <div className="pt-2 border-t-2 border-zinc-200">
                <button
                  id="btn-speak"
                  onClick={handleSpeak}
                  disabled={messageBuffer.trim().length === 0 || isSpeaking}
                  className={`w-full py-3 px-4 border-2 border-black font-mono text-sm font-black uppercase tracking-wider transition-none cursor-pointer ${
                    isSpeaking
                      ? 'bg-amber-400 text-black animate-pulse'
                      : messageBuffer.trim().length === 0
                      ? 'bg-zinc-200 text-zinc-400 border-zinc-400 cursor-not-allowed'
                      : 'bg-black text-white hover:bg-zinc-800'
                  }`}
                >
                  {isSpeaking ? 'Speaking...' : 'Speak Message (TTS)'}
                </button>
              </div>
            </div>

            {/* Feature 2: Mock Backend Simulator State & Testing Controls */}
            <div className="border-2 border-black bg-white p-4 space-y-4">
              <div className="flex items-center justify-between border-b-2 border-zinc-200 pb-2">
                <span className="text-xs font-mono font-bold tracking-wider uppercase text-zinc-700">
                  2. Mock Backend Simulator
                </span>
                <span className="text-xs font-mono font-bold text-zinc-500">
                  {isMockStreamRunning ? '[STREAMING]' : '[PAUSED]'}
                </span>
              </div>

              {/* Current Output Stream Inspection */}
              <div className="bg-zinc-100 border-2 border-black p-3 font-mono text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-zinc-600">Raw Prediction:</span>
                  <span className="font-bold font-mono">
                    {prediction.sign ? `"${prediction.sign}"` : 'null'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-600">Raw Confidence:</span>
                  <span
                    className={`font-bold font-mono ${
                      isConfidenceTooLow ? 'text-rose-600' : 'text-zinc-900'
                    }`}
                  >
                    {prediction.confidence.toFixed(2)} ({(prediction.confidence * 100).toFixed(0)}%)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-600">Hold Duration:</span>
                  <span className="font-bold">{holdDurationMs}ms</span>
                </div>
              </div>

              {/* Stream Controls */}
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    id="btn-toggle-stream"
                    onClick={() => setIsMockStreamRunning((prev) => !prev)}
                    className={`py-2 px-2 border-2 border-black font-mono text-xs font-bold uppercase cursor-pointer ${
                      isMockStreamRunning
                        ? 'bg-zinc-900 text-white'
                        : 'bg-zinc-100 text-black hover:bg-zinc-200'
                    }`}
                  >
                    {isMockStreamRunning ? 'Pause Auto Stream' : 'Resume Auto Stream'}
                  </button>

                  <button
                    id="btn-toggle-confidence"
                    onClick={() => setForceLowConfidence((prev) => !prev)}
                    className={`py-2 px-2 border-2 border-black font-mono text-xs font-bold uppercase cursor-pointer ${
                      forceLowConfidence
                        ? 'bg-rose-600 text-white'
                        : 'bg-zinc-100 text-black hover:bg-zinc-200'
                    }`}
                  >
                    {forceLowConfidence ? 'Force Low Conf: ON' : 'Force Low Conf: OFF'}
                  </button>
                </div>

                {/* Duration Picker */}
                <div className="flex items-center justify-between text-xs font-mono pt-1">
                  <span className="text-zinc-600 font-bold">Hold Speed:</span>
                  <div className="flex gap-1">
                    {[600, 1000, 1500].map((ms) => (
                      <button
                        key={ms}
                        onClick={() => setHoldDurationMs(ms)}
                        className={`px-2 py-0.5 border border-black font-bold cursor-pointer ${
                          holdDurationMs === ms ? 'bg-black text-white' : 'bg-white text-black'
                        }`}
                      >
                        {ms}ms
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Manual Gesture Simulator Keys (for quick test without waiting) */}
              <div className="pt-2 border-t-2 border-zinc-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold text-zinc-700">
                    Manual Sign Injection (Hold to test):
                  </span>
                  <span className="text-xs font-mono text-zinc-400">Click &amp; Hold</span>
                </div>
                <div className="grid grid-cols-6 gap-1">
                  {['A', 'B', 'C', 'H', 'E', 'L', 'O', 'S', 'I', 'G', 'N', 'Y'].map((letter) => (
                    <button
                      key={letter}
                      onMouseDown={() => handleManualHold(letter)}
                      onMouseUp={handleManualRelease}
                      onTouchStart={() => handleManualHold(letter)}
                      onTouchEnd={handleManualRelease}
                      className="py-2 border-2 border-black bg-white hover:bg-zinc-200 active:bg-black active:text-white font-mono text-sm font-black cursor-pointer select-none"
                    >
                      {letter}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] font-mono text-zinc-500">
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
