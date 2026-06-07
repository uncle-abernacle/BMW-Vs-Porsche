import * as THREE from "three";

// A chase camera is central to the arcade racer feel. This controller keeps
// the camera behind and above the player's car, with mild speed-based pullback
// so acceleration is visible even on a flat starter course.
export class CameraController {
  constructor(camera, target, { collisionObjects = [] } = {}) {
    this.camera = camera;
    this.target = target;
    this.desiredPosition = new THREE.Vector3();
    this.safePosition = new THREE.Vector3();
    this.lookAtPosition = new THREE.Vector3();
    this.raycaster = new THREE.Raycaster();
    this.collisionObjects = collisionObjects;

    // Main tuning hook: increase this for a farther arcade chase camera, or
    // lower it for a tighter bumper-style view.
    this.cameraDistance = 15;
    this.cameraHeight = 7.25;
    this.lookAheadDistance = 13;
    this.minCameraHeight = 2.25;
    this.collisionPadding = 1.35;
    this.currentRoll = 0;
  }

  snapToTarget() {
    this.#calculateLookAtPosition(0);
    this.#calculateDesiredPosition(0);
    this.#preventCameraCollision();
    this.camera.position.copy(this.safePosition);
    this.camera.lookAt(this.target.position);
    this.currentRoll = 0;
  }

  update(deltaTime, { speed = 0, steering = 0, drift = 0 } = {}) {
    this.#calculateLookAtPosition(speed);
    this.#calculateDesiredPosition(speed);
    this.#preventCameraCollision();

    // Early-2000s arcade chase cameras tend to lag a touch behind fast inputs.
    // Separate position and roll damping gives the camera weight without
    // making steering feel disconnected.
    this.camera.position.lerp(this.safePosition, 1 - Math.exp(-deltaTime * 6.5));

    this.camera.lookAt(this.lookAtPosition);

    const speedRoll = THREE.MathUtils.clamp(Math.abs(speed) / 58, 0, 1);
    const targetRoll = THREE.MathUtils.clamp((-steering * 0.055 - drift * 0.035) * speedRoll, -0.075, 0.075);
    this.currentRoll = THREE.MathUtils.damp(this.currentRoll, targetRoll, 5.5, deltaTime);
    this.camera.rotateZ(this.currentRoll);
  }

  #calculateDesiredPosition(targetSpeed) {
    const speedPullback = THREE.MathUtils.clamp(Math.abs(targetSpeed) * 0.07, 0, 5);
    const offset = new THREE.Vector3(0, this.cameraHeight, this.cameraDistance + speedPullback);

    offset.applyQuaternion(this.target.quaternion);
    this.desiredPosition.copy(this.target.position).add(offset);
    this.desiredPosition.y = Math.max(this.desiredPosition.y, this.minCameraHeight);
  }

  #calculateLookAtPosition(targetSpeed) {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.target.quaternion);
    const speedLookAhead = THREE.MathUtils.clamp(Math.abs(targetSpeed) * 0.045, 0, 3.5);

    this.lookAtPosition
      .copy(this.target.position)
      .add(forward.multiplyScalar(this.lookAheadDistance + speedLookAhead));
    this.lookAtPosition.y += 2.35;
  }

  #preventCameraCollision() {
    this.safePosition.copy(this.desiredPosition);

    const castOrigin = this.lookAtPosition.clone();
    const castDirection = this.desiredPosition.clone().sub(castOrigin);
    const desiredDistance = castDirection.length();

    if (desiredDistance === 0) {
      return;
    }

    castDirection.normalize();
    this.raycaster.set(castOrigin, castDirection);
    this.raycaster.far = desiredDistance;

    const hits = this.raycaster.intersectObjects(this.collisionObjects, false);
    const firstSolidHit = hits.find((hit) => hit.distance > this.collisionPadding);

    if (firstSolidHit) {
      const safeDistance = Math.max(firstSolidHit.distance - this.collisionPadding, 4.5);
      this.safePosition.copy(castOrigin).addScaledVector(castDirection, safeDistance);
    }

    this.safePosition.y = Math.max(this.safePosition.y, this.minCameraHeight);
  }
}
