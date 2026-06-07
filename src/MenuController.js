import * as THREE from "three";
import { Car } from "./Car.js";
import { TEAMS } from "./VehicleCatalog.js";

export class MenuController {
  constructor({ onStart, onMenuSound, onOptionsChange }) {
    this.onStart = onStart;
    this.onMenuSound = onMenuSound;
    this.onOptionsChange = onOptionsChange;
    this.menu = document.querySelector("#menu");
    this.mainScreen = document.querySelector("[data-menu-screen='main']");
    this.modeScreen = document.querySelector("[data-menu-screen='mode']");
    this.teamScreen = document.querySelector("[data-menu-screen='team']");
    this.vehicleScreen = document.querySelector("[data-menu-screen='vehicle']");
    this.teamGrid = document.querySelector("#team-grid");
    this.vehicleGrid = document.querySelector("#vehicle-grid");
    this.modeTitle = document.querySelector("#mode-title");
    this.modeKicker = document.querySelector("#mode-kicker");
    this.modeDescription = document.querySelector("#mode-description");
    this.optionsPanel = document.querySelector("#options-panel");
    this.vehicleTitle = document.querySelector("#vehicle-title");
    this.vehicleDescription = document.querySelector("#vehicle-description");
    this.previewCanvas = document.querySelector("#vehicle-preview");
    this.startButton = document.querySelector("#start-race");
    this.backButtons = this.menu.querySelectorAll("[data-menu-back]");
    this.modeButtons = [...this.menu.querySelectorAll("[data-menu-action]")];
    this.optionInputs = {
      master: document.querySelector("#master-volume"),
      engine: document.querySelector("#engine-volume"),
      sfx: document.querySelector("#sfx-volume"),
      menu: document.querySelector("#menu-volume"),
      muted: document.querySelector("#mute-audio"),
    };

    this.selectedTeam = TEAMS[0];
    this.selectedVehicle = TEAMS[0].vehicles[0];
    this.selectedMode = "quick-race";
    this.currentScreenName = "main";
    this.selectedIndexByScreen = new Map();
    this.isReady = false;
    this.previewCar = null;
    this.previewClock = new THREE.Clock();
    this.modeCopy = {
      "quick-race": {
        title: "Quick Race",
        kicker: "Single event",
        description: "Drop straight into a fast arcade race with the selected car.",
      },
      "time-trial": {
        title: "Time Trial",
        kicker: "Ghost run",
        description: "Run clean laps against the clock and chase a better sector rhythm.",
      },
      championship: {
        title: "Championship",
        kicker: "Series mode",
        description: "Race a three-round BMW vs Porsche series with points after every event.",
      },
      options: {
        title: "Options",
        kicker: "Garage setup",
        description: "Placeholder options bay for camera distance, audio, assists, and display tuning.",
      },
    };

    this.#buildPreviewScene();
    this.#bindEvents();
    this.#renderTeams();
    this.#renderVehicles();
    this.#selectVehicle(this.selectedVehicle.id);
    this.#showScreen("main");
    this.#setSelectedIndex(0);
    this.isReady = true;
    this.#animatePreview();
  }

  hide() {
    this.menu.classList.add("is-hidden");
  }

