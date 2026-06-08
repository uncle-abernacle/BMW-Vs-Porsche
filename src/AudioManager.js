export class AudioManager {
  constructor() {
    this.context = null;
    this.masterGain = null;
    this.engineGain = null;
    this.sfxGain = null;
    this.menuGain = null;
    this.engineVoices = [];
    this.engineLoopGain = null;
    this.engineFilter = null;
    this.engineRumble = null;
    this.enginePanner = null;
    this.squealOscillator = null;
    this.squealGain = null;
    this.initialized = false;
    this.muted = false;
    this.paused = false;
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

  setPaused(paused) {
    this.paused = paused;

    if (!this.initialized) {
      return;
    }

    if (paused) {
      this.#silenceLiveLoops();
    }
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
    this.#updateEngine(player, controls);
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
    const loopGain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    const rumbleFilter = this.context.createBiquadFilter();

    loopGain.gain.value = 0.0001;
    filter.type = "lowpass";
    filter.frequency.value = 920;
    filter.Q.value = 0.55;
    rumbleFilter.type = "lowpass";
    rumbleFilter.frequency.value = 130;
    rumbleFilter.Q.value = 0.8;

    loopGain.connect(filter).connect(this.engineGain);
    this.engineVoices = [
      { harmonic: 1, detune: -5, type: "sawtooth", gain: 0.42 },
      { harmonic: 0.5, detune: 0, type: "triangle", gain: 0.22 },
      { harmonic: 2, detune: 7, type: "sawtooth", gain: 0.16 },
      { harmonic: 3, detune: -11, type: "square", gain: 0.055 },
    ].map((voice) => {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();

      oscillator.type = voice.type;
      oscillator.frequency.value = 70 * voice.harmonic;
      oscillator.detune.value = voice.detune;
      gain.gain.value = voice.gain;
      oscillator.connect(gain).connect(loopGain);
      oscillator.start();
      return { ...voice, oscillator, gainNode: gain };
    });

    const rumbleOscillator = this.context.createOscillator();
    const rumbleGain = this.context.createGain();
    rumbleOscillator.type = "triangle";
    rumbleOscillator.frequency.value = 42;
    rumbleGain.gain.value = 0.0001;
    rumbleOscillator.connect(rumbleGain).connect(rumbleFilter).connect(this.engineGain);
    rumbleOscillator.start();

    this.engineLoopGain = loopGain;
    this.engineFilter = filter;
    this.engineRumble = {
      oscillator: rumbleOscillator,
      gain: rumbleGain,
    };
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

  #updateEngine(player, controls) {
    const now = this.context.currentTime;

    if (this.paused) {
      this.#silenceLiveLoops();
      return;
    }

    const profile = player.engineProfile ?? {};
    const speedRatio = Math.min(Math.abs(player.speed) / player.maxForwardSpeed, 1);
    const load = controls?.throttle ? 1 : controls?.brakeReverse ? 0.45 : 0.26;
    const gearCount = profile.gears ?? 5;
    const gearPhase = speedRatio >= 0.985 ? 0.94 : (speedRatio * gearCount) % 1;
    const revRatio = Math.min(1, 0.22 + gearPhase * 0.78 + load * 0.04);
    const idleHz = profile.idleHz ?? 62;
    const maxHz = profile.maxHz ?? 285;
    const roughness = profile.roughness ?? 5;
    const engineBaseHz =
      idleHz +
      revRatio * maxHz +
      Math.sin(now * (18 + revRatio * 34)) * roughness +
      Math.sin(now * 7.3) * roughness * 0.42;
    const gain = (0.065 + load * 0.11 + speedRatio * 0.055) * (profile.gain ?? 1);
    const filterFrequency = 520 + revRatio * 1900 + load * 340;
    const rumbleFrequency = 34 + speedRatio * 46 + load * 10;
    const rumbleGain = (0.015 + load * 0.038) * (profile.gain ?? 1);

    for (const voice of this.engineVoices) {
      voice.oscillator.frequency.setTargetAtTime(engineBaseHz * voice.harmonic, now, 0.035);
      voice.gainNode.gain.setTargetAtTime(voice.gain * (0.72 + load * 0.32), now, 0.06);
    }

    this.engineLoopGain.gain.setTargetAtTime(gain, now, 0.05);
    this.engineFilter.frequency.setTargetAtTime(filterFrequency, now, 0.08);
    this.engineRumble.oscillator.frequency.setTargetAtTime(rumbleFrequency, now, 0.08);
    this.engineRumble.gain.gain.setTargetAtTime(rumbleGain, now, 0.08);
  }

  #updateTireSqueal(player) {
    const now = this.context.currentTime;

    if (this.paused) {
      this.squealGain.gain.setTargetAtTime(0.0001, now, 0.025);
      return;
    }

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

  #silenceLiveLoops() {
    const now = this.context.currentTime;
    this.engineLoopGain?.gain.setTargetAtTime(0.0001, now, 0.025);
    this.engineRumble?.gain.gain.setTargetAtTime(0.0001, now, 0.025);
    this.squealGain?.gain.setTargetAtTime(0.0001, now, 0.025);
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
