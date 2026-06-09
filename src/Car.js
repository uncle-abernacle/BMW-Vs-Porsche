import * as THREE from "three";

export const MPH_PER_WORLD_UNIT = 3.1;

// Car is a small arcade-physics vehicle. It intentionally favors responsive
// steering and readable behavior over simulation accuracy, which fits the
// PS2-era arcade racer target for this starter project.
export class Car {
  constructor({
    name,
    bodyColor,
    stripeColor,
    width = 4.2,
    length = 7.2,
    height = 0.75,
    cabinWidth = 3.25,
    cabinLength = 3.15,
    cabinHeight = 0.95,
    cabinOffsetZ = -0.75,
    spoilerWidth = 4.4,
    maxForwardSpeed = null,
    acceleration = 36,
    brakeForce = 46,
    lateralGrip = 7.8,
    handbrakeGrip = 2.2,
    turnRate = 2.65,
    airDrag = 0.012,
    engineProfile = {},
    startPosition = new THREE.Vector3(),
    startRotation = 0,
    isPlayer = false,
  }) {
    this.name = name;
    this.isPlayer = isPlayer;
    this.speed = 0;
    this.steerAmount = 0;
    this.driftAmount = 0;
    this.lastSurfaceCorrectionStrength = 0;
    this.roadPitch = 0;
    this.roadRoll = 0;
    this.rideHeight = 0.42;
    this.trackProgress = 0;
    this.velocity = new THREE.Vector3();

    // Internal velocity is measured in world units per second. The HUD maps
    // the player car's 58 world-unit top speed to roughly 180 mph.
    this.mphPerWorldUnit = MPH_PER_WORLD_UNIT;
    this.maxForwardSpeed = maxForwardSpeed ?? (isPlayer ? 58 : 44);
    this.maxReverseSpeed = -15;
    this.acceleration = acceleration;
    this.reverseAcceleration = 22;
    this.brakeForce = brakeForce;
    this.handbrakeForce = 18;
    this.rollingDrag = 0.12;
    this.airDrag = airDrag;
    this.lateralGrip = lateralGrip;
    this.handbrakeGrip = handbrakeGrip;
    this.turnRate = turnRate;
    this.engineProfile = {
      idleHz: 62,
      maxHz: 285,
      roughness: 5,
      gain: 1,
      ...engineProfile,
    };

    this.group = new THREE.Group();
    this.group.name = `${name} Car`;
    this.visualBody = new THREE.Group();
    this.visualBody.name = `${name} Visual Body`;
    this.group.add(this.visualBody);
    this.wheels = [];
    this.design = {
      width,
      length,
      height,
      cabinWidth,
      cabinLength,
      cabinHeight,
      cabinOffsetZ,
      spoilerWidth,
    };

    this.#buildModel(bodyColor, stripeColor);
    this.reset(startPosition, startRotation);
  }

  reset(position, rotationY) {
    this.group.position.copy(position);
    this.group.rotation.set(0, rotationY, 0);
    this.speed = 0;
    this.steerAmount = 0;
    this.driftAmount = 0;
    this.lastSurfaceCorrectionStrength = 0;
    this.roadPitch = 0;
    this.roadRoll = 0;
    this.visualBody.rotation.set(0, 0, 0);
    this.trackProgress = 0;
    this.velocity.set(0, 0, 0);
  }

