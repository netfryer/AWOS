/**
 * Calibration types for adaptive expertise.
 */

export interface CalibrationKey {
  modelId: string;
  taskType: string;
}

export interface CalibrationRecord {
  modelId: string;
  taskType: string;
  n: number;
  ewmaQuality: number;
  ewmaAbsDev: number;
  updatedAt: string;
}

export interface ComputedCalibration {
  modelId: string;
  taskType: string;
  calibratedExpertise: number;
  confidence: number;
}
