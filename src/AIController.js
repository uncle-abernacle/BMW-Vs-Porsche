import * as THREE from "three";

const DIFFICULTY_SETTINGS = {
  Easy: {
    targetSpeed: 32,
    lookAhead: 0.034,
    reaction: 0.78,
    aggression: 0.45,
    recoverySeconds: 3.2,
  },
  Medium: {
    targetSpeed: 42,
    lookAhead: 0.044,
    reaction: 0.92,
    aggression: 0.68,
    recoverySeconds: 2.5,
  },
  Hard: {
    targetSpeed: 52,
    lookAhead: 0.052,
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
    this.car.trackProgress = THREE.MathUtils.euclideanModulo(progress, 1);
    this.previousPosition.copy(position);
  }

  update(deltaTime, nearbyCars = []) {
    const progress = this.track.getProgressAtPosition(this.car.group.position, this.car.trackProgress);
    const traffic = this.#calculateTraffic(nearbyCars);
    const speedRatio = THREE.MathUtils.clamp(Math.abs(this.car.speed) / this.car.maxForwardSpeed, 0, 1);
    const lookAhead = this.settings.lookAhead + speedRatio * 0.026;
    const laneLimit = this.#getUsableLaneLimit();
    const safeLaneLimit = laneLimit * 0.72;
    const laneInfo = this.#getLaneInfo(this.car.group.position, progress);
    const edgeRatio = Math.abs(laneInfo.offset) / Math.max(laneLimit, 0.001);

    this.overtakeOffset = THREE.MathUtils.damp(
      this.overtakeOffset,
      traffic.laneShift,
      this.settings.reaction * 2.2,
      deltaTime,
    );

    let targetLaneOffset = THREE.MathUtils.clamp(
      this.baseLaneOffset + this.overtakeOffset,
      -safeLaneLimit,
      safeLaneLimit,
    );

    if (edgeRatio > 0.48) {
      const recoveryStrength = THREE.MathUtils.clamp((edgeRatio - 0.48) / 0.34, 0, 1);
      targetLaneOffset = THREE.MathUtils.lerp(targetLaneOffset, 0, recoveryStrength);
    }

    const target = this.#getOffsetTrackPoint(progress + lookAhead, targetLaneOffset);
    const steeringError = this.#getSteeringError(target);
    const edgeSpeedMultiplier = edgeRatio > 0.6 ? THREE.MathUtils.lerp(1, 0.48, Math.min((edgeRatio - 0.6) / 0.3, 1)) : 1;
    const steeringSpeedMultiplier = Math.abs(steeringError) > 0.5 ? THREE.MathUtils.lerp(1, 0.68, Math.min(Math.abs(steeringError), 1)) : 1;
    const desiredSpeed = this.settings.targetSpeed * traffic.speedMultiplier * edgeSpeedMultiplier * steeringSpeedMultiplier;
    const shouldBrake = this.car.speed > desiredSpeed || Math.abs(steeringError) > 0.68 || edgeRatio > 0.84;
    const canBrakeWithoutReversing = this.car.speed > 5.5;

    this.currentControls = {
      throttle:
        !traffic.blocked &&
        this.car.speed < desiredSpeed &&
        Math.abs(steeringError) < 1.18,
      brakeReverse: shouldBrake && canBrakeWithoutReversing,
      handbrake: false,
      steerLeft: steeringError > 0.08,
      steerRight: steeringError < -0.08,
      resetPressed: false,
    };

    this.car.update(deltaTime, this.currentControls, this.track);
    this.#recoverIfStuck(deltaTime, progress);

    return this.currentControls;
  }

  getProgressScore(lapState) {
    return (lapState.currentLap - 1) + this.track.getProgressAtPosition(this.car.group.position, this.car.trackProgress);
  }

  #calculateTraffic(nearbyCars) {
    let laneShift = 0;
    let speedMultiplier = 1;
    let blocked = false;
    const forward = this.#getForwardVector();
    const right = this.#getRightVector();

    for (const otherCar of nearbyCars) {
      if (!otherCar || otherCar === this.car) continue;

      const offset = otherCar.group.position.clone().sub(this.car.group.position);
      const forwardDistance = offset.dot(forward);
      const sideDistance = offset.dot(right);
      const isAhead = forwardDistance > 0 && forwardDistance < 18;
      const isTooCloseSide = Math.abs(sideDistance) < 5.8;

      if (!isAhead || !isTooCloseSide) {
        continue;
      }

      const passDirection = sideDistance >= 0 ? -1 : 1;
      laneShift += passDirection * THREE.MathUtils.lerp(0.12, 0.5, this.settings.aggression);
      speedMultiplier = Math.min(speedMultiplier, THREE.MathUtils.clamp(forwardDistance / 15, 0.62, 0.96));
      blocked = blocked || forwardDistance < 5.5;
    }

    return {
      laneShift: THREE.MathUtils.clamp(laneShift, -0.75, 0.75),
      speedMultiplier,
      blocked,
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
      const recoveryProgress = progress + 0.014;
      const target = this.#getOffsetTrackPoint(recoveryProgress, this.baseLaneOffset);
      const heading = this.#getHeadingAt(recoveryProgress);

      this.car.group.position.lerp(target, 0.16);
      this.car.group.rotation.y = THREE.MathUtils.damp(this.car.group.rotation.y, heading, 8, deltaTime);
      this.car.velocity.multiplyScalar(0.32);
      this.car.trackProgress = THREE.MathUtils.euclideanModulo(recoveryProgress, 1);
      this.stuckTimer = this.settings.recoverySeconds * 0.45;
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

    point.addScaledVector(side, this.#clampLaneOffset(laneOffset));
    point.y = this.track.getRoadHeightAtPosition(point, progress);
    return point;
  }

  #getLaneInfo(position, progress) {
    const center = this.track.getPointOnCenterLine(progress);
    const next = this.track.getPointOnCenterLine(progress + 0.004);
    const tangent = next.sub(center).normalize();
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x);
    const offset = new THREE.Vector3(position.x - center.x, 0, position.z - center.z).dot(side);

    return {
      offset,
      center,
      side,
    };
  }

  #getUsableLaneLimit() {
    const halfRoad = this.track.roadWidth * 0.5;
    const carHalfWidth = this.car.design.width * 0.58;
    return Math.max(1.5, halfRoad - carHalfWidth - 1.65);
  }

  #clampLaneOffset(laneOffset) {
    const laneLimit = this.#getUsableLaneLimit();
    return THREE.MathUtils.clamp(laneOffset, -laneLimit, laneLimit);
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
