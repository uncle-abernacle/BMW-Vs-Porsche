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
    startPosition = new THREE.Vector3(),
    startRotation = 0,
    isPlayer = false,
  }) {
    this.name = name;
    this.isPlayer = isPlayer;
    this.speed = 0;
    this.steerAmount = 0;
    this.driftAmount = 0;
    this.velocity = new THREE.Vector3();

    // Internal velocity is measured in world units per second. The HUD maps
    // the player car's 58 world-unit top speed to roughly 180 mph.
    this.mphPerWorldUnit = 3.1;
    this.maxForwardSpeed = isPlayer ? 58 : 44;
    this.maxReverseSpeed = -15;
    this.acceleration = 36;
    this.reverseAcceleration = 22;
    this.brakeForce = 46;
    this.handbrakeForce = 18;
    this.rollingDrag = 0.12;
    this.airDrag = 0.012;
    this.lateralGrip = 7.8;
    this.handbrakeGrip = 2.2;
    this.turnRate = 2.65;

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
      return;
    }

    // Rather than hard-stopping outside the starter road, ease the player back
    // toward the nearest legal surface and scrub some speed. This feels like
    // grass or gravel runoff without needing collision meshes yet.
    this.group.position.add(correction.direction.multiplyScalar(correction.strength));
    this.velocity.multiplyScalar(correction.speedMultiplier);
    this.speed = this.velocity.dot(this.#getForwardVector());
  }

  #tiltBody(deltaTime, speedRatio, lateralSpeed) {
    const corneringRoll = this.steerAmount * speedRatio * 0.16;
    const driftRoll = THREE.MathUtils.clamp(lateralSpeed / 45, -0.1, 0.1);
    const targetRoll = corneringRoll + driftRoll;
    const targetPitch = THREE.MathUtils.clamp(-this.speed / this.maxForwardSpeed, -0.13, 0.1);

    this.group.rotation.z = THREE.MathUtils.damp(this.group.rotation.z, targetRoll, 8, deltaTime);
    this.group.rotation.x = THREE.MathUtils.damp(this.group.rotation.x, targetPitch, 5, deltaTime);
  }

  #buildModel(bodyColor, stripeColor) {
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: bodyColor,
      roughness: 0.42,
      metalness: 0.28,
    });
    const stripeMaterial = new THREE.MeshStandardMaterial({
      color: stripeColor,
      roughness: 0.55,
      metalness: 0.08,
    });
    const glassMaterial = new THREE.MeshStandardMaterial({
      color: 0x101820,
      roughness: 0.2,
      metalness: 0.1,
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
