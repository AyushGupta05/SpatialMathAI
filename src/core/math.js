export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

export const lerp = (a, b, t) => a + (b - a) * t;

export const ema = (prev, next, alpha = 0.35) => {
  if (prev == null || Number.isNaN(prev)) return next;
  return prev + alpha * (next - prev);
};

export const dist3 = (a, b) => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

export const angle2 = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
