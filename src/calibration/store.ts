/**
 * Persistent calibration store. EWMA + confidence.
 * File: ./runs/calibration.json
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import type { CalibrationRecord, ComputedCalibration } from "./types.js";

const CALIBRATION_PATH = "./runs/calibration.json";
const ALPHA = 0.2;
const CONFIDENCE_N = 30;

interface StoreData {
  records: CalibrationRecord[];
}

async function loadStore(): Promise<StoreData> {
  try {
    const raw = await readFile(CALIBRATION_PATH, "utf-8");
    const parsed = JSON.parse(raw) as StoreData;
    if (Array.isArray(parsed?.records)) {
      return { records: parsed.records };
    }
  } catch {
    // file missing or invalid
  }
  return { records: [] };
}

async function saveStore(data: StoreData): Promise<void> {
  const dir = path.dirname(CALIBRATION_PATH);
  await mkdir(dir, { recursive: true });
  await writeFile(CALIBRATION_PATH, JSON.stringify(data, null, 2), "utf-8");
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Record an evaluation score. Updates EWMA and ewmaAbsDev.
 */
export async function recordEval(
  modelId: string,
  taskType: string,
  overallScore: number
): Promise<void> {
  const score = clamp(overallScore, 0, 1);
  const store = await loadStore();
  const idx = store.records.findIndex(
    (r) => r.modelId === modelId && r.taskType === taskType
  );

  const now = new Date().toISOString();
  if (idx < 0) {
    store.records.push({
      modelId,
      taskType,
      n: 1,
      ewmaQuality: score,
      ewmaAbsDev: 0,
      updatedAt: now,
    });
  } else {
    const r = store.records[idx];
    const ewmaQuality = ALPHA * score + (1 - ALPHA) * r.ewmaQuality;
    const absDev = Math.abs(score - ewmaQuality);
    const ewmaAbsDev = ALPHA * absDev + (1 - ALPHA) * r.ewmaAbsDev;
    store.records[idx] = {
      modelId,
      taskType,
      n: r.n + 1,
      ewmaQuality,
      ewmaAbsDev,
      updatedAt: now,
    };
  }
  await saveStore(store);
}

/**
 * Computed calibration for a single model+taskType.
 */
export function getComputed(
  modelId: string,
  taskType: string,
  records: CalibrationRecord[]
): ComputedCalibration | null {
  const r = records.find((x) => x.modelId === modelId && x.taskType === taskType);
  if (!r) return null;
  const confidence = Math.min(1, r.n / CONFIDENCE_N);
  const penalty = 0.15 / Math.sqrt(Math.max(1, r.n));
  const calibratedExpertise = clamp(r.ewmaQuality - penalty, 0, 0.99);
  return {
    modelId,
    taskType,
    calibratedExpertise,
    confidence,
  };
}

/**
 * Get computed calibration for a model+taskType.
 */
export async function getComputedForModel(
  modelId: string,
  taskType: string
): Promise<ComputedCalibration | null> {
  const store = await loadStore();
  return getComputed(modelId, taskType, store.records);
}

/**
 * Get all computed calibrations.
 */
export async function getAllComputed(): Promise<ComputedCalibration[]> {
  const store = await loadStore();
  return store.records.map((r) => {
    const c = getComputed(r.modelId, r.taskType, store.records);
    return c!;
  });
}

/**
 * Get all raw records (for debug endpoint).
 */
export async function getAllRecords(): Promise<CalibrationRecord[]> {
  const store = await loadStore();
  return store.records;
}