  #bindEvents() {
    this.menu.querySelectorAll("[data-menu-action]").forEach((button) => {
      button.addEventListener("click", () => this.#handleMenuAction(button.dataset.menuAction));
    });

    this.backButtons.forEach((button) => {
      button.addEventListener("click", () => this.#showScreen(button.dataset.menuBack));
    });

    this.startButton.addEventListener("click", () => {
      this.onMenuSound?.("confirm");
      this.hide();
      this.onStart({
        team: this.selectedTeam,
        vehicle: this.selectedVehicle,
        mode: this.selectedMode,
      });
    });

    this.menu.addEventListener("mouseover", (event) => {
      const item = event.target.closest("button");

      if (!item || !this.menu.contains(item)) {
        return;
      }

      const items = this.#getCurrentNavigableItems();
      const index = items.indexOf(item);

      if (index >= 0) {
        this.#setSelectedIndex(index);
      }
    });

    Object.entries(this.optionInputs).forEach(([key, input]) => {
      input.addEventListener("input", () => {
        const value = input.type === "checkbox" ? input.checked : input.value;
        this.onOptionsChange?.(key, value);
      });
    });

    window.addEventListener("keydown", (event) => this.#handleKeyboardNavigation(event));
    window.addEventListener("resize", () => this.#resizePreview());
  }

  #renderTeams() {
    this.teamGrid.innerHTML = "";

    for (const team of TEAMS) {
      const button = document.createElement("button");
      button.className = "menu-card team-card";
      button.type = "button";
      button.dataset.teamId = team.id;
      button.innerHTML = `
        <span class="menu-card__eyebrow">${team.theme}</span>
        <strong>${team.name}</strong>
        <span>${team.vehicles.length} vehicles</span>
      `;
      button.addEventListener("click", () => {
        this.onMenuSound?.("confirm");
        this.selectedTeam = team;
        this.selectedVehicle = team.vehicles[0];
        this.#renderVehicles();
        this.#selectVehicle(this.selectedVehicle.id);
        this.#showScreen("vehicle");
      });
      this.teamGrid.append(button);
    }
  }

  #renderVehicles() {
    this.vehicleGrid.innerHTML = "";

    for (const vehicle of this.selectedTeam.vehicles) {
      const button = document.createElement("button");
      button.className = "menu-card vehicle-card";
      button.type = "button";
      button.dataset.vehicleId = vehicle.id;
      button.innerHTML = `
        <span class="vehicle-card__swatch" style="--vehicle-color: #${vehicle.bodyColor
          .toString(16)
          .padStart(6, "0")}"></span>
        <strong>${vehicle.name}</strong>
        <span>${vehicle.className}</span>
      `;
      button.addEventListener("click", () => {
        this.onMenuSound?.("confirm");
        this.#selectVehicle(vehicle.id);
      });
      this.vehicleGrid.append(button);
    }
  }

  #selectVehicle(vehicleId) {
    const vehicle = this.selectedTeam.vehicles.find((candidate) => candidate.id === vehicleId);

    if (!vehicle) {
      return;
    }

    this.selectedVehicle = vehicle;
    this.vehicleTitle.textContent = vehicle.name;
    this.vehicleDescription.textContent = vehicle.description;

    this.vehicleGrid.querySelectorAll("[data-vehicle-id]").forEach((button) => {
      button.classList.toggle("is-selected", button.dataset.vehicleId === vehicle.id);
    });

    this.#setPreviewVehicle(vehicle);
  }

  #handleMenuAction(action) {
    if (action === "start") {
      if (this.currentScreenName === "main") {
        this.selectedMode = "quick-race";
      }
      this.onMenuSound?.("confirm");
      this.#showScreen("team");
      return;
    }

    const mode = this.modeCopy[action];

    if (!mode) {
      return;
    }

