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
    this.aiEngineLoops = new Map();
    this.countdownTimers = [];
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
    } else {
      this.#applyVolumes();
    }
  }

  startRaceAudio() {
    this.#ensureContext();
    this.paused = false;

    if (!this.engineLoopGain || this.engineVoices.length === 0) {
      this.#createEngineLoop();
    }

    this.#applyVolumes();
  }

  silenceRaceAudio() {
    if (!this.initialized) {
      return;
    }

    this.paused = true;
    this.#clearCountdownTimers();
    this.#silenceLiveLoops();
    this.#stopEngineLoop();
    this.#stopAiEngineLoops();
  }

  playMenuMove() {
    this.#playTone({ frequency: 420, duration: 0.055, gain: 0.18, destination: this.menuGain });
  }

  playMenuConfirm() {
    this.#playTone({ frequency: 680, duration: 0.09, gain: 0.22, destination: this.menuGain });
  }

  playCountdown() {
    this.#clearCountdownTimers();

    [0, 650, 1300].forEach((delay) => {
      const timer = window.setTimeout(() => {
        this.#playTone({ frequency: 520, duration: 0.16, gain: 0.28, destination: this.sfxGain });
      }, delay);
      this.countdownTimers.push(timer);
    });
    const finalTimer = window.setTimeout(() => {
      this.#playTone({ frequency: 880, duration: 0.35, gain: 0.34, destination: this.sfxGain });
    }, 1950);
    this.countdownTimers.push(finalTimer);
  }

  playCollision(position, intensity = 1) {
    if (this.paused) {
      return;
    }

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

    if (this.paused) {
      this.#silenceLiveLoops();
      return;
    }

    this.#updateEngine(player, controls);
    this.#updateEnginePosition(player.group.position);
    this.#updateAiEngines(aiRacers);
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

    this.engineGain.connect(this.masterGain);
    this.enginePanner.connect(this.engineGain);
    this.sfxGain.connect(this.masterGain);
    this.menuGain.connect(this.masterGain);
    this.masterGain.connect(this.context.destination);

    this.#createEngineLoop();
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

    loopGain.connect(filter).connect(this.enginePanner);
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
    rumbleOscillator.connect(rumbleGain).connect(rumbleFilter).connect(this.enginePanner);
    rumbleOscillator.start();

    this.engineLoopGain = loopGain;
    this.engineFilter = filter;
    this.engineRumble = {
      oscillator: rumbleOscillator,
      gain: rumbleGain,
    };
  }

  #updateEngine(player, controls) {
    const now = this.context.currentTime;

    if (this.paused) {
      this.#silenceLiveLoops();
      return;
    }

    if (!this.engineLoopGain || this.engineVoices.length === 0) {
      this.#createEngineLoop();
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

  #updateAiEngines(aiRacers) {
    const now = this.context.currentTime;
    const activeCars = new Set();

    for (const racer of aiRacers) {
      const car = racer?.car;
      if (!car) continue;

      activeCars.add(car);
      const loop = this.#getAiEngineLoop(car);
      this.#updateAiEngineLoop(loop, car, racer.controller?.currentControls, now);
    }

    for (const [car, loop] of this.aiEngineLoops) {
      if (!activeCars.has(car)) {
        this.#stopAiEngineLoop(loop);
        this.aiEngineLoops.delete(car);
      }
    }
  }

  #getAiEngineLoop(car) {
    if (this.aiEngineLoops.has(car)) {
      return this.aiEngineLoops.get(car);
    }

    const oscillator = this.context.createOscillator();
    const undertone = this.context.createOscillator();
    const loopGain = this.context.createGain();
    const undertoneGain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    const panner = this.#createPanner(car.group.position);
    const detune = ((this.aiEngineLoops.size % 5) - 2) * 7;

    oscillator.type = "sawtooth";
    undertone.type = "triangle";
    oscillator.detune.value = detune;
    undertone.detune.value = detune * 0.6;
    oscillator.frequency.value = 90;
    undertone.frequency.value = 45;
    loopGain.gain.value = 0.0001;
    undertoneGain.gain.value = 0.2;
    filter.type = "lowpass";
    filter.frequency.value = 860;
    filter.Q.value = 0.5;

    oscillator.connect(loopGain);
    undertone.connect(undertoneGain).connect(loopGain);
    loopGain.connect(filter).connect(panner).connect(this.engineGain);
    oscillator.start();
    undertone.start();

    const loop = { oscillator, undertone, loopGain, undertoneGain, filter, panner };
    this.aiEngineLoops.set(car, loop);
    return loop;
  }

  #updateAiEngineLoop(loop, car, controls, now) {
    const profile = car.engineProfile ?? {};
    const speedRatio = Math.min(Math.abs(car.speed) / car.maxForwardSpeed, 1);
    const load = controls?.throttle ? 0.92 : controls?.brakeReverse ? 0.36 : 0.52;
    const gearCount = profile.gears ?? 5;
    const gearPhase = speedRatio >= 0.985 ? 0.92 : (speedRatio * gearCount) % 1;
    const revRatio = Math.min(1, 0.2 + gearPhase * 0.76 + load * 0.035);
    const idleHz = profile.idleHz ?? 62;
    const maxHz = profile.maxHz ?? 285;
    const roughness = profile.roughness ?? 5;
    const baseHz =
      idleHz +
      revRatio * maxHz +
      Math.sin(now * (15 + revRatio * 28)) * roughness * 0.45;
    const gain = (0.018 + load * 0.034 + speedRatio * 0.03) * (profile.gain ?? 1);

    loop.oscillator.frequency.setTargetAtTime(baseHz, now, 0.06);
    loop.undertone.frequency.setTargetAtTime(baseHz * 0.5, now, 0.08);
    loop.loopGain.gain.setTargetAtTime(gain, now, 0.1);
    loop.filter.frequency.setTargetAtTime(430 + revRatio * 1450 + load * 220, now, 0.12);
    this.#setAudioPosition(loop.panner, car.group.position);
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

    if (destination === this.sfxGain && this.paused) {
      return;
    }

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
    this.engineGain?.gain.cancelScheduledValues(now);
    this.engineGain?.gain.setValueAtTime(0, now);
    this.engineLoopGain?.gain.cancelScheduledValues(now);
    this.engineLoopGain?.gain.setValueAtTime(0, now);
    this.engineRumble?.gain.gain.cancelScheduledValues(now);
    this.engineRumble?.gain.gain.setValueAtTime(0, now);
    for (const loop of this.aiEngineLoops.values()) {
      loop.loopGain.gain.cancelScheduledValues(now);
      loop.loopGain.gain.setValueAtTime(0, now);
    }
    this.sfxGain?.gain.cancelScheduledValues(now);
    this.sfxGain?.gain.setValueAtTime(0, now);
  }

  #stopEngineLoop() {
    for (const voice of this.engineVoices) {
      try {
        voice.oscillator.stop();
      } catch {
        // Oscillators may already be stopped if race cleanup runs twice.
      }
      voice.oscillator.disconnect();
      voice.gainNode.disconnect();
    }

    if (this.engineRumble) {
      try {
        this.engineRumble.oscillator.stop();
      } catch {
        // Same double-cleanup guard as above.
      }
      this.engineRumble.oscillator.disconnect();
      this.engineRumble.gain.disconnect();
    }

    this.engineLoopGain?.disconnect();
    this.engineFilter?.disconnect();
    this.engineVoices = [];
    this.engineLoopGain = null;
    this.engineFilter = null;
    this.engineRumble = null;
  }

  #stopAiEngineLoops() {
    for (const loop of this.aiEngineLoops.values()) {
      this.#stopAiEngineLoop(loop);
    }

    this.aiEngineLoops.clear();
  }

  #stopAiEngineLoop(loop) {
    for (const oscillator of [loop.oscillator, loop.undertone]) {
      try {
        oscillator.stop();
      } catch {
        // Race audio cleanup can run repeatedly when menus and results overlap.
      }
      oscillator.disconnect();
    }

    loop.loopGain.disconnect();
    loop.undertoneGain.disconnect();
    loop.filter.disconnect();
    loop.panner.disconnect();
  }

  #clearCountdownTimers() {
    for (const timer of this.countdownTimers) {
      window.clearTimeout(timer);
    }

    this.countdownTimers = [];
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
