import { clamp, ema, dist3, angle2 } from "../core/math.js";

export class InteractionPipeline {
  constructor(options = {}) {
    this.alpha = options.alpha ?? 0.38;
    this.pinchOn = options.pinchOn ?? 0.048;
    this.pinchOff = options.pinchOff ?? 0.062;
    this.prevResize = 0;
    this.prevRotation = 0;
    this.prevJitter = 0;
    this.prevIndex = null;
    this.pinch = false;
  }

  setAlpha(alpha) {
    this.alpha = clamp(alpha, 0.08, 0.9);
  }

  update(hand, secondHand = null) {
    if (!hand) {
      return {
        handsDetected: false,
        resize: this.prevResize,
        rotation: this.prevRotation,
        pinch: false,
        jitter: this.prevJitter,
      };
    }

    const thumb = hand[4];
    const index = hand[8];
    const wrist = hand[0];
    const middle = hand[12];

    const pinchDist = dist3(thumb, index);
    if (!this.pinch && pinchDist <= this.pinchOn) this.pinch = true;
    if (this.pinch && pinchDist >= this.pinchOff) this.pinch = false;

    const span = dist3(index, middle);
    const wristToIndex = dist3(wrist, index);

    const rawResize = clamp(span * 8.5, 0, 1);
    const rotation = angle2(wrist, index);

    const jitterRaw = this.prevIndex ? dist3(index, this.prevIndex) : 0;
    this.prevIndex = { ...index };

    const resize = ema(this.prevResize, rawResize, this.alpha);
    const rot = ema(this.prevRotation, rotation, this.alpha);
    const jitter = ema(this.prevJitter, jitterRaw, 0.25);

    this.prevResize = resize;
    this.prevRotation = rot;
    this.prevJitter = jitter;

    // optional two-hand influence
    const twoHandBoost = secondHand ? clamp(dist3(secondHand[8], index) * 0.7, 0, 1) : null;

    return {
      handsDetected: true,
      resize,
      rotation: rot,
      pinch: this.pinch,
      jitter,
      wristToIndex,
      twoHandBoost,
    };
  }
}
