import * as THREE from "three";
import { Car } from "./Car.js";
import { Track, TRACK_OPTIONS } from "./Track.js";
import { CameraController } from "./CameraController.js";
import { InputManager } from "./InputManager.js";
import { HUD } from "./HUD.js";
import { MenuController } from "./MenuController.js";
import { TEAMS } from "./VehicleCatalog.js";
import { AIController } from "./AIController.js";
import { ChampionshipManager } from "./ChampionshipManager.js";
import { AudioManager } from "./AudioManager.js";
import { applyRendererPolish, buildAtmosphere } from "./VisualPolish.js";

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

applyRendererPolish(renderer);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0xb9ddff);

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
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -220;
sun.shadow.camera.right = 220;
sun.shadow.camera.top = 220;
sun.shadow.camera.bottom = -220;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 420;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xd8edff, 0x5b6648, 1.7));

let track = null;
let atmosphere = null;

let player = null;
let cameraController = null;
let raceStarted = false;
let aiRacers = [];

const input = new InputManager();
const hud = new HUD();
const audio = new AudioManager();
const clock = new THREE.Clock();
const championship = new ChampionshipManager();
let menu = null;
const championshipOverlay = document.querySelector("#championship-overlay");
const championshipKicker = document.querySelector("#championship-kicker");
const championshipTitle = document.querySelector("#championship-title");
const championshipSummary = document.querySelector("#championship-summary");
const championshipStandings = document.querySelector("#championship-standings");
const championshipContinue = document.querySelector("#championship-continue");
const trophyCeremony = document.querySelector("#trophy-ceremony");
const championName = document.querySelector("#champion-name");
const pauseMenu = document.querySelector("#pause-menu");
const pauseResume = document.querySelector("#pause-resume");
const pauseHome = document.querySelector("#pause-home");
const pauseChangeCar = document.querySelector("#pause-change-car");
const pauseSettings = document.querySelector("#pause-settings");
const pauseTrackSelect = document.querySelector("#pause-track-select");

let elapsedRaceTime = 0;
let menuCameraTime = 0;
let lapState = null;
let activeMode = "quick-race";
let playerVehicle = null;
let raceFinished = false;
let paused = false;
let selectedTrackId = "alpine-pass";
let raceCountdownRemaining = 0;

setActiveTrack(selectedTrackId);
lapState = track.createLapState();

menu = new MenuController({
  onStart: ({ vehicle, mode, trackId }) => startRace(vehicle, mode, trackId),
  onMenuSound: (type) => {
    audio.resume();
    if (type === "confirm") {
      audio.playMenuConfirm();
    } else {
      audio.playMenuMove();
    }
  },
  onOptionsChange: (key, value) => {
    audio.resume();
    if (key === "muted") {
      audio.setMuted(value);
    } else {
      audio.setVolume(key, value);
    }
  },
  onTrackChange: (trackId) => {
    selectedTrackId = trackId;
    if (!raceStarted) {
      setActiveTrack(trackId);
    }
  },
});
menu.setTrack(selectedTrackId);

populatePauseTrackSelect();
bindPauseMenu();

function setActiveTrack(trackId, { resetExistingRace = false } = {}) {
  if (track?.id === trackId && !resetExistingRace) {
    return;
  }

  if (track) {
    scene.remove(track.group);
  }

  if (atmosphere) {
    scene.remove(atmosphere);
  }

  track = new Track(trackId);
  selectedTrackId = track.id;
  scene.add(track.group);
  scene.background = new THREE.Color(track.backgroundColor ?? 0x8fb7dc);
  scene.fog = new THREE.Fog(track.fogColor ?? 0x8fb7dc, track.fogNear ?? 120, track.fogFar ?? 620);
  atmosphere = buildAtmosphere(scene, track);

  if (pauseTrackSelect) {
    pauseTrackSelect.value = track.id;
  }

  menu?.setTrack(track.id);

  if (player && resetExistingRace) {
    if (playerVehicle) {
      createAiRacers(playerVehicle.id, activeMode);
    }
    cameraController = new CameraController(camera, player.group, {
      collisionObjects: track.cameraCollisionObjects,
    });
    resetRace();
  }
}

