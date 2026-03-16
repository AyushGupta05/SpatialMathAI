import test from "node:test";
import assert from "node:assert/strict";

import { PcmAudioPlayer } from "../src/ui/pcmAudioPlayer.js";

class FakeAudioContext {
  constructor({ sampleRate } = {}) {
    this.sampleRate = sampleRate || 24000;
    this.currentTime = 0;
    this.state = "running";
    this.destination = {};
  }

  createBuffer(_channelCount, frameCount, sampleRate) {
    return {
      duration: frameCount / sampleRate,
      getChannelData() {
        return new Float32Array(frameCount);
      },
    };
  }

  createBufferSource() {
    const source = {
      buffer: null,
      onended: null,
      connect() {},
      start() {},
      stop() {
        source.onended?.();
      },
    };
    return source;
  }

  async resume() {
    this.state = "running";
  }

  async close() {
    this.state = "closed";
  }
}

function withFakeWebAudio(run) {
  const originalAudioContext = globalThis.AudioContext;
  const originalAtob = globalThis.atob;
  globalThis.AudioContext = FakeAudioContext;
  globalThis.atob = (value) => Buffer.from(String(value || ""), "base64").toString("binary");

  return Promise.resolve()
    .then(run)
    .finally(() => {
      globalThis.AudioContext = originalAudioContext;
      globalThis.atob = originalAtob;
    });
}

test("PcmAudioPlayer.whenIdle waits until the queued source finishes", async () => {
  await withFakeWebAudio(async () => {
    const player = new PcmAudioPlayer({ sampleRate: 24000 });
    await player.appendBase64Chunk(Buffer.from([0, 0, 1, 0]).toString("base64"));

    let settled = false;
    const idlePromise = player.whenIdle().then(() => {
      settled = true;
    });

    await Promise.resolve();
    assert.equal(settled, false);

    const [source] = [...player.sources];
    source.onended?.();

    await idlePromise;
    assert.equal(settled, true);
  });
});

test("PcmAudioPlayer.whenIdle resolves after stop clears the queued audio", async () => {
  await withFakeWebAudio(async () => {
    const player = new PcmAudioPlayer({ sampleRate: 24000 });
    await player.appendBase64Chunk(Buffer.from([0, 0, 1, 0]).toString("base64"));

    const idlePromise = player.whenIdle();
    player.stop();

    await idlePromise;
    assert.equal(player.isPlaying(), false);
  });
});