    this.modeTitle.textContent = mode.title;
    this.modeKicker.textContent = mode.kicker;
    this.modeDescription.textContent = mode.description;
    this.optionsPanel.classList.toggle("is-hidden", action !== "options");
    this.selectedMode = action;
    this.#showScreen("mode");
    this.onMenuSound?.("confirm");
  }

  #showScreen(screenName) {
    this.currentScreenName = screenName;

    for (const screen of [this.mainScreen, this.modeScreen, this.teamScreen, this.vehicleScreen]) {
      screen.classList.toggle("is-active", screen.dataset.menuScreen === screenName);
    }

    const items = this.#getCurrentNavigableItems();
    const defaultIndex = screenName === "main" ? 0 : Math.min(1, Math.max(items.length - 1, 0));
    this.#setSelectedIndex(this.selectedIndexByScreen.get(screenName) ?? defaultIndex);
  }

  #buildPreviewScene() {
    this.previewRenderer = new THREE.WebGLRenderer({
      canvas: this.previewCanvas,
      antialias: true,
      alpha: true,
    });
    this.previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.previewRenderer.outputColorSpace = THREE.SRGBColorSpace;

    this.previewScene = new THREE.Scene();
    this.previewCamera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
    this.previewCamera.position.set(0, 4.2, 13);
    this.previewCamera.lookAt(0, 1, 0);

    const key = new THREE.DirectionalLight(0xffffff, 3);
    key.position.set(4, 7, 8);
    this.previewScene.add(key);
    this.previewScene.add(new THREE.HemisphereLight(0xb9d8ff, 0x1d2230, 2));

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(7, 48),
      new THREE.MeshStandardMaterial({ color: 0x1c232c, roughness: 0.72 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.previewScene.add(floor);

    this.#resizePreview();
  }

  #setPreviewVehicle(vehicle) {
    if (this.previewCar) {
      this.previewScene.remove(this.previewCar.group);
    }

    this.previewCar = new Car({
      name: vehicle.shortName,
      ...vehicle,
      name: vehicle.shortName,
      startPosition: new THREE.Vector3(0, 0, 0),
      startRotation: -0.45,
    });
    this.previewCar.group.scale.setScalar(0.82);
    this.previewScene.add(this.previewCar.group);
  }

  #animatePreview() {
    requestAnimationFrame(() => this.#animatePreview());

    const deltaTime = Math.min(this.previewClock.getDelta(), 0.033);

    if (this.previewCar) {
      this.previewCar.group.rotation.y += deltaTime * 0.65;
      this.previewCar.animateWheels(deltaTime, 12);
    }

    this.previewRenderer.render(this.previewScene, this.previewCamera);
  }

  #resizePreview() {
    const bounds = this.previewCanvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));

    this.previewRenderer.setSize(width, height, false);
    this.previewCamera.aspect = width / height;
    this.previewCamera.updateProjectionMatrix();
  }

  #handleKeyboardNavigation(event) {
    if (this.menu.classList.contains("is-hidden")) {
      return;
    }

    if (["ArrowDown", "KeyS", "ArrowRight", "KeyD"].includes(event.code)) {
      event.preventDefault();
      this.#moveSelection(1);
      return;
    }

    if (["ArrowUp", "KeyW", "ArrowLeft", "KeyA"].includes(event.code)) {
      event.preventDefault();
      this.#moveSelection(-1);
      return;
    }

    if (["Enter", "NumpadEnter", "Space"].includes(event.code)) {
      event.preventDefault();
      const item = this.#getCurrentNavigableItems()[this.selectedIndexByScreen.get(this.currentScreenName) ?? 0];
      item?.click();
      return;
    }

    if (event.code === "Escape") {
      event.preventDefault();
      this.#goBack();
    }
  }

  #moveSelection(direction) {
    const items = this.#getCurrentNavigableItems();

    if (!items.length) {
      return;
    }

    const current = this.selectedIndexByScreen.get(this.currentScreenName) ?? 0;
    const next = (current + direction + items.length) % items.length;
    this.#setSelectedIndex(next);
    this.onMenuSound?.("move");
  }

  #setSelectedIndex(index) {
    const items = this.#getCurrentNavigableItems();

    if (!items.length) {
      return;
    }

    const boundedIndex = THREE.MathUtils.clamp(index, 0, items.length - 1);
    this.selectedIndexByScreen.set(this.currentScreenName, boundedIndex);

    items.forEach((item, itemIndex) => {
      item.classList.toggle("is-focused", itemIndex === boundedIndex);
      item.tabIndex = itemIndex === boundedIndex ? 0 : -1;
    });

    items[boundedIndex].focus({ preventScroll: true });
  }

  #getCurrentNavigableItems() {
    const activeScreen = this.menu.querySelector(".menu__screen.is-active");

    if (!activeScreen) {
      return [];
    }

    return [...activeScreen.querySelectorAll("button:not([disabled])")].filter((button) => {
      return button.offsetParent !== null;
    });
  }

  #goBack() {
    if (this.currentScreenName === "main") {
      return;
    }

    if (this.currentScreenName === "vehicle") {
      this.#showScreen("team");
      return;
    }

    this.#showScreen("main");
  }
}
