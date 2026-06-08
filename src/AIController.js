import * as THREE from "three";

const DIFFICULTY_SETTINGS = {
  Easy: {
    targetSpeed: 32,
    lookAhead: 0.026,
    reaction: 0.78,
    aggression: 0.45,
    recoverySeconds: 3.2,
  },
  Medium: {
    targetSpeed: 42,
    lookAhead: 0.034,
    reaction: 0.92,
    aggression: 0.68,
    recoverySeconds: 2.5,
  },
  Hard: {
    targetSpeed: 52,
    lookAhead: 0.044,
    reaction: 1.08,
    aggression: 0.86,
    recoverySeconds: 1.9,
  },
};

// AIController converts track knowledge and nearby vehicle positions into the
// same control shape used by the player car. This keeps opponent behavior
// reusable and lets all cars share the same arcade handling model.
export class AIController {
  constructor(car, track, { difficulty = "Medium", laneOffset = 0, startProgress = 0 } = {}) {
    this.car = car;
    this.track = track;
    this.difficulty = difficulty;
    this.settings = DIFFICULTY_SETTINGS[difficulty] ?? DIFFICULTY_SETTINGS.Medium;
    this.baseLaneOffset = laneOffset;
    this.overtakeOffset = 0;
    this.startProgress = startProgress;
    this.stuckTimer = 0;
    this.previousPosition = new THREE.Vector3();
    this.currentControls = this.#createEmptyControls();
  }

  reset(progress = this.startProgress, laneOffset = this.baseLaneOffset) {
    this.baseLaneOffset = laneOffset;
    this.overtakeOffset = 0;
    this.stuckTimer = 0;

    const position = this.#getOffsetTrackPoint(progress, laneOffset);
    const heading = this.#getHeadingAt(progress);

    this.car.reset(position, heading);
    this.previousPosition.copy(position);
  }

  update(deltaTime, nearbyCars = []) {
    const progress = this.track.getProgressAtPosition(this.car.group.position);
    const avoidance = this.#calculateAvoidance(nearbyCars);
    const speedRatio = THREE.MathUtils.clamp(Math.abs(this.car.speed) / this.car.maxForwardSpeed, 0, 1);
    const lookAhead = this.settings.lookAhead + speedRatio * 0.026;

    this.overtakeOffset = THREE.MathUtils.damp(
      this.overtakeOffset,
      avoidance.laneShift,
      this.settings.reaction * 2.8,
      deltaTime,
    );

    const target = this.#getOffsetTrackPoint(
      progress + lookAhead,
      this.baseLaneOffset + this.overtakeOffset,
    );
    const steeringError = this.#getSteeringError(target);
    const desiredSpeed = this.settings.targetSpeed * avoidance.speedMultiplier;
    const shouldBrake = this.car.speed > desiredSpeed || Math.abs(steeringError) > 0.72;

    this.currentControls = {
      throttle: this.car.speed < desiredSpeed && Math.abs(steeringError) < 1.15,
      brakeReverse: shouldBrake,
      handbrake: Math.abs(steeringError) > 0.95 && this.car.speed > 18,
      steerLeft: steeringError > 0.08,
      steerRight: steeringError < -0.08,
      resetPressed: false,
    };

    this.car.update(deltaTime, this.currentControls, this.track);
    this.#recoverIfStuck(deltaTime, progress);

    return this.currentControls;
  }

  getProgressScore(lapState) {
    return (lapState.currentLap - 1) + this.track.getProgressAtPosition(this.car.group.position);
  }

  #calculateAvoidance(nearbyCars) {
    let laneShift = 0;
    let speedMultiplier = 1;
    const forward = this.#getForwardVector();
    const right = this.#getRightVector();

    for (const otherCar of nearbyCars) {
      if (!otherCar || otherCar === this.car) continue;

      const offset = otherCar.group.position.clone().sub(this.car.group.position);
      const forwardDistance = offset.dot(forward);
      const sideDistance = offset.dot(right);
      const isAhead = forwardDistance > 0 && forwardDistance < 20;
      const isTooCloseSide = Math.abs(sideDistance) < 7.5;

      if (!isAhead || !isTooCloseSide) {
        continue;
      }

      const passDirection = sideDistance >= 0 ? -1 : 1;
      laneShift += passDirection * THREE.MathUtils.lerp(4, 8, this.settings.aggression);
      speedMultiplier = Math.min(speedMultiplier, forwardDistance < 9 ? 0.72 : 0.9);
    }

    return {
      laneShift: THREE.MathUtils.clamp(laneShift, -9, 9),
      speedMultiplier,
    };
  }

  #recoverIfStuck(deltaTime, progress) {
    const movement = this.car.group.position.distanceTo(this.previousPosition);
    const tryingToMove = this.currentControls.throttle || this.currentControls.brakeReverse;

    if (tryingToMove && movement < 0.12) {
      this.stuckTimer += deltaTime;
    } else {
      this.stuckTimer = Math.max(0, this.stuckTimer - deltaTime * 1.5);
    }

    if (this.stuckTimer > this.settings.recoverySeconds) {
      this.reset(progress + 0.02, this.baseLaneOffset);
    }

    this.previousPosition.copy(this.car.group.position);
  }

  #getSteeringError(target) {
    const direction = target.clone().sub(this.car.group.position);
    const desiredRotation = Math.atan2(-direction.x, -direction.z);
    return Math.atan2(
      Math.sin(desiredRotation - this.car.group.rotation.y),
      Math.cos(desiredRotation - this.car.group.rotation.y),
    );
  }

  #getOffsetTrackPoint(progress, laneOffset) {
    const point = this.track.getPointOnCenterLine(progress);
    const next = this.track.getPointOnCenterLine(progress + 0.004);
    const tangent = next.sub(point).normalize();
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x);

    point.addScaledVector(side, laneOffset);
    point.y = this.track.getRoadHeightAtPosition(point);
    return point;
  }

  #getHeadingAt(progress) {
    const point = this.track.getPointOnCenterLine(progress);
    const next = this.track.getPointOnCenterLine(progress + 0.004);
    return Math.atan2(point.x - next.x, point.z - next.z);
  }

  #getForwardVector() {
    return new THREE.Vector3(
      -Math.sin(this.car.group.rotation.y),
      0,
      -Math.cos(this.car.group.rotation.y),
    );
  }

  #getRightVector() {
    return new THREE.Vector3(
      Math.cos(this.car.group.rotation.y),
      0,
      -Math.sin(this.car.group.rotation.y),
    );
  }

  #createEmptyControls() {
    return {
      throttle: false,
      brakeReverse: false,
      handbrake: false,
      steerLeft: false,
      steerRight: false,
      resetPressed: false,
    };
  }
}

export { DIFFICULTY_SETTINGS };
