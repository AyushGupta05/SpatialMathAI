export const appState = {
  shape: "cube",
  dimension: 1,
  volume: 1,
  surfaceArea: 6,
  interaction: {
    handsDetected: false,
    resize: 0,
    rotation: 0,
    pinch: false,
    jitter: 0,
  },
  calibration: {
    scaleK: 1,
    smoothingAlpha: 0.38,
    baselineDistance: 0.1,
  },
};