  update(deltaTime, controls, track) {
    const throttle = controls.throttle ? 1 : 0;
    const brakeOrReverse = controls.brakeReverse ? 1 : 0;
    const handbrake = controls.handbrake ? 1 : 0;
    const steeringInput =
      controls.steering ?? (controls.steerLeft ? 1 : controls.steerRight ? -1 : 0);

    const forward = this.#getForwardVector();
    const right = this.#getRightVector();
    const forwardSpeed = this.velocity.dot(forward);
    const lateralSpeed = this.velocity.dot(right);
    const speedMagnitude = this.velocity.length();
    const speedRatio = THREE.MathUtils.clamp(speedMagnitude / this.maxForwardSpeed, 0, 1);
    const steeringSmoothness = THREE.MathUtils.lerp(4.2, 5.6, speedRatio);
    this.steerAmount = THREE.MathUtils.damp(this.steerAmount, steeringInput, steeringSmoothness, deltaTime);

    this.#applyDriveForces(deltaTime, {
      throttle,
      brakeOrReverse,
      handbrake,
      forward,
      forwardSpeed,
      speedMagnitude,
    });

    this.#applyLateralGrip(deltaTime, {
      handbrake,
      right,
      lateralSpeed,
      speedRatio,
    });

    // Steering is strongest at arcade-racer speeds and fades at rest so the
    // vehicle does not spin like a turret before it starts moving.
    const steerResponse = 0.12 + speedRatio * 0.6;
    const reverseSteer = forwardSpeed >= -0.5 ? 1 : -1;
    const driftYawBoost = 1 + this.driftAmount * 0.24;
    const steeringAssist = controls.steeringAssist ?? 1;
    const yawDelta =
      this.steerAmount * this.turnRate * steerResponse * driftYawBoost * steeringAssist * reverseSteer * deltaTime;
    const maxYawStep = 1.38 * steeringAssist * deltaTime;
    this.group.rotation.y += THREE.MathUtils.clamp(yawDelta, -maxYawStep, maxYawStep);

    this.#limitTopSpeed();
    this.group.position.addScaledVector(this.velocity, deltaTime);
    this.speed = this.velocity.dot(this.#getForwardVector());

    this.#keepOnTrack(track);
    this.#alignToRoad(deltaTime, track);
    this.#tiltBody(deltaTime, speedRatio, lateralSpeed);
    this.animateWheels(deltaTime, this.speed);
  }

  animateWheels(deltaTime, speed) {
    const wheelSpin = speed * deltaTime * 1.4;

    for (const wheel of this.wheels) {
      wheel.rotation.x += wheelSpin;
    }
  }

  getDisplaySpeed() {
    return Math.round(Math.abs(this.speed) * this.mphPerWorldUnit);
  }

  getGearLabel() {
    if (Math.abs(this.speed) < 0.75) return "N";
    if (this.speed < 0) return "R";

    if (this.speed < 15) return "1";
    if (this.speed < 30) return "2";
    if (this.speed < 45) return "3";
    return "4";
  }

  #applyDriveForces(deltaTime, { throttle, brakeOrReverse, handbrake, forward, forwardSpeed }) {
    const forwardSpeedRatio = THREE.MathUtils.clamp(forwardSpeed / this.maxForwardSpeed, 0, 1);

    if (throttle && forwardSpeed < this.maxForwardSpeed) {
      const accelerationFade = 1 - forwardSpeedRatio * 0.3;
      this.velocity.addScaledVector(forward, this.acceleration * accelerationFade * deltaTime);
    }

    if (brakeOrReverse) {
      if (forwardSpeed > 2) {
        this.velocity.addScaledVector(forward, -this.brakeForce * deltaTime);
      } else if (forwardSpeed > this.maxReverseSpeed) {
        this.velocity.addScaledVector(forward, -this.reverseAcceleration * deltaTime);
      }
    }

    if (handbrake && Math.abs(forwardSpeed) > 0.5) {
      const brakingDirection = forwardSpeed >= 0 ? -1 : 1;
      this.velocity.addScaledVector(forward, this.handbrakeForce * brakingDirection * deltaTime);
    }

    // Full throttle should reach the advertised limiter. Off throttle keeps
    // stronger drag so faster cars still feel heavier and coast down naturally.
    const rollingDrag = throttle ? this.rollingDrag * 0.36 : this.rollingDrag;
    const airDrag = throttle ? this.airDrag * 0.16 : this.airDrag;
    this.velocity.addScaledVector(forward, -forwardSpeed * rollingDrag * deltaTime);
    this.velocity.multiplyScalar(1 / (1 + this.velocity.length() * airDrag * deltaTime));

    const correctedForwardSpeed = this.velocity.dot(forward);
    const topSpeedHold = this.maxForwardSpeed;

    if (
      throttle &&
      !brakeOrReverse &&
      !handbrake &&
      correctedForwardSpeed > this.maxForwardSpeed * 0.95 &&
      correctedForwardSpeed < topSpeedHold
    ) {
      this.velocity.addScaledVector(forward, topSpeedHold - correctedForwardSpeed);
    }
  }

  #applyLateralGrip(deltaTime, { handbrake, right, lateralSpeed, speedRatio }) {
    const slipRatio = THREE.MathUtils.clamp(Math.abs(lateralSpeed) / 20, 0, 1);
    const grip = THREE.MathUtils.lerp(this.lateralGrip, this.lateralGrip * 0.38, slipRatio);
    const activeGrip = handbrake ? this.handbrakeGrip : grip;

    // Removing only part of the sideways velocity creates a controllable slide.
    // Handbrake lowers grip enough that the rear can rotate into a drift.
    this.velocity.addScaledVector(right, -lateralSpeed * activeGrip * deltaTime);
    this.driftAmount = THREE.MathUtils.damp(
      this.driftAmount,
      handbrake ? Math.max(0.45, slipRatio) : slipRatio,
      6,
      deltaTime,
    );
    this.driftAmount *= 0.55 + speedRatio * 0.45;
  }

  #limitTopSpeed() {
    const forward = this.#getForwardVector();
    const forwardSpeed = this.velocity.dot(forward);

    if (forwardSpeed > this.maxForwardSpeed) {
      this.velocity.addScaledVector(forward, this.maxForwardSpeed - forwardSpeed);
    }

    if (forwardSpeed < this.maxReverseSpeed) {
      this.velocity.addScaledVector(forward, this.maxReverseSpeed - forwardSpeed);
    }
  }

  #getForwardVector() {
    return new THREE.Vector3(-Math.sin(this.group.rotation.y), 0, -Math.cos(this.group.rotation.y));
  }

  #getRightVector() {
    return new THREE.Vector3(Math.cos(this.group.rotation.y), 0, -Math.sin(this.group.rotation.y));
  }

  #keepOnTrack(track) {
    const vehicleHalfWidth = this.design.width * 0.58;
    const correction = track.getSurfaceCorrection(this.group.position, this.trackProgress, vehicleHalfWidth);

    if (!correction) {
      this.lastSurfaceCorrectionStrength = 0;
      return;
    }

    // Rather than hard-stopping outside the starter road, ease the player back
    // toward the nearest legal surface and scrub some speed. This feels like
    // grass or gravel runoff without needing collision meshes yet.
    const inward = correction.direction.clone();
    this.group.position.addScaledVector(inward, correction.strength);

    const outward = inward.clone().multiplyScalar(-1);
    const outwardSpeed = this.velocity.dot(outward);

    if (outwardSpeed > 0) {
      this.velocity.addScaledVector(outward, -outwardSpeed * 0.86);
    }

    this.velocity.multiplyScalar(correction.speedMultiplier);
    this.speed = this.velocity.dot(this.#getForwardVector());
    this.lastSurfaceCorrectionStrength = correction.strength;
    this.trackProgress = correction.progress ?? this.trackProgress;
  }

  #alignToRoad(deltaTime, track) {
    if (!track.getRoadHeightAtPosition && !track.getRoadSurfaceAtPosition) {
      return;
    }

    const surface = track.getRoadSurfaceAtPosition?.(this.group.position, this.trackProgress);
    this.trackProgress = surface?.progress ?? this.trackProgress;
    const wheelFit = surface ? this.#sampleWheelContact(track, surface.progress) : null;
    const turnClearance = Math.abs(this.steerAmount) * Math.min(Math.abs(this.speed) / this.maxForwardSpeed, 1) * 0.16;
    const targetHeight =
      (wheelFit?.height ?? surface?.height ?? track.getRoadHeightAtPosition(this.group.position)) +
      this.rideHeight +
      turnClearance;
    this.group.position.y =
      deltaTime <= 0 ? targetHeight : THREE.MathUtils.damp(this.group.position.y, targetHeight, 35, deltaTime);
    const roadPitch = surface?.pitch ?? 0;
    const wheelPitch = wheelFit?.pitch ?? roadPitch;
    const targetPitch = THREE.MathUtils.clamp(THREE.MathUtils.lerp(roadPitch, wheelPitch, 0.25), -0.34, 0.34);
    const targetRoll = THREE.MathUtils.clamp(wheelFit?.roll ?? surface?.roll ?? 0, -0.08, 0.08);
    this.roadPitch = THREE.MathUtils.damp(this.roadPitch, targetPitch, 16, deltaTime);
    this.roadRoll = THREE.MathUtils.damp(this.roadRoll, targetRoll, 10, deltaTime);
  }

  #sampleWheelContact(track, progress) {
    const forward = this.#getForwardVector();
    const right = this.#getRightVector();
    const center = this.group.position;
    const halfLength = this.design.length * 0.33;
    const halfWidth = this.design.width * 0.5;
    const sample = (forwardOffset, sideOffset) => {
      const samplePosition = center
        .clone()
        .addScaledVector(forward, forwardOffset)
        .addScaledVector(right, sideOffset);
      return track.getRoadSurfaceAtPosition(samplePosition, progress);
    };
    const frontLeft = sample(halfLength, -halfWidth);
    const frontRight = sample(halfLength, halfWidth);
    const rearLeft = sample(-halfLength, -halfWidth);
    const rearRight = sample(-halfLength, halfWidth);
    const frontHeight = (frontLeft.height + frontRight.height) * 0.5;
    const rearHeight = (rearLeft.height + rearRight.height) * 0.5;
    const leftHeight = (frontLeft.height + rearLeft.height) * 0.5;
    const rightHeight = (frontRight.height + rearRight.height) * 0.5;

    return {
      height: (frontHeight + rearHeight) * 0.5,
      pitch: Math.atan2(frontHeight - rearHeight, halfLength * 2),
      roll: Math.atan2(rightHeight - leftHeight, halfWidth * 2),
    };
  }

  #tiltBody(deltaTime, speedRatio, lateralSpeed) {
    const corneringRoll = this.steerAmount * speedRatio * 0.035;
    const driftRoll = THREE.MathUtils.clamp(lateralSpeed / 110, -0.02, 0.02);
    const targetRoll = THREE.MathUtils.clamp(this.roadRoll + corneringRoll + driftRoll, -0.11, 0.11);
    const targetPitch = this.roadPitch;

    this.visualBody.rotation.z = THREE.MathUtils.damp(this.visualBody.rotation.z, targetRoll, 7, deltaTime);
    this.visualBody.rotation.x = THREE.MathUtils.damp(this.visualBody.rotation.x, targetPitch, 8, deltaTime);
  }

  #buildModel(bodyColor, stripeColor) {
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: bodyColor,
      emissive: new THREE.Color(bodyColor).multiplyScalar(0.045),
      roughness: 0.34,
      metalness: 0.42,
    });
    const stripeMaterial = new THREE.MeshStandardMaterial({
      color: stripeColor,
      emissive: new THREE.Color(stripeColor).multiplyScalar(0.04),
      roughness: 0.48,
      metalness: 0.16,
    });
    const decalMaterial = new THREE.MeshStandardMaterial({
      color: stripeColor,
      emissive: new THREE.Color(stripeColor).multiplyScalar(0.05),
      roughness: 0.46,
      metalness: 0.18,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    const glassMaterial = new THREE.MeshStandardMaterial({
      color: 0x111d26,
      emissive: 0x071119,
      roughness: 0.08,
      metalness: 0.34,
    });
    const tireMaterial = new THREE.MeshStandardMaterial({
      color: 0x111111,
      roughness: 0.84,
    });
    const rimMaterial = new THREE.MeshStandardMaterial({
      color: 0xcfd7df,
      roughness: 0.32,
      metalness: 0.65,
    });
    const lightMaterial = new THREE.MeshStandardMaterial({
      color: 0xf5e6b2,
      emissive: 0x8f6c28,
      roughness: 0.28,
      metalness: 0.08,
    });
    const tailLightMaterial = new THREE.MeshStandardMaterial({
      color: 0xb93628,
      emissive: 0x5a0d08,
      roughness: 0.36,
    });
    const shadowMaterial = new THREE.MeshBasicMaterial({
      color: 0x050505,
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    const { width, length, height, cabinWidth, cabinLength, cabinHeight, cabinOffsetZ, spoilerWidth } =
      this.design;
    const lowerBody = new THREE.Mesh(new THREE.BoxGeometry(width, height, length), bodyMaterial);
    lowerBody.position.y = 0.48 + height * 0.5;
    lowerBody.castShadow = true;
    lowerBody.receiveShadow = true;
    this.visualBody.add(lowerBody);

    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(cabinWidth, cabinHeight, cabinLength),
      glassMaterial,
    );
    cabin.position.set(0, lowerBody.position.y + height * 0.5 + cabinHeight * 0.45, cabinOffsetZ);
    cabin.castShadow = true;
    this.visualBody.add(cabin);

    const hoodStripe = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(width * 0.11, 0.36), 0.028, length * 0.84),
      decalMaterial,
    );
    hoodStripe.position.set(0, lowerBody.position.y + height * 0.59, -0.28);
    hoodStripe.castShadow = true;
    hoodStripe.renderOrder = 8;
    this.visualBody.add(hoodStripe);

    const bodyTopY = lowerBody.position.y + height * 0.5;
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(spoilerWidth, 0.18, 0.45), stripeMaterial);
    spoiler.position.set(0, bodyTopY + 0.22, length * 0.48);
    spoiler.castShadow = true;
    this.visualBody.add(spoiler);

    for (const side of [-1, 1]) {
      const spoilerPost = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.3, 0.16), stripeMaterial);
      spoilerPost.position.set(side * spoilerWidth * 0.32, bodyTopY + 0.08, length * 0.44);
      spoilerPost.castShadow = true;
      this.visualBody.add(spoilerPost);
    }

    const frontLightLeft = new THREE.Mesh(new THREE.BoxGeometry(width * 0.28, 0.18, 0.08), lightMaterial);
    frontLightLeft.position.set(-width * 0.23, lowerBody.position.y + height * 0.12, -length * 0.51);
    this.visualBody.add(frontLightLeft);

    const frontLightRight = frontLightLeft.clone();
    frontLightRight.position.x = width * 0.23;
    this.visualBody.add(frontLightRight);

    const tailLightLeft = new THREE.Mesh(new THREE.BoxGeometry(width * 0.25, 0.16, 0.08), tailLightMaterial);
    tailLightLeft.position.set(-width * 0.24, lowerBody.position.y + height * 0.08, length * 0.51);
    this.visualBody.add(tailLightLeft);

    const tailLightRight = tailLightLeft.clone();
    tailLightRight.position.x = width * 0.24;
    this.visualBody.add(tailLightRight);

    const reflectionStrip = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.72, 0.028, length * 0.14),
      new THREE.MeshStandardMaterial({
        color: 0xd6efff,
        emissive: 0x375166,
        roughness: 0.18,
        metalness: 0.22,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      }),
    );
    reflectionStrip.position.set(0, lowerBody.position.y + height * 0.62, -length * 0.22);
    reflectionStrip.renderOrder = 9;
    this.visualBody.add(reflectionStrip);

    const frontBumper = new THREE.Mesh(new THREE.BoxGeometry(width * 0.92, 0.22, 0.28), stripeMaterial);
    frontBumper.position.set(0, lowerBody.position.y - height * 0.24, -length * 0.54);
    frontBumper.castShadow = true;
    this.visualBody.add(frontBumper);

    const rearBumper = new THREE.Mesh(new THREE.BoxGeometry(width * 0.88, 0.24, 0.3), stripeMaterial);
    rearBumper.position.set(0, lowerBody.position.y - height * 0.22, length * 0.54);
    rearBumper.castShadow = true;
    this.visualBody.add(rearBumper);

    for (const side of [-1, 1]) {
      const sideSkirt = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, length * 0.4), stripeMaterial);
      sideSkirt.position.set(side * width * 0.5, lowerBody.position.y - height * 0.22, 0.02);
      sideSkirt.castShadow = true;
      this.visualBody.add(sideSkirt);

      const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.18, 0.38), glassMaterial);
      mirror.position.set(
        side * (cabinWidth * 0.5 + 0.13),
        cabin.position.y - cabinHeight * 0.04,
        cabin.position.z - cabinLength * 0.22,
      );
      mirror.castShadow = true;
      this.visualBody.add(mirror);

      const mirrorArm = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.2), glassMaterial);
      mirrorArm.position.set(
        side * (cabinWidth * 0.5 + 0.02),
        cabin.position.y - cabinHeight * 0.06,
        cabin.position.z - cabinLength * 0.21,
      );
      mirrorArm.castShadow = true;
      this.visualBody.add(mirrorArm);
    }

    const shadowBlob = new THREE.Mesh(new THREE.CircleGeometry(Math.max(width, length) * 0.62, 18), shadowMaterial);
    shadowBlob.rotation.x = -Math.PI / 2;
    shadowBlob.scale.z = 0.58;
    shadowBlob.position.y = 0.07;
    shadowBlob.renderOrder = -1;
    this.group.add(shadowBlob);

    const wheelX = width * 0.48;
    const wheelZ = length * 0.33;
    this.#addWheel(-wheelX, 0.55, -wheelZ, tireMaterial, rimMaterial);
    this.#addWheel(wheelX, 0.55, -wheelZ, tireMaterial, rimMaterial);
    this.#addWheel(-wheelX, 0.55, wheelZ, tireMaterial, rimMaterial);
    this.#addWheel(wheelX, 0.55, wheelZ, tireMaterial, rimMaterial);

  }

  #addWheel(x, y, z, tireMaterial, rimMaterial) {
    const wheelGroup = new THREE.Group();
    wheelGroup.position.set(x, y, z);
    wheelGroup.rotation.z = Math.PI / 2;

    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.45, 24), tireMaterial);
    tire.castShadow = true;
    tire.receiveShadow = true;
    wheelGroup.add(tire);

    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.5, 18), rimMaterial);
    rim.castShadow = true;
    wheelGroup.add(rim);

    this.wheels.push(wheelGroup);
    this.visualBody.add(wheelGroup);
  }
}