function resetRace() {
  if (!player || !cameraController) {
    return;
  }

  player.reset(track.startPosition.clone(), track.startRotation);
  resetAiRacers();
  elapsedRaceTime = 0;
  lapState = track.createLapState(activeMode === "practice" ? 0 : track.totalLaps);
  raceFinished = false;
  raceCountdownRemaining = activeMode === "practice" ? 0 : 2.1;
  cameraController.snapToTarget();
}

function startRace(vehicle, mode = activeMode, trackId = selectedTrackId) {
  audio.resume();
  if (mode !== "practice") {
    audio.playCountdown();
  }
  activeMode = mode;
  playerVehicle = vehicle;
  setPaused(false);
  setActiveTrack(trackId);

  if (player) {
    scene.remove(player.group);
  }

  player = new Car({
    ...vehicle,
    name: vehicle.shortName,
    startPosition: track.startPosition.clone(),
    startRotation: track.startRotation,
    isPlayer: true,
  });
  scene.add(player.group);
  createAiRacers(vehicle.id, activeMode);

  if (activeMode === "championship") {
    championship.start(["Player", ...aiRacers.map((racer) => racer.car.name)]);
  } else {
    championship.stop();
  }

  cameraController = new CameraController(camera, player.group, {
    collisionObjects: track.cameraCollisionObjects,
  });

  raceStarted = true;
  document.querySelector("#hud").classList.remove("is-hidden");
  resetRace();
}

function createAiRacers(playerVehicleId, mode = activeMode) {
  for (const racer of aiRacers) {
    scene.remove(racer.car.group);
  }

  if (mode === "practice") {
    aiRacers = [];
    return;
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

  if (activeMode !== "practice" && lapState.finished && !raceFinished) {
    finishRace();
  }
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

  if (paused) {
    renderer.render(scene, camera);
    return;
  }

  if (controls.resetPressed) {
    resetRace();
    input.consumeReset();
  }

  if (raceCountdownRemaining > 0) {
    raceCountdownRemaining = Math.max(0, raceCountdownRemaining - deltaTime);
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
      time: 0,
      rpm: calculateRpm(player),
      position: calculateRacePosition(),
      totalRacers: 1 + aiRacers.length,
      track,
      playerPosition: player.group.position,
      rivalPositions: aiRacers.map((racer) => racer.car.group.position),
      checkpointName: "Get Ready",
    });
    renderer.render(scene, camera);
    return;
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
    totalRacers: 1 + aiRacers.length,
    track,
    playerPosition: player.group.position,
    rivalPositions: aiRacers.map((racer) => racer.car.group.position),
    checkpointName: lapState.lastCheckpointName,
  });
  audio.update({
    player,
    camera,
    controls,
    aiRacers,
  });

  renderer.render(scene, camera);
}

function finishRace() {
  raceFinished = true;
  raceStarted = false;
  document.querySelector("#hud").classList.add("is-hidden");

  if (activeMode === "championship") {
    const snapshot = championship.recordRace(getRaceResults());
    showChampionshipResults(snapshot);
    return;
  }

  showSingleRaceResults();
}

function getRaceResults() {
  const racers = [
    {
      name: "Player",
      score: (lapState.currentLap - 1) + track.getProgressAtPosition(player.group.position, player.trackProgress),
    },
    ...aiRacers.map((racer) => ({
      name: racer.car.name,
      score: racer.controller.getProgressScore(racer.lapState),
    })),
  ];

  return racers.sort((a, b) => b.score - a.score);
}

