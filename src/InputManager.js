// InputManager converts browser keyboard state into game-friendly controls.
// Keeping raw key handling isolated makes it easy to add touch controls or
// gamepad support later without rewriting the car physics.
export class InputManager {
  constructor() {
    this.keys = new Set();
    this.resetPressed = false;

    window.addEventListener("keydown", (event) => this.#handleKeyDown(event));
    window.addEventListener("keyup", (event) => this.#handleKeyUp(event));
    window.addEventListener("blur", () => this.keys.clear());
  }

  getControls() {
    return {
      throttle: this.#isDown("KeyW") || this.#isDown("ArrowUp"),
      brakeReverse: this.#isDown("KeyS") || this.#isDown("ArrowDown"),
      steerLeft: this.#isDown("KeyA") || this.#isDown("ArrowLeft"),
      steerRight: this.#isDown("KeyD") || this.#isDown("ArrowRight"),
      handbrake: this.#isDown("Space"),
      resetPressed: this.resetPressed,
    };
  }

  consumeReset() {
    this.resetPressed = false;
  }

  #handleKeyDown(event) {
    if (this.#isGameKey(event.code)) {
      event.preventDefault();
    }

    if (event.code === "KeyR" && !this.keys.has("KeyR")) {
      this.resetPressed = true;
    }

    this.keys.add(event.code);
  }

  #handleKeyUp(event) {
    this.keys.delete(event.code);
  }

  #isDown(code) {
    return this.keys.has(code);
  }

  #isGameKey(code) {
    return [
      "KeyW",
      "KeyA",
      "KeyS",
      "KeyD",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Space",
      "KeyR",
    ].includes(code);
  }
}
