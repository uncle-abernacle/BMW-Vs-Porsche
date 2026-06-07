import * as THREE from "three";
import { Car } from "./Car.js";
import { Track } from "./Track.js";
import { CameraController } from "./CameraController.js";
import { InputManager } from "./InputManager.js";
import { HUD } from "./HUD.js";
import { MenuController } from "./MenuController.js";
import { TEAMS } from "./VehicleCatalog.js";
import { AIController } from "./AIController.js";

// The main module owns browser setup, scene wiring, and the frame loop.
// Gameplay objects live in their own files so the project can grow without
// turning this entry point into a pileup.
const canvas = document.querySelector("#game-canvas");
const loading = document.querySelector("#loading");

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fb7dc);
scene.fog = new THREE.Fog(0x8fb7dc, 120, 620);

const camera = new THREE.PerspectiveCamera(
  62,
  window.innerWidth / window.innerHeight,
  0.1,
  1200,
);

// A bright key light plus low ambient fill gives the cars readable PS2-era
// arcade shapes while keeping the setup simple and GitHub Pages friendly.
const sun = new THREE.DirectionalLight(0xfff2ce, 3.1);
sun.position.set(-80, 120, 70);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -180;
sun.shadow.camera.right = 180;
sun.shadow.camera.top = 180;
sun.shadow.camera.bottom = -180;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 420;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x36402c, 1.55));

const track = new Track();
scene.add(track.group);
scene.background = new THREE.Color(track.backgroundColor ?? 0x8fb7dc);
scene.fog = new THREE.Fog(track.fogColor ?? 0x8fb7dc, track.fogNear ?? 120, track.fogFar ?? 620);

let player = null;
let cameraController = null;
let raceStarted = false;
let aiRacers = [];

const input = new InputManager();
const hud = new HUD();
const clock = new THREE.Clock();
const menu = new MenuController({
  onStart: ({ vehicle }) => startRace(vehicle),
});

let elapsedRaceTime = 0;
let menuCameraTime = 0;
let lapState = track.createLapState();

function resetRace() {
  if (!player || !cameraController) {
    return;
  }

  player.reset(track.startPosition.clone(), track.startRotation);
  resetAiRacers();
  elapsedRaceTime = 0;
  lapState = track.createLapState();
  cameraController.snapToTarget();
}

function startRace(vehicle) {
  if (player) {
    scene.remove(player.group);
  }

  player = new Car({
    ...vehicle,
    name: vehicle.shortName,
    startPosition: new THREE.Vector3(-5, 0, 12),
    startRotation: 0,
    isPlayer: true,
  });
  scene.add(player.group);
  createAiRacers(vehicle.id);

  cameraController = new CameraController(camera, player.group, {
    collisionObjects: track.cameraCollisionObjects,
  });

  raceStarted = true;
  document.querySelector("#hud").classList.remove("is-hidden");
  resetRace();
}

function createAiRacers(playerVehicleId) {
  for (const racer of aiRacers) {
    scene.remove(racer.car.group);
  }

  const allVehicles = TEAMS.flatMap((team) => team.vehicles);
  const opponentVehicles = allVehicles
    .filter((candidate) => candidate.id !== playerVehicleId)
    .slice(0, 5);
  const difficulties = ["Easy", "Medium", "Medium", "Hard", "Hard"];

  aiRacers = opponentVehicles.map((vehicle, index) => {
    const car = new Car({
      ...vehicle,
      name: vehicle.shortName,
      startPosition: track.getPointOnCenterLine(0.02 + index * 0.006),
      startRotation: track.startRotation,
      isPlayer: false,
    });
    car.maxForwardSpeed = 48 + index * 1.6;
    scene.add(car.group);

    const controller = new AIController(car, track, {
      difficulty: difficulties[index],
      laneOffset: index % 2 === 0 ? 4.5 : -4.5,
      startProgress: 0.018 + index * 0.007,
    });

    return {
      car,
      controller,
      lapState: track.createLapState(),
      difficulty: difficulties[index],
    };
  });

  resetAiRacers();
}

function resetAiRacers() {
  aiRacers.forEach((racer, index) => {
    racer.lapState = track.createLapState();
    racer.controller.reset(0.018 + index * 0.008, index % 2 === 0 ? 4.5 : -4.5);
  });
}

function updateRaceProgress(deltaTime) {
  elapsedRaceTime += deltaTime;
  track.updateLapProgress(player.group.position, lapState);
}

function updateRival(deltaTime) {
  const allCars = [player, ...aiRacers.map((racer) => racer.car)].filter(Boolean);

  for (const racer of aiRacers) {
    const nearbyCars = allCars.filter((car) => car !== racer.car);
    racer.controller.update(deltaTime, nearbyCars);
    track.updateLapProgress(racer.car.group.position, racer.lapState);
  }
}

function animate() {
  requestAnimationFrame(animate);

  const deltaTime = Math.min(clock.getDelta(), 0.033);
  const controls = input.getControls();

  if (!raceStarted) {
    elapsedRaceTime += deltaTime;
    menuCameraTime += deltaTime;
    updateMenuCamera(menuCameraTime);
    renderer.render(scene, camera);
    return;
  }

  if (controls.resetPressed) {
    resetRace();
    input.consumeReset();
  }

  player.update(deltaTime, controls, track);
  updateRival(deltaTime);
  updateRaceProgress(deltaTime);
  const racePosition = calculateRacePosition();
  cameraController.update(deltaTime, {
    speed: player.speed,
    steering: player.steerAmount,
    drift: player.driftAmount,
  });
  hud.update({
    speed: player.getDisplaySpeed(),
    gear: player.getGearLabel(),
    lap: lapState.currentLap,
    totalLaps: lapState.totalLaps,
    time: elapsedRaceTime,
    rpm: calculateRpm(player),
    position: racePosition,
    totalRacers: 6,
    track,
    playerPosition: player.group.position,
    rivalPositions: aiRacers.map((racer) => racer.car.group.position),
    checkpointName: lapState.lastCheckpointName,
  });

  renderer.render(scene, camera);
}

function calculateRacePosition() {
  const playerScore = (lapState.currentLap - 1) + track.getProgressAtPosition(player.group.position);
  const aheadCount = aiRacers.filter((racer) => {
    const aiScore = racer.controller.getProgressScore(racer.lapState);
    return aiScore > playerScore;
  }).length;

  return aheadCount + 1;
}

function calculateRpm(car) {
  const speedRatio = Math.min(Math.abs(car.speed) / car.maxForwardSpeed, 1);
  const gear = car.getGearLabel();
  const gearOffset = gear === "N" || gear === "R" ? 0 : Number(gear) * 420;
  const pulse = Math.sin(elapsedRaceTime * 18) * 140;

  return Math.round(850 + speedRatio * 6500 + gearOffset + pulse);
}

function updateMenuCamera(time) {
  const orbitRadius = 132;
  const angle = time * 0.12;
  const height = 42 + Math.sin(time * 0.35) * 8;
  const focus = new THREE.Vector3(Math.sin(time * 0.18) * 16, 0, Math.cos(time * 0.16) * 22);

  camera.position.set(Math.sin(angle) * orbitRadius, height, Math.cos(angle) * orbitRadius);
  camera.lookAt(focus);
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

window.addEventListener("resize", resize);

loading.classList.add("is-hidden");
animate();
