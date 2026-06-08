export class AudioManager {
  constructor() {
    this.context = null;
    this.masterGain = null;
    this.engineGain = null;
    this.sfxGain = null;
    this.menuGain = null;
    this.engineOscillator = null;
    this.enginePanner = null;
    this.squealOscillator = null;
    this.squealGain = null;
    this.initialized = false;
    this.muted = false;
    this.lastCollisionTime = 0;
    this.volumes = {
      master: 0.85,
      engine: 0.75,
      sfx: 0.75,
      menu: 0.65,
    };
  }

  async resume() {
    this.#ensureContext();

    if (this.context.state !== "running") {
      await this.context.resume();
    }
  }

  setVolume(channel, value) {
    this.volumes[channel] = Number(value);
    this.#applyVolumes();
  }

  setMuted(muted) {
    this.muted = muted;
    this.#applyVolumes();
  }

  playMenuMove() {
    this.#playTone({ frequency: 420, duration: 0.055, gain: 0.18, destination: this.menuGain });
  }

  playMenuConfirm() {
    this.#playTone({ frequency: 680, duration: 0.09, gain: 0.22, destination: this.menuGain });
  }

  playCountdown() {
    [0, 650, 1300].forEach((delay) => {
      window.setTimeout(() => {
        this.#playTone({ frequency: 520, duration: 0.16, gain: 0.28, destination: this.sfxGain });
      }, delay);
    });
    window.setTimeout(() => {
      this.#playTone({ frequency: 880, duration: 0.35, gain: 0.34, destination: this.sfxGain });
    }, 1950);
  }

  playCollision(position, intensity = 1) {
    this.#ensureContext();

    const now = this.context.currentTime;
    if (now - this.lastCollisionTime < 0.3) return;
    this.lastCollisionTime = now;

    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const panner = this.#createPanner(position);

    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(90, now);
    oscillator.frequency.exponentialRampToValueAtTime(36, now + 0.18);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.22 * intensity, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    oscillator.connect(gain).connect(panner).connect(this.sfxGain);
    oscillator.start(now);
    oscillator.stop(now + 0.24);
  }

  update({ player, camera, controls, aiRacers = [] }) {
    if (!this.initialized || !player) return;

    this.#updateListener(camera);
    this.#updateEngine(player);
    this.#updateTireSqueal(player, controls);
    this.#updateEnginePosition(player.group.position);
    this.#detectSoftCollisions(player, aiRacers);
  }

  #ensureContext() {
    if (this.initialized) return;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.context = new AudioContextClass();
    this.masterGain = this.context.createGain();
    this.engineGain = this.context.createGain();
    this.sfxGain = this.context.createGain();
    this.menuGain = this.context.createGain();
    this.enginePanner = this.#createPanner();

    this.engineGain.connect(this.enginePanner).connect(this.masterGain);
    this.sfxGain.connect(this.masterGain);
    this.menuGain.connect(this.masterGain);
    this.masterGain.connect(this.context.destination);

    this.#createEngineLoop();
    this.#createSquealLoop();
    this.#applyVolumes();
    this.initialized = true;
  }

  #createEngineLoop() {
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();

    oscillator.type = "sawtooth";
    oscillator.frequency.value = 70;
    gain.gain.value = 0.0001;
    oscillator.connect(gain).connect(this.engineGain);
    oscillator.start();

    this.engineOscillator = oscillator;
    this.engineLoopGain = gain;
  }

  #createSquealLoop() {
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();

    oscillator.type = "square";
    oscillator.frequency.value = 1220;
    gain.gain.value = 0.0001;
    oscillator.connect(gain).connect(this.sfxGain);
    oscillator.start();

    this.squealOscillator = oscillator;
    this.squealGain = gain;
  }

  #updateEngine(player) {
    const now = this.context.currentTime;
    const profile = player.engineProfile ?? {};
    const speedRatio = Math.min(Math.abs(player.speed) / player.maxForwardSpeed, 1);
    const throttleLift = 0.35 + speedRatio * 0.65;
    const idleHz = profile.idleHz ?? 62;
    const maxHz = profile.maxHz ?? 285;
    const roughness = profile.roughness ?? 5;
    const frequency = idleHz + speedRatio * maxHz + Math.sin(now * 34) * roughness;
    const gain = (0.08 + throttleLift * 0.16) * (profile.gain ?? 1);

    this.engineOscillator.frequency.setTargetAtTime(frequency, now, 0.035);
    this.engineLoopGain.gain.setTargetAtTime(gain, now, 0.05);
  }

  #updateTireSqueal(player) {
    const now = this.context.currentTime;
    const drift = Math.min(Math.abs(player.driftAmount), 1);
    const speedRatio = Math.min(Math.abs(player.speed) / 30, 1);
    const targetGain = drift > 0.38 ? drift * speedRatio * 0.11 : 0.0001;

    this.squealGain.gain.setTargetAtTime(Math.max(targetGain, 0.0001), now, 0.04);
    this.squealOscillator.frequency.setTargetAtTime(980 + drift * 620, now, 0.04);
  }

  #detectSoftCollisions(player, aiRacers) {
    for (const racer of aiRacers) {
      const distance = player.group.position.distanceTo(racer.car.group.position);
      if (distance < 5.2) {
        this.playCollision(player.group.position, 0.7);
        return;
      }
    }

    if (player.lastSurfaceCorrectionStrength > 0.55 && Math.abs(player.speed) > 12) {
      this.playCollision(player.group.position, 0.45);
    }
  }

  #playTone({ frequency, duration, gain, destination }) {
    this.#ensureContext();

    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();

    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(frequency, now);
    envelope.gain.setValueAtTime(0.001, now);
    envelope.gain.exponentialRampToValueAtTime(gain, now + 0.01);
    envelope.gain.exponentialRampToValueAtTime(0.001, now + duration);
    oscillator.connect(envelope).connect(destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  #createPanner(position = { x: 0, y: 0, z: 0 }) {
    const panner = this.context.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = "linear";
    panner.refDistance = 12;
    panner.maxDistance = 180;
    panner.rolloffFactor = 0.55;
    this.#setAudioPosition(panner, position);
    return panner;
  }

  #updateEnginePosition(position) {
    this.#setAudioPosition(this.enginePanner, position);
  }

  #updateListener(camera) {
    if (!camera || !this.context.listener) return;

    const listener = this.context.listener;
    const position = camera.position;

    if (listener.positionX) {
      listener.positionX.setTargetAtTime(position.x, this.context.currentTime, 0.05);
      listener.positionY.setTargetAtTime(position.y, this.context.currentTime, 0.05);
      listener.positionZ.setTargetAtTime(position.z, this.context.currentTime, 0.05);
      listener.forwardX.setValueAtTime(0, this.context.currentTime);
      listener.forwardY.setValueAtTime(0, this.context.currentTime);
      listener.forwardZ.setValueAtTime(-1, this.context.currentTime);
      listener.upX.setValueAtTime(0, this.context.currentTime);
      listener.upY.setValueAtTime(1, this.context.currentTime);
      listener.upZ.setValueAtTime(0, this.context.currentTime);
    }
  }

  #setAudioPosition(node, position) {
    if (node.positionX) {
      node.positionX.value = position.x ?? 0;
      node.positionY.value = position.y ?? 0;
      node.positionZ.value = position.z ?? 0;
    } else {
      node.setPosition(position.x ?? 0, position.y ?? 0, position.z ?? 0);
    }
  }

  #applyVolumes() {
    if (!this.initialized) return;

    const mutedMultiplier = this.muted ? 0 : 1;
    this.masterGain.gain.value = this.volumes.master * mutedMultiplier;
    this.engineGain.gain.value = this.volumes.engine;
    this.sfxGain.gain.value = this.volumes.sfx;
    this.menuGain.gain.value = this.volumes.menu;
  }
}
