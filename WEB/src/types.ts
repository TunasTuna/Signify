export interface MockPrediction {
  sign: string | null;
  confidence: number;
}

export type CameraStatus = 'idle' | 'requesting' | 'connected' | 'error';
