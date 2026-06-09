import * as THREE from "three";

const DIFFICULTY_SETTINGS = {
  Easy: {
    targetSpeed: 32,
    lookAhead: 0.014,
    reaction: 0.78,
    aggression: 0.45,
    recoverySeconds: 3.2,
  },
  Medium: {
    targetSpeed: 42,
    lookAhead: 0.018,
    reaction: 0.92,
    aggression: 0.68,
    recoverySeconds: 2.5,
  },
  Hard: {
    targetSpeed: 52,
    lookAhead: 0.021,
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
    this.smoothedSteering = 0;
    this.previousPosition = new THREE.Vector3();
    this.currentControls = this.#createEmptyControls();
  }

  reset(progress = this.startProgress, laneOffset = this.baseLaneOffset) {
    this.baseLaneOffset = laneOffset;
    this.overtakeOffset = 0;
    this.stuckTimer = 0;
    this.smoothedSteering = 0;

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
    const roadTightness = THREE.MathUtils.clamp((18 - this.track.roadWidth) / 8, 0, 1);
    const lookAhead = this.settings.lookAhead + speedRatio * THREE.MathUtils.lerp(0.007, 0.004, roadTightness);
    const laneLimit = this.#getUsableLaneLimit();
    const safeLaneLimit = laneLimit * THREE.MathUtils.lerp(0.6, 0.42, roadTightness);
    const laneInfo = this.#getLaneInfo(this.car.group.position, progress);
    const edgeRatio = Math.abs(laneInfo.offset) / Math.max(laneLimit, 0.001);

    this.overtakeOffset = THREE.MathUtils.damp(
      this.overtakeOffset,
      traffic.laneShift,
      this.settings.reaction * 2.2,
      deltaTime,
    );

    let targetLaneOffset = THREE.MathUtils.clamp(this.overtakeOffset * 0.45, -safeLaneLimit, safeLaneLimit);

    if (edgeRatio > 0.36) {
      const recoveryStrength = THREE.MathUtils.clamp((edgeRatio - 0.36) / 0.34, 0, 1);
      targetLaneOffset = THREE.MathUtils.lerp(targetLaneOffset, 0, recoveryStrength);
    }

    if (edgeRatio > 0.62) {
      this.overtakeOffset = THREE.MathUtils.damp(this.overtakeOffset, 0, 7, deltaTime);
    }

    const target = this.#getOffsetTrackPoint(progress + lookAhead, targetLaneOffset);
    const steeringError = this.#getSteeringError(target);
    const edgeSpeedMultiplier = edgeRatio > 0.48 ? THREE.MathUtils.lerp(1, 0.36, Math.min((edgeRatio - 0.48) / 0.34, 1)) : 1;
    const steeringSpeedMultiplier = Math.abs(steeringError) > 0.42 ? THREE.MathUtils.lerp(1, 0.62, Math.min(Math.abs(steeringError), 1)) : 1;
    const recoverySpeed = edgeRatio > 0.68 ? 11 : 0;
    const desiredSpeed = Math.max(
      18,
      recoverySpeed,
      this.settings.targetSpeed * traffic.speedMultiplier * edgeSpeedMultiplier * steeringSpeedMultiplier,
    );
    const shouldBrake =
      (this.car.speed > desiredSpeed + 5 && this.car.speed > 12) ||
      (Math.abs(steeringError) > 1.05 && this.car.speed > 18);
    const canBrakeWithoutReversing = this.car.speed > 5.5;
    const rawSteering = THREE.MathUtils.clamp(steeringError * 1.05, -0.82, 0.82);
    this.smoothedSteering = THREE.MathUtils.damp(this.smoothedSteering, rawSteering, 3.15, deltaTime);

    this.currentControls = {
      throttle: this.car.speed < desiredSpeed || this.stuckTimer > 0.35,
      brakeReverse: shouldBrake && canBrakeWithoutReversing,
      handbrake: false,
      steering: this.smoothedSteering,
      steeringAssist: edgeRatio > 0.72 ? 1.16 : 1.04,
      steerLeft: steeringError > 0.08,
      steerRight: steeringError < -0.08,
      resetPressed: false,
    };

    this.car.update(deltaTime, this.currentControls, this.track);
    this.#applyRacingLineAssist(deltaTime, progress, lookAhead);
    this.#recoverIfStuck(deltaTime, progress, lookAhead, edgeRatio);

    return this.currentControls;
  }

  getProgressScore(lapState) {
    return (lapState.currentLap - 1) + this.track.getProgressAtPosition(this.car.group.position, this.car.trackProgress);
  }

  #calculateTraffic(nearbyCars) {
    let laneShift = 0;
    let speedMultiplier = 1;
    const passRoom = THREE.MathUtils.clamp((this.track.roadWidth - 14) / 12, 0, 1);
    const forward = this.#getForwardVector();
    const right = this.#getRightVector();

    for (const otherCar of nearbyCars) {
      if (!otherCar || otherCar === this.car) continue;

      const offset = otherCar.group.position.clone().sub(this.car.group.position);
      const forwardDistance = offset.dot(forward);
      const sideDistance = offset.dot(right);
      const isAhead = forwardDistance > 0 && forwardDistance < 18;
      const isAdjacentTraffic = Math.abs(sideDistance) < 6.2;
      const isSameLaneTraffic = Math.abs(sideDistance) < 3.4;

      if (!isAhead || !isAdjacentTraffic) {
        continue;
      }

      const passDirection = sideDistance >= 0 ? -1 : 1;
      laneShift += passDirection * THREE.MathUtils.lerp(0.08, 0.42, this.settings.aggression) * passRoom;

      if (isSameLaneTraffic) {
        speedMultiplier = Math.min(speedMultiplier, THREE.MathUtils.clamp(forwardDistance / 14, 0.82, 0.98));
      }
    }

    return {
      laneShift: THREE.MathUtils.clamp(laneShift, -0.45, 0.45),
      speedMultiplier,
    };
  }

  #recoverIfStuck(deltaTime, progress, lookAhead, edgeRatio) {
    const movement = this.car.group.position.distanceTo(this.previousPosition);
    const tryingToMove = this.currentControls.throttle || this.currentControls.brakeReverse || Math.abs(this.car.speed) < 1;

    if (tryingToMove && movement < 0.12) {
      this.stuckTimer += deltaTime;
    } else {
      this.stuckTimer = Math.max(0, this.stuckTimer - deltaTime * 1.5);
    }

    if (this.stuckTimer > 0.7) {
      this.overtakeOffset = THREE.MathUtils.damp(this.overtakeOffset, 0, 5, deltaTime);
    }

    if (this.stuckTimer > 0.45 || edgeRatio > 0.82) {
      const heading = this.#getHeadingAt(progress + lookAhead);
      this.car.group.rotation.y = this.#dampAngle(this.car.group.rotation.y, heading, 3.2, deltaTime);
      this.car.velocity.addScaledVector(this.#getForwardVector(), 7 * deltaTime);
    }

    if (this.stuckTimer > this.settings.recoverySeconds) {
      const target = this.#getOffsetTrackPoint(progress, 0);
      const heading = this.#getHeadingAt(progress);
      const correction = target.clone().sub(this.car.group.position);
      correction.y = 0;

      if (correction.lengthSq() > 0.001) {
        const correctionLength = correction.length();
        const maxStep = 1.1 * deltaTime;
        this.car.group.position.addScaledVector(correction.normalize(), Math.min(maxStep, correctionLength));
      }

      this.car.group.rotation.y = this.#dampAngle(this.car.group.rotation.y, heading, 5.5, deltaTime);
      this.car.velocity.multiplyScalar(0.82);
      this.car.velocity.addScaledVector(this.#getForwardVector(), 12 * deltaTime);
      this.stuckTimer = this.settings.recoverySeconds * 0.35;
    }

    this.previousPosition.copy(this.car.group.position);
  }

  #applyRacingLineAssist(deltaTime, progress, lookAhead) {
    const currentProgress = this.track.getProgressAtPosition(this.car.group.position, progress);
    const laneInfo = this.#getLaneInfo(this.car.group.position, currentProgress);
    const laneLimit = Math.max(this.#getUsableLaneLimit(), 0.001);
    const edgeRatio = Math.abs(laneInfo.offset) / laneLimit;
    const heading = this.#getHeadingAt(currentProgress + lookAhead * 0.9);
    const assistStrength = THREE.MathUtils.clamp((edgeRatio - 0.44) / 0.46, 0, 1);

    if (edgeRatio > 0.58) {
      this.car.group.rotation.y = this.#dampAngle(
        this.car.group.rotation.y,
        heading,
        1.4 + assistStrength * 3.2,
        deltaTime,
      );
    }

    if (edgeRatio > 0.52) {
      const inward = laneInfo.center.clone().sub(this.car.group.position);
      inward.y = 0;
      const inwardDistance = inward.length();

      if (inwardDistance > 0.001) {
        inward.multiplyScalar(1 / inwardDistance);
        const correctionStep = Math.min(inwardDistance, (0.4 + assistStrength * 1.35) * deltaTime);
        this.car.group.position.addScaledVector(inward, correctionStep);

        const outwardSpeed = this.car.velocity.dot(inward.clone().multiplyScalar(-1));
        if (outwardSpeed > 0) {
          this.car.velocity.addScaledVector(inward, outwardSpeed * 0.8);
        }
      }
    }

    this.car.trackProgress = currentProgress;
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
    return Math.max(1.35, halfRoad - carHalfWidth - 2.35);
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

  #dampAngle(current, target, lambda, deltaTime) {
    const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
    return current + delta * (1 - Math.exp(-lambda * deltaTime));
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
      steering: 0,
      steeringAssist: 1,
      steerLeft: false,
      steerRight: false,
      resetPressed: false,
    };
  }
}

export { DIFFICULTY_SETTINGS };