function showChampionshipResults(snapshot) {
  championshipOverlay.classList.remove("is-hidden");
  trophyCeremony.classList.toggle("is-hidden", !snapshot.isFinalRace);
  championshipKicker.textContent = snapshot.isFinalRace ? "Trophy Ceremony" : "Championship Standings";
  championshipTitle.textContent = snapshot.isFinalRace ? "Series Complete" : `Race ${snapshot.raceNumber} Results`;
  championshipSummary.textContent = `${snapshot.raceName} complete. Points awarded: 10, 8, 6, 4, 2, 1.`;
  championshipContinue.textContent = snapshot.isFinalRace ? "Main Menu" : "Next Race";
  championName.textContent = snapshot.champion?.name ?? "Champion";
  renderStandings(snapshot.standings);

  championshipContinue.onclick = () => {
    championshipOverlay.classList.add("is-hidden");

    if (snapshot.isFinalRace) {
      showMainMenu();
      return;
    }

    championship.advanceRace();
    startNextChampionshipRace();
  };
}

function showSingleRaceResults() {
  const results = getRaceResults().map((result, index) => ({
    ...result,
    rank: index + 1,
    lastPosition: index + 1,
    points: [10, 8, 6, 4, 2, 1][index],
  }));

  championshipOverlay.classList.remove("is-hidden");
  trophyCeremony.classList.add("is-hidden");
  championshipKicker.textContent = "Race Complete";
  championshipTitle.textContent = "Results";
  championshipSummary.textContent = "Final order for this event.";
  championshipContinue.textContent = "Main Menu";
  renderStandings(results);
  championshipContinue.onclick = () => {
    championshipOverlay.classList.add("is-hidden");
    showMainMenu();
  };
}

function startNextChampionshipRace() {
  raceStarted = true;
  document.querySelector("#hud").classList.remove("is-hidden");
  resetRace();
}

function showMainMenu() {
  raceStarted = false;
  setPaused(false);
  activeMode = "quick-race";
  championship.stop();
  document.querySelector("#hud").classList.add("is-hidden");
  menu.showHome();
}

function renderStandings(standings) {
  championshipStandings.innerHTML = standings
    .map(
      (entry) => `
        <tr>
          <td>${entry.rank}</td>
          <td>${entry.name}</td>
          <td>${entry.lastPosition ?? "-"}</td>
          <td>${entry.points}</td>
        </tr>
      `,
    )
    .join("");
}

function calculateRacePosition() {
  const playerScore =
    (lapState.currentLap - 1) + track.getProgressAtPosition(player.group.position, player.trackProgress);
  const aheadCount = aiRacers.filter((racer) => {
    const aiScore = racer.controller.getProgressScore(racer.lapState);
    return aiScore > playerScore;
  }).length;

  return aheadCount + 1;
}

function populatePauseTrackSelect() {
  pauseTrackSelect.innerHTML = "";
  for (const option of TRACK_OPTIONS) {
    const item = document.createElement("option");
    item.value = option.id;
    item.textContent = option.name;
    pauseTrackSelect.append(item);
  }
  pauseTrackSelect.value = selectedTrackId;
}

function bindPauseMenu() {
  pauseResume.addEventListener("click", () => setPaused(false));
  pauseHome.addEventListener("click", () => showMainMenu());
  pauseChangeCar.addEventListener("click", () => {
    raceStarted = false;
    document.querySelector("#hud").classList.add("is-hidden");
    setPaused(false);
    menu.showVehicleSelect();
  });
  pauseSettings.addEventListener("click", () => {
    raceStarted = false;
    document.querySelector("#hud").classList.add("is-hidden");
    setPaused(false);
    menu.showOptions();
  });
  pauseTrackSelect.addEventListener("change", () => {
    selectedTrackId = pauseTrackSelect.value;
    menu.setTrack(selectedTrackId);
    setActiveTrack(selectedTrackId, { resetExistingRace: true });
  });

  window.addEventListener("keydown", (event) => {
    if (event.code !== "Escape" || !raceStarted) {
      return;
    }

    event.preventDefault();
    setPaused(!paused);
  });
}

function setPaused(value) {
  paused = value;
  audio.setPaused(paused);
  pauseMenu.classList.toggle("is-hidden", !paused);
  if (paused) {
    input.clear();
  }
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
