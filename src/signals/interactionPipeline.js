import { clamp, ema, dist3, angle2 } from "../core/math.js";

export class InteractionPipeline {
  constructor(options = {}) {
    this.alpha = options.alpha ?? 0.38;
    this.pinchOnMin = options.pinchOnMin ?? 0.038;
    this.pinchOnMax = options.pinchOnMax ?? 0.058;
    this.pinchOffMin = options.pinchOffMin ?? 0.058;
    this.pinchOffMax = options.pinchOffMax ?? 0.095;
    this.pinchOnRatio = options.pinchOnRatio ?? 0.34;
    this.pinchOffRatio = options.pinchOffRatio ?? 0.52;
    this.prevResize = 0;
    this.prevRotation = 0;
    this.prevJitter = 0;
    this.prevIndex = null;
    this.pinch = false;
    this.pinchOnFrames = options.pinchOnFrames ?? 1;
    this.pinchOffFrames = options.pinchOffFrames ?? 2;
    this._pinchOnCounter = 0;
    this._pinchOffCounter = 0;
    this.pinchDist = 0;
    this._pinchRatioEma = null;
    this._pinchRatioPrev = null;
    this.pinchVelocityOn = options.pinchVelocityOn ?? -0.0034;
    this.pinchVelocityOff = options.pinchVelocityOff ?? 0.0015;
  }

  setAlpha(alpha) {
    this.alpha = clamp(alpha, 0.08, 0.9);
  }

  setProfile(profile) {
    if (profile === "stable") {
      this.pinchOnMin = 0.04;
      this.pinchOnMax = 0.056;
      this.pinchOffMin = 0.062;
      this.pinchOffMax = 0.092;
      this.pinchOnRatio = 0.35;
      this.pinchOffRatio = 0.56;
      this.pinchOnFrames = 3;
      this.pinchOffFrames = 3;
      this.pinchVelocityOn = -0.0028;
      this.pinchVelocityOff = 0.0012;
      this.setAlpha(0.52);
      return;
    }

    if (profile === "responsive") {
      this.pinchOnMin = 0.037;
      this.pinchOnMax = 0.058;
      this.pinchOffMin = 0.055;
      this.pinchOffMax = 0.1;
      this.pinchOnRatio = 0.36;
      this.pinchOffRatio = 0.58;
      this.pinchOnFrames = 2;
      this.pinchOffFrames = 1;
      this.pinchVelocityOn = -0.0042;
      this.pinchVelocityOff = 0.002;
      this.setAlpha(0.24);
      return;
    }

    // balanced (slightly looser pinch threshold for webcam variability)
    this.pinchOnMin = 0.038;
    this.pinchOnMax = 0.058;
    this.pinchOffMin = 0.058;
    this.pinchOffMax = 0.095;
    this.pinchOnRatio = 0.34;
    this.pinchOffRatio = 0.54;
    this.pinchOnFrames = 2;
    this.pinchOffFrames = 2;
    this.pinchVelocityOn = -0.0034;
    this.pinchVelocityOff = 0.0015;
  }

  update(hand, secondHand = null) {
    if (!hand) {
      this.pinch = false;
      this._pinchOnCounter = 0;
      this._pinchOffCounter = 0;
      this._pinchRatioEma = null;
      this._pinchRatioPrev = null;
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
    const wristToIndex = dist3(wrist, index);
    const pinchRatioRaw = pinchDist / Math.max(0.0001, wristToIndex);
    const pinchRatioEma = ema(this._pinchRatioEma ?? pinchRatioRaw, pinchRatioRaw, 0.45);
    const pinchVelocity = pinchRatioEma - (this._pinchRatioPrev ?? pinchRatioEma);
    this._pinchRatioPrev = pinchRatioEma;
    this._pinchRatioEma = pinchRatioEma;

    let pinchOnThreshold = clamp(this.pinchOnRatio * wristToIndex, this.pinchOnMin, this.pinchOnMax);
    let pinchOffThreshold = clamp(this.pinchOffRatio * wristToIndex, this.pinchOffMin, this.pinchOffMax);
    if (pinchOffThreshold <= pinchOnThreshold + 0.004) {
      pinchOffThreshold = pinchOnThreshold + 0.004;
    }

    const canStartPinch = (pinchDist <= pinchOnThreshold || pinchRatioEma <= this.pinchOnRatio) && pinchVelocity <= this.pinchVelocityOn;
    const canEndPinch = (pinchDist >= pinchOffThreshold && pinchRatioEma >= this.pinchOffRatio) && pinchVelocity >= this.pinchVelocityOff;

    this.pinchDist = pinchDist;
    if (!this.pinch && canStartPinch) {
      this._pinchOnCounter += 1;
      this._pinchOffCounter = 0;
      if (this._pinchOnCounter >= this.pinchOnFrames) {
        this.pinch = true;
        this._pinchOnCounter = 0;
      }
    } else if (this.pinch && canEndPinch) {
      this._pinchOffCounter += 1;
      this._pinchOnCounter = 0;
      if (this._pinchOffCounter >= this.pinchOffFrames) {
        this.pinch = false;
        this._pinchOffCounter = 0;
      }
    } else {
      this._pinchOnCounter = 0;
      this._pinchOffCounter = 0;
    }

    const span = dist3(index, middle);
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
      pinchDist,
      pinchRatio: pinchRatioEma,
      pinchVelocity,
      pinchStrength: clamp((pinchOffThreshold - pinchDist) / Math.max(0.0001, (pinchOffThreshold - pinchOnThreshold)), 0, 1),
      jitter,
      wristToIndex,
      pinchOnThreshold,
      pinchOffThreshold,
      twoHandBoost,
    };
  }
}
