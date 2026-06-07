import * as THREE from "three";
import { Car } from "./Car.js";
import { Track } from "./Track.js";
import { CameraController } from "./CameraController.js";
import { InputManager } from "./InputManager.js";
import { HUD } from "./HUD.js";
import { MenuController } from "./MenuController.js";
import { TEAMS } from "./VehicleCatalog.js";

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

const rival = new Car({
  ...TEAMS[1].vehicles[0],
  name: "Rival",
  startPosition: new THREE.Vector3(5, 0, 2),
  startRotation: 0,
  isPlayer: false,
});
scene.add(rival.group);

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
  rival.reset(track.getPointOnCenterLine(0.05), track.startRotation);
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

  cameraController = new CameraController(camera, player.group, {
    collisionObjects: track.cameraCollisionObjects,
  });

  raceStarted = true;
  document.querySelector("#hud").classList.remove("is-hidden");
  resetRace();
}

function updateRaceProgress(deltaTime) {
  elapsedRaceTime += deltaTime;
  track.updateLapProgress(player.group.position, lapState);
}

function updateRival(deltaTime) {
  // The placeholder rival follows the center of the test oval. It proves the
  // multi-car structure without pretending to be finished racing AI.
  const pathPoint = track.getPointOnCenterLine((elapsedRaceTime * 0.055) % 1);
  const nextPathPoint = track.getPointOnCenterLine((elapsedRaceTime * 0.055 + 0.01) % 1);
  const heading = Math.atan2(nextPathPoint.x - pathPoint.x, nextPathPoint.z - pathPoint.z);

  rival.group.position.lerp(pathPoint, 0.12);
  rival.group.rotation.y = heading;
  rival.animateWheels(deltaTime, 32);
}

function animate() {
  requestAnimationFrame(animate);

  const deltaTime = Math.min(clock.getDelta(), 0.033);
  const controls = input.getControls();

  if (!raceStarted) {
    elapsedRaceTime += deltaTime;
    menuCameraTime += deltaTime;
    updateMenuCamera(menuCameraTime);
    updateRival(deltaTime);
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
  const racePosition = 1;
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
    rivalPositions: [rival.group.position],
    checkpointName: lapState.lastCheckpointName,
  });

  renderer.render(scene, camera);
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
