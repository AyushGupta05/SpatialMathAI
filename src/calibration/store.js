const KEY = "nova.calibration.v1";

const defaultCal = {
  scaleK: 1,
  smoothingAlpha: 0.38,
  baselineDistance: 0.1,
};

export function loadCalibration() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaultCal };
    return { ...defaultCal, ...JSON.parse(raw) };
  } catch {
    return { ...defaultCal };
  }
}

export function saveCalibration(cal) {
  localStorage.setItem(KEY, JSON.stringify(cal));
}

export function deriveScaleK(currentDistance, targetDistance = 0.12) {
  if (!currentDistance || currentDistance <= 0) return 1;
  return targetDistance / currentDistance;
}
