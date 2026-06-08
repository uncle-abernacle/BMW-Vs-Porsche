import * as THREE from "three";

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
    this.velocity = new THREE.Vector3();

    // Internal velocity is measured in world units per second. The HUD maps
    // the player car's 58 world-unit top speed to roughly 180 mph.
    this.mphPerWorldUnit = 3.1;
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
    this.velocity.set(0, 0, 0);
  }

  update(deltaTime, controls, track) {
    const throttle = controls.throttle ? 1 : 0;
    const brakeOrReverse = controls.brakeReverse ? 1 : 0;
    const handbrake = controls.handbrake ? 1 : 0;
    const steeringInput = controls.steerLeft ? 1 : controls.steerRight ? -1 : 0;
    this.steerAmount = THREE.MathUtils.damp(this.steerAmount, steeringInput, 9, deltaTime);

    const forward = this.#getForwardVector();
    const right = this.#getRightVector();
    const forwardSpeed = this.velocity.dot(forward);
    const lateralSpeed = this.velocity.dot(right);
    const speedMagnitude = this.velocity.length();
    const speedRatio = THREE.MathUtils.clamp(speedMagnitude / this.maxForwardSpeed, 0, 1);

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
    const steerResponse = 0.2 + speedRatio * 0.9;
    const reverseSteer = forwardSpeed >= -0.5 ? 1 : -1;
    const driftYawBoost = 1 + this.driftAmount * 0.55;
    this.group.rotation.y +=
      this.steerAmount * this.turnRate * steerResponse * driftYawBoost * reverseSteer * deltaTime;

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
    if (throttle && forwardSpeed < this.maxForwardSpeed) {
      const accelerationFade = 1 - THREE.MathUtils.clamp(forwardSpeed / this.maxForwardSpeed, 0, 1) * 0.42;
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

    // Rolling and air drag make high-speed lift-off feel weighty without
    // preventing the car from reaching the requested 180 mph top speed.
    this.velocity.addScaledVector(forward, -forwardSpeed * this.rollingDrag * deltaTime);
    this.velocity.multiplyScalar(1 / (1 + this.velocity.length() * this.airDrag * deltaTime));
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
    const correction = track.getSurfaceCorrection(this.group.position);

    if (!correction) {
      this.lastSurfaceCorrectionStrength = 0;
      return;
    }

    // Rather than hard-stopping outside the starter road, ease the player back
    // toward the nearest legal surface and scrub some speed. This feels like
    // grass or gravel runoff without needing collision meshes yet.
    this.group.position.add(correction.direction.multiplyScalar(correction.strength));
    this.velocity.multiplyScalar(correction.speedMultiplier);
    this.speed = this.velocity.dot(this.#getForwardVector());
    this.lastSurfaceCorrectionStrength = correction.strength;
  }

  #alignToRoad(deltaTime, track) {
    if (!track.getRoadHeightAtPosition && !track.getRoadSurfaceAtPosition) {
      return;
    }

    const surface = track.getRoadSurfaceAtPosition?.(this.group.position);
    const targetHeight = surface?.height ?? track.getRoadHeightAtPosition(this.group.position);
    this.group.position.y =
      deltaTime <= 0 ? targetHeight : THREE.MathUtils.damp(this.group.position.y, targetHeight, 30, deltaTime);
    this.roadPitch = THREE.MathUtils.damp(this.roadPitch, surface?.pitch ?? 0, 12, deltaTime);
    this.roadRoll = THREE.MathUtils.damp(this.roadRoll, surface?.roll ?? 0, 12, deltaTime);
  }

  #tiltBody(deltaTime, speedRatio, lateralSpeed) {
    const corneringRoll = this.steerAmount * speedRatio * 0.16;
    const driftRoll = THREE.MathUtils.clamp(lateralSpeed / 45, -0.1, 0.1);
    const targetRoll = this.roadRoll + corneringRoll + driftRoll;
    const dynamicPitch = THREE.MathUtils.clamp(-this.speed / this.maxForwardSpeed, -0.13, 0.1);
    const targetPitch = this.roadPitch + dynamicPitch;

    this.group.rotation.z = THREE.MathUtils.damp(this.group.rotation.z, targetRoll, 8, deltaTime);
    this.group.rotation.x = THREE.MathUtils.damp(this.group.rotation.x, targetPitch, 5, deltaTime);
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
    });

    const { width, length, height, cabinWidth, cabinLength, cabinHeight, cabinOffsetZ, spoilerWidth } =
      this.design;
    const lowerBody = new THREE.Mesh(new THREE.BoxGeometry(width, height, length), bodyMaterial);
    lowerBody.position.y = 0.48 + height * 0.5;
    lowerBody.castShadow = true;
    lowerBody.receiveShadow = true;
    this.group.add(lowerBody);

    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(cabinWidth, cabinHeight, cabinLength),
      glassMaterial,
    );
    cabin.position.set(0, lowerBody.position.y + height * 0.5 + cabinHeight * 0.45, cabinOffsetZ);
    cabin.castShadow = true;
    this.group.add(cabin);

    const hoodStripe = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(width * 0.11, 0.36), 0.03, length * 0.9),
      stripeMaterial,
    );
    hoodStripe.position.set(0, lowerBody.position.y + height * 0.53, -0.2);
    hoodStripe.castShadow = true;
    this.group.add(hoodStripe);

    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(spoilerWidth, 0.18, 0.45), stripeMaterial);
    spoiler.position.set(0, lowerBody.position.y + height * 0.75, length * 0.48);
    spoiler.castShadow = true;
    this.group.add(spoiler);

    const frontLightLeft = new THREE.Mesh(new THREE.BoxGeometry(width * 0.28, 0.18, 0.08), lightMaterial);
    frontLightLeft.position.set(-width * 0.23, lowerBody.position.y + height * 0.12, -length * 0.51);
    this.group.add(frontLightLeft);

    const frontLightRight = frontLightLeft.clone();
    frontLightRight.position.x = width * 0.23;
    this.group.add(frontLightRight);

    const tailLightLeft = new THREE.Mesh(new THREE.BoxGeometry(width * 0.25, 0.16, 0.08), tailLightMaterial);
    tailLightLeft.position.set(-width * 0.24, lowerBody.position.y + height * 0.08, length * 0.51);
    this.group.add(tailLightLeft);

    const tailLightRight = tailLightLeft.clone();
    tailLightRight.position.x = width * 0.24;
    this.group.add(tailLightRight);

    const reflectionStrip = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.82, 0.035, length * 0.18),
      new THREE.MeshStandardMaterial({
        color: 0xd6efff,
        emissive: 0x375166,
        roughness: 0.18,
        metalness: 0.22,
      }),
    );
    reflectionStrip.position.set(0, lowerBody.position.y + height * 0.55, -length * 0.22);
    this.group.add(reflectionStrip);

    const frontBumper = new THREE.Mesh(new THREE.BoxGeometry(width * 0.92, 0.22, 0.28), stripeMaterial);
    frontBumper.position.set(0, lowerBody.position.y - height * 0.24, -length * 0.54);
    frontBumper.castShadow = true;
    this.group.add(frontBumper);

    const rearBumper = new THREE.Mesh(new THREE.BoxGeometry(width * 0.88, 0.24, 0.3), stripeMaterial);
    rearBumper.position.set(0, lowerBody.position.y - height * 0.22, length * 0.54);
    rearBumper.castShadow = true;
    this.group.add(rearBumper);

    for (const side of [-1, 1]) {
      const sideSkirt = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, length * 0.72), stripeMaterial);
      sideSkirt.position.set(side * width * 0.54, lowerBody.position.y - height * 0.18, 0.05);
      sideSkirt.castShadow = true;
      this.group.add(sideSkirt);

      const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.18, 0.38), glassMaterial);
      mirror.position.set(
        side * (cabinWidth * 0.5 + 0.18),
        cabin.position.y + cabinHeight * 0.02,
        cabin.position.z - cabinLength * 0.22,
      );
      mirror.castShadow = true;
      this.group.add(mirror);

      const mirrorArm = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.07, 0.18), glassMaterial);
      mirrorArm.position.set(
        side * (cabinWidth * 0.5 + 0.04),
        cabin.position.y - cabinHeight * 0.02,
        cabin.position.z - cabinLength * 0.21,
      );
      mirrorArm.castShadow = true;
      this.group.add(mirrorArm);
    }

    const shadowBlob = new THREE.Mesh(new THREE.CircleGeometry(Math.max(width, length) * 0.62, 18), shadowMaterial);
    shadowBlob.rotation.x = -Math.PI / 2;
    shadowBlob.scale.z = 0.58;
    shadowBlob.position.y = 0.035;
    this.group.add(shadowBlob);

    const wheelX = width * 0.52;
    const wheelZ = length * 0.33;
    this.#addWheel(-wheelX, 0.55, -wheelZ, tireMaterial, rimMaterial);
    this.#addWheel(wheelX, 0.55, -wheelZ, tireMaterial, rimMaterial);
    this.#addWheel(-wheelX, 0.55, wheelZ, tireMaterial, rimMaterial);
    this.#addWheel(wheelX, 0.55, wheelZ, tireMaterial, rimMaterial);

    const namePlate = this.#makeNamePlate();
    namePlate.position.set(0, 2.35 + cabinHeight * 0.2, 0);
    this.group.add(namePlate);
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
    this.group.add(wheelGroup);
  }

  #makeNamePlate() {
    // Canvas text is converted into a texture so the starter game can label
    // vehicles without loading image files or font assets.
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const context = canvas.getContext("2d");

    context.fillStyle = "rgba(0, 0, 0, 0.72)";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#ffffff";
    context.font = "700 32px Arial";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(this.name, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(4, 1, 1);
    return sprite;
  }
}
