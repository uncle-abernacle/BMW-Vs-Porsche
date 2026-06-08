import * as THREE from "three";

export const TRACK_OPTIONS = [
  {
    id: "german-countryside",
    name: "German Countryside Circuit",
    roadWidth: 18,
    samples: 520,
    scenery: "countryside",
    backgroundColor: 0xbfe3ff,
    skyColor: 0xcdeeff,
    fogColor: 0xc9dfd7,
    fogNear: 95,
    fogFar: 560,
    controlPoints: [
      [-120, 0, 138],
      [70, 0, 126],
      [190, 0, 38],
      [174, 0, -86],
      [72, 0, -142],
      [-98, 0, -132],
      [-190, 0, -38],
      [-176, 0, 88],
    ],
  },
  {
    id: "autobahn-sprint",
    name: "Autobahn Sprint",
    roadWidth: 26,
    samples: 540,
    scenery: "autobahn",
    backgroundColor: 0xb8dcff,
    skyColor: 0xc9eaff,
    fogColor: 0xbfd7e6,
    fogNear: 130,
    fogFar: 650,
    controlPoints: [
      [-245, 0, 96],
      [-84, 0, 116],
      [182, 0, 112],
      [282, 0, 28],
      [240, 0, -72],
      [40, 0, -102],
      [-190, 0, -88],
      [-286, 0, 4],
    ],
  },
  {
    id: "alpine-pass",
    name: "Alpine Pass",
    roadWidth: 15,
    samples: 540,
    scenery: "alpine",
    backgroundColor: 0xb9ddff,
    skyColor: 0xc7e6ff,
    fogColor: 0xc5d8df,
    fogNear: 62,
    fogFar: 345,
    controlPoints: [
      [-18, 0, 132],
      [-12, 0, 42],
      [70, 0, -38],
      [28, 0, -118],
      [-82, 0, -92],
      [-142, 0, -10],
      [-92, 0, 72],
      [44, 0, 92],
      [142, 0, 36],
      [124, 0, -78],
      [24, 0, -168],
      [-126, 0, -154],
      [-210, 0, -46],
      [-164, 0, 104],
      [-62, 0, 172],
    ],
  },
];

function getTrackDefinition(trackId = "alpine-pass") {
  return TRACK_OPTIONS.find((track) => track.id === trackId) ?? TRACK_OPTIONS[2];
}

// Track builds low-poly arcade circuits from a small definition. It owns road
// geometry, surface height, scenery placement, checkpoints, and lap logic.
export class Track {
  constructor(trackId = "alpine-pass") {
    this.definition = getTrackDefinition(trackId);
    this.id = this.definition.id;
    this.name = this.definition.name;
    this.group = new THREE.Group();
    this.group.name = this.name;
    this.cameraCollisionObjects = [];
    this.roadWidth = this.definition.roadWidth;
    this.samples = this.definition.samples;
    this.totalLaps = 3;
    this.checkpointRadius = 36;
    this.roadSurfaceOffset = 0.08;
    this.backgroundColor = this.definition.backgroundColor;
    this.skyColor = this.definition.skyColor;
    this.fogColor = this.definition.fogColor;
    this.fogNear = this.definition.fogNear;
    this.fogFar = this.definition.fogFar;
    this.controlPoints = this.definition.controlPoints.map(([x, y, z]) => new THREE.Vector3(x, y, z));

    this.curve = new THREE.CatmullRomCurve3(this.controlPoints, true, "catmullrom", 0.7);
    this.centerLinePoints = this.#sampleCenterLine();
    this.checkpoints = this.#createCheckpoints();
    this.startPosition = this.#offsetPoint(0, -4).add(new THREE.Vector3(0, this.roadSurfaceOffset, 0));
    this.startRotation = this.#getHeadingAt(0);

    this.#buildTerrain();
    this.#buildRoad();
    this.#buildRoadDetails();
    this.#buildMountains();
    this.#buildTunnels();
    this.#buildCliffsAndOverlooks();
    this.#buildAlpineScenery();
    this.#buildCheckpointGates();
  }

  getPointOnCenterLine(t) {
    const wrapped = THREE.MathUtils.euclideanModulo(t, 1);
    const point = this.curve.getPointAt(wrapped);
    point.y = this.#heightAt(wrapped) + 0.12;
    return point;
  }

  createLapState(totalLaps = this.totalLaps) {
    return {
      currentLap: 1,
      totalLaps,
      nextCheckpoint: 1,
      checkpointsPassed: 0,
      passedCheckpoints: new Set(),
      lastProgress: 0,
      finished: false,
      lastCheckpointName: "Start",
    };
  }

  updateLapProgress(position, lapState) {
    if (lapState.finished) {
      return lapState;
    }

    const progress = this.getProgressAtPosition(position, lapState.lastProgress);
    const checkpoint = this.checkpoints[lapState.nextCheckpoint];

    if (checkpoint && this.#flatDistance(position, checkpoint.position) <= checkpoint.radius) {
      lapState.lastCheckpointName = checkpoint.name;
      lapState.nextCheckpoint = (lapState.nextCheckpoint + 1) % this.checkpoints.length;

      if (checkpoint.id > 0) {
        lapState.passedCheckpoints?.add(checkpoint.id);
        lapState.checkpointsPassed = lapState.passedCheckpoints?.size ?? lapState.checkpointsPassed + 1;
      }
    }

    const crossedStartLine = lapState.lastProgress > 0.82 && progress < 0.18;
    const clearedLapGates = (lapState.passedCheckpoints?.size ?? 0) >= this.checkpoints.length - 1;

    if (crossedStartLine && clearedLapGates) {
      lapState.currentLap += 1;
      if (lapState.totalLaps > 0) {
        lapState.finished = lapState.currentLap > lapState.totalLaps;
        lapState.currentLap = Math.min(lapState.currentLap, lapState.totalLaps);
      }
      lapState.nextCheckpoint = 1;
      lapState.checkpointsPassed = 0;
      lapState.passedCheckpoints = new Set();
      lapState.lastCheckpointName = "Start / Finish";
    }

    lapState.lastProgress = progress;
    return lapState;
  }

  getSurfaceCorrection(position, previousProgress = null, vehicleHalfWidth = 0) {
    const nearestInfo = this.#nearestTrackInfo(position, previousProgress);
    const offset = new THREE.Vector3(position.x - nearestInfo.point.x, 0, position.z - nearestInfo.point.z);
    const distanceFromRoad = offset.length() + vehicleHalfWidth - this.roadWidth * 0.5;

    if (distanceFromRoad <= 0) {
      return null;
    }

    const direction = nearestInfo.point
      .clone()
      .sub(new THREE.Vector3(position.x, nearestInfo.point.y, position.z))
      .normalize();

    return {
      direction,
      strength: Math.min(distanceFromRoad * 0.055, 1.05),
      speedMultiplier: distanceFromRoad > 12 ? 0.958 : 0.978,
      progress: nearestInfo.t,
    };
  }

  getProgressAtPosition(position, previousProgress = null) {
    return this.#nearestTrackInfo(position, previousProgress).t;
  }

  getRoadHeightAtPosition(position, previousProgress = null) {
    return this.#heightAt(this.#nearestTrackInfo(position, previousProgress).t) + 0.12 + this.roadSurfaceOffset;
  }

  getRoadSurfaceAtPosition(position, previousProgress = null) {
    const nearest = this.#nearestTrackInfo(position, previousProgress);
    const step = 1 / this.samples;
    const ahead = this.getPointOnCenterLine(nearest.t + step);
    const behind = this.getPointOnCenterLine(nearest.t - step);
    const tangent = ahead.sub(behind).normalize();
    const horizontalLength = Math.max(Math.hypot(tangent.x, tangent.z), 0.001);

    return {
      height: this.#heightAt(nearest.t) + 0.12 + this.roadSurfaceOffset,
      pitch: Math.atan2(tangent.y, horizontalLength),
      roll: 0,
      progress: nearest.t,
      point: nearest.point,
    };
  }

  #heightAt(t) {
    if (this.definition.scenery === "autobahn") {
      return Math.sin(t * Math.PI * 2) * 2.2 + Math.cos(t * Math.PI * 4) * 1.2;
    }

    if (this.definition.scenery === "countryside") {
      return Math.sin(t * Math.PI * 2) * 5 + Math.sin(t * Math.PI * 8 + 0.5) * 2.8;
    }

    return (
      Math.sin(t * Math.PI * 2) * 10 +
      Math.sin(t * Math.PI * 6 + 0.8) * 5 +
      Math.cos(t * Math.PI * 10) * 2
    );
  }

  #sampleCenterLine() {
    const points = [];

    for (let i = 0; i < this.samples; i += 1) {
      points.push(this.getPointOnCenterLine(i / this.samples));
    }

    return points;
  }

  #createCheckpoints() {
    return [0, 0.12, 0.25, 0.38, 0.51, 0.65, 0.78, 0.9].map((t, index) => ({
      id: index,
      name: index === 0 ? "Start / Finish" : `Hairpin Gate ${index}`,
      t,
      position: this.getPointOnCenterLine(t),
      heading: this.#getHeadingAt(t),
      radius: index === 0 ? 44 : this.checkpointRadius,
    }));
  }

  #buildTerrain() {
    const geometry = new THREE.PlaneGeometry(620, 620, 34, 34);
    const positions = geometry.attributes.position;

    for (let i = 0; i < positions.count; i += 1) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const ridge =
        Math.sin(x * 0.018) * 16 +
        Math.cos(y * 0.016) * 14 +
        Math.sin((x - y) * 0.012) * 9;
      positions.setZ(i, ridge - 18);
    }

    geometry.computeVertexNormals();

    const terrain = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: 0x617459,
        emissive: 0x11180d,
        roughness: 0.98,
        flatShading: true,
      }),
    );
    terrain.rotation.x = -Math.PI / 2;
    terrain.position.set(-38, -8, -12);
    terrain.receiveShadow = true;
    this.group.add(terrain);
  }

  #buildRoad() {
    const road = new THREE.Mesh(
      this.#createRoadGeometry(this.roadWidth),
      new THREE.MeshBasicMaterial({
        color: 0x2d3338,
        side: THREE.FrontSide,
        fog: false,
      }),
    );
    road.position.y = this.roadSurfaceOffset;
    road.renderOrder = 4;
    road.receiveShadow = true;
    this.group.add(road);

    const shoulder = new THREE.Mesh(
      this.#createRoadGeometry(this.roadWidth + 4),
      new THREE.MeshBasicMaterial({
        color: 0xbd9560,
        side: THREE.FrontSide,
        fog: false,
      }),
    );
    shoulder.position.y = 0.02;
    shoulder.renderOrder = 3;
    shoulder.receiveShadow = true;
    this.group.add(shoulder);

    const edgeMaterial = new THREE.MeshBasicMaterial({
      color: 0xf3d15c,
      side: THREE.FrontSide,
      fog: false,
    });

    for (const side of [-1, 1]) {
      const edge = new THREE.Mesh(this.#createRoadEdgeGeometry(side), edgeMaterial);
      edge.renderOrder = 5;
      this.group.add(edge);
    }

    this.#buildBridgeSupports();
  }

  #buildBridgeSupports() {
    const supportMaterial = new THREE.MeshStandardMaterial({
      color: 0x6e6b60,
      roughness: 0.9,
      flatShading: true,
    });

    for (let i = 0; i < this.samples; i += 28) {
      const t = i / this.samples;
      const point = this.getPointOnCenterLine(t);
      const roadY = this.getRoadHeightAtPosition(point, t);
      const heading = this.#getHeadingAt(t);
      const next = this.getPointOnCenterLine(t + 0.004);
      const tangent = next.sub(point).normalize();
      const side = new THREE.Vector3(-tangent.z, 0, tangent.x);
      const supportOffset = this.roadWidth * 0.5 + 4.2;
      const leftSupportPoint = point.clone().addScaledVector(side, supportOffset);
      const rightSupportPoint = point.clone().addScaledVector(side, -supportOffset);
      const groundY = Math.min(
        this.#terrainHeightAt(leftSupportPoint.x, leftSupportPoint.z),
        this.#terrainHeightAt(rightSupportPoint.x, rightSupportPoint.z),
      );
      const deckBottomY = roadY - 0.72;
      const drop = deckBottomY - groundY;

      if (drop < 7) {
        continue;
      }

      const deckBeam = new THREE.Mesh(
        new THREE.BoxGeometry(this.roadWidth + 10.5, 0.78, 2.4),
        supportMaterial,
      );
      deckBeam.position.copy(point);
      deckBeam.position.y = deckBottomY;
      deckBeam.rotation.y = heading;
      deckBeam.castShadow = true;
      deckBeam.receiveShadow = true;
      this.group.add(deckBeam);

      for (const sideSign of [-1, 1]) {
        const supportPoint = point.clone().addScaledVector(side, sideSign * supportOffset);
        const supportGroundY = this.#terrainHeightAt(supportPoint.x, supportPoint.z);
        const supportTopY = deckBottomY - 0.38;
        const supportHeight = Math.max(supportTopY - supportGroundY, 1);
        const support = new THREE.Mesh(new THREE.BoxGeometry(1.8, supportHeight, 1.8), supportMaterial);
        support.position.copy(supportPoint);
        support.position.y = supportGroundY + supportHeight * 0.5;
        support.castShadow = true;
        support.receiveShadow = true;
        this.group.add(support);
      }
    }
  }

  #createRoadEdgeGeometry(sideSign) {
    const vertices = [];
    const indices = [];
    const normals = [];
    const edgeWidth = 0.42;
    const edgeOffset = this.roadWidth * 0.5 - edgeWidth * 0.5;

    for (let i = 0; i <= this.samples; i += 1) {
      const t = i / this.samples;
      const point = this.getPointOnCenterLine(t);
      const next = this.getPointOnCenterLine(t + 1 / this.samples);
      const tangent = next.clone().sub(point).normalize();
      const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize().multiplyScalar(sideSign);
      const inner = point.clone().addScaledVector(side, edgeOffset - edgeWidth * 0.5);
      const outer = point.clone().addScaledVector(side, edgeOffset + edgeWidth * 0.5);

      inner.y += this.roadSurfaceOffset + 0.05;
      outer.y += this.roadSurfaceOffset + 0.05;
      vertices.push(inner.x, inner.y, inner.z, outer.x, outer.y, outer.z);
      normals.push(0, 1, 0, 0, 1, 0);

      if (i < this.samples) {
        const base = i * 2;
        indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geometry.setIndex(indices);
    return geometry;
  }

  #createRoadGeometry(width) {
    const vertices = [];
    const indices = [];
    const normals = [];

    for (let i = 0; i <= this.samples; i += 1) {
      const t = i / this.samples;
      const point = this.getPointOnCenterLine(t);
      const next = this.getPointOnCenterLine(t + 1 / this.samples);
      const tangent = next.clone().sub(point).normalize();
      const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      const left = point.clone().addScaledVector(side, width * 0.5);
      const right = point.clone().addScaledVector(side, -width * 0.5);

      vertices.push(left.x, left.y, left.z, right.x, right.y, right.z);
      normals.push(0, 1, 0, 0, 1, 0);

      if (i < this.samples) {
        const base = i * 2;
        indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geometry.setIndex(indices);
    return geometry;
  }

  #buildRoadDetails() {
    const lineMaterial = new THREE.MeshBasicMaterial({
      color: 0xe9d874,
      fog: false,
    });

    for (let i = 0; i < 82; i += 1) {
      const t = i / 82;
      const marker = this.#orientedBox(t, 0, 0.72, 0.06, 5.2, lineMaterial);
      marker.position.y += 0.22;
      marker.renderOrder = 6;
      this.group.add(marker);
    }

    this.#addStartGrid();
  }

  #addStartGrid() {
    const white = new THREE.MeshStandardMaterial({ color: 0xf7f2db, emissive: 0x2b2616, roughness: 0.58 });
    const black = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.58 });

    const gridSpan = this.roadWidth * 0.72;
    const squareWidth = gridSpan / 6;

    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 6; col += 1) {
        const lateral = -gridSpan * 0.5 + squareWidth * (col + 0.5);
        const square = this.#orientedBox(
          0.002,
          lateral,
          squareWidth * 0.9,
          0.045,
          3,
          (row + col) % 2 ? black : white,
        );
        square.position.add(this.#forwardAt(0.002).multiplyScalar(row * 3));
        square.position.y += 0.18;
        this.group.add(square);
      }
    }
  }

  #buildMountains() {
    const rockMaterials = [
      new THREE.MeshStandardMaterial({ color: 0x6d7773, emissive: 0x0d1110, roughness: 1, flatShading: true }),
      new THREE.MeshStandardMaterial({ color: 0x85877b, emissive: 0x12120d, roughness: 1, flatShading: true }),
      new THREE.MeshStandardMaterial({ color: 0x596463, emissive: 0x0c1111, roughness: 1, flatShading: true }),
    ];
    const snowMaterial = new THREE.MeshStandardMaterial({
      color: 0xf0f3ed,
      emissive: 0x202820,
      roughness: 0.9,
      flatShading: true,
    });

    for (let i = 0; i < 20; i += 1) {
      const angle = (i / 20) * Math.PI * 2;
      const radius = 230 + (i % 4) * 28;
      const x = Math.sin(angle) * radius - 36;
      const z = Math.cos(angle) * radius - 12;
      const height = 66 + (i % 5) * 18;
      const mountain = new THREE.Mesh(
        new THREE.ConeGeometry(42 + (i % 3) * 12, height, 6),
        rockMaterials[i % rockMaterials.length],
      );
      const groundY = this.#terrainHeightAt(x, z);
      mountain.position.set(x, groundY + height * 0.34, z);
      mountain.scale.z = 0.72;
      mountain.rotation.y = angle * 0.7;
      mountain.castShadow = false;
      this.group.add(mountain);

      const snow = new THREE.Mesh(new THREE.ConeGeometry(15 + (i % 3) * 4, height * 0.22, 6), snowMaterial);
      snow.position.set(x, groundY + height * 0.72 + 6, z);
      snow.scale.z = 0.72;
      snow.rotation.y = mountain.rotation.y;
      this.group.add(snow);
    }
  }

  #buildTunnels() {
    const tunnelMaterial = new THREE.MeshStandardMaterial({
      color: 0x47443d,
      emissive: 0x0a0907,
      roughness: 0.92,
      flatShading: true,
    });
    const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x10141a, emissive: 0x020304, roughness: 0.95 });

    [0.21, 0.71].forEach((t, index) => {
      const point = this.getPointOnCenterLine(t);
      const heading = this.#getHeadingAt(t);
      const portal = new THREE.Group();
      const side = new THREE.Vector3(Math.cos(heading), 0, -Math.sin(heading));
      const clearOffset = this.roadWidth * 0.5 + 7.5;

      for (const sideSign of [-1, 1]) {
        const columnPoint = point.clone().addScaledVector(side, sideSign * clearOffset);
        const columnGroundY = Math.min(this.#terrainHeightAt(columnPoint.x, columnPoint.z), point.y);
        const columnTopY = point.y + 17;
        const columnHeight = Math.max(columnTopY - columnGroundY, 8);
        const column = new THREE.Mesh(new THREE.BoxGeometry(3.6, columnHeight, 12), tunnelMaterial);
        column.position.copy(columnPoint);
        column.position.y = columnGroundY + columnHeight * 0.5;
        column.rotation.y = heading;
        column.castShadow = true;
        column.receiveShadow = true;
        portal.add(column);
        this.cameraCollisionObjects.push(column);
      }

      const beam = new THREE.Mesh(new THREE.BoxGeometry(this.roadWidth + 20, 4.5, 12), tunnelMaterial);
      beam.position.copy(point);
      beam.position.y += 17.2;
      beam.rotation.y = heading;
      beam.castShadow = true;
      portal.add(beam);

      const shadowPanel = new THREE.Mesh(new THREE.BoxGeometry(this.roadWidth + 8, 2.2, 12.2), darkMaterial);
      shadowPanel.position.copy(point);
      shadowPanel.position.y += 13.7;
      shadowPanel.rotation.y = heading;
      portal.add(shadowPanel);

      const roof = new THREE.Mesh(new THREE.ConeGeometry(26, 24, 6), tunnelMaterial);
      roof.position.copy(point);
      roof.position.y += 20;
      roof.rotation.y = heading;
      roof.scale.z = 0.45;
      roof.castShadow = true;
      portal.add(roof);

      portal.name = `Tunnel ${index + 1}`;
      this.group.add(portal);
    });
  }

  #buildCliffsAndOverlooks() {
    const cliffMaterial = new THREE.MeshStandardMaterial({
      color: 0x646257,
      emissive: 0x0e0d0a,
      roughness: 1,
      flatShading: true,
    });
    const overlookMaterial = new THREE.MeshStandardMaterial({
      color: 0x9b927c,
      emissive: 0x16120a,
      roughness: 0.84,
    });

    for (let i = 0; i < 34; i += 1) {
      const t = i / 34;
      const side = Math.sin(t * Math.PI * 6) > 0 ? 1 : -1;
      const cliffOffset = this.roadWidth * 0.5 + 42 + (i % 4) * 3;
      const cliffHeight = 24 + (i % 5) * 7;
      const cliff = this.#orientedBox(t, side * cliffOffset, 18 + (i % 3) * 5, cliffHeight, 16, cliffMaterial);
      cliff.position.y = this.#terrainHeightAt(cliff.position.x, cliff.position.z) + cliffHeight * 0.5 - 1.2;
      cliff.rotation.y += (i % 3) * 0.2;
      cliff.castShadow = true;
      cliff.receiveShadow = true;
      this.group.add(cliff);
      this.cameraCollisionObjects.push(cliff);
    }

    [0.34, 0.56, 0.86].forEach((t, index) => {
      const side = index % 2 ? -1 : 1;
      const deck = this.#orientedBox(t, side * (this.roadWidth * 0.5 + 34), 24, 1.2, 12, overlookMaterial);
      deck.position.y = this.#terrainHeightAt(deck.position.x, deck.position.z) + 1.2;
      deck.castShadow = true;
      deck.receiveShadow = true;
      this.group.add(deck);

      const rail = this.#orientedBox(t, side * (this.roadWidth * 0.5 + 42), 24, 2, 1.2, overlookMaterial);
      rail.position.y = this.#terrainHeightAt(rail.position.x, rail.position.z) + 3.1;
      rail.castShadow = true;
      this.group.add(rail);
    });
  }

  #buildAlpineScenery() {
    const trunk = new THREE.MeshStandardMaterial({ color: 0x684323, roughness: 0.9 });
    const leaves = new THREE.MeshStandardMaterial({
      color: 0x2f4d3a,
      emissive: 0x061208,
      roughness: 0.96,
      flatShading: true,
    });
    const signMaterial = new THREE.MeshStandardMaterial({ color: 0xd55a38, emissive: 0x230703, roughness: 0.68 });

    for (let i = 0; i < 80; i += 1) {
      const t = i / 80;
      const side = i % 2 ? -1 : 1;
      const point = this.#offsetPoint(t, side * (44 + (i % 5) * 8));
      this.#addPine(point.x, point.z, trunk, leaves);
    }

    [0.1, 0.3, 0.48, 0.62, 0.82].forEach((t) => {
      const sign = this.#orientedBox(t, this.roadWidth * 0.5 + 7.5, 5, 3.2, 0.5, signMaterial);
      sign.position.y = this.#terrainHeightAt(sign.position.x, sign.position.z) + 5.1;
      sign.rotation.y += Math.PI / 2;
      sign.castShadow = true;
      this.group.add(sign);
    });
  }

  #addPine(x, z, trunkMaterial, leafMaterial) {
    const groundY = this.#terrainHeightAt(x, z);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.7, 4, 5), trunkMaterial);
    trunk.position.set(x, groundY + 2, z);
    trunk.castShadow = false;
    this.group.add(trunk);

    const crown = new THREE.Mesh(new THREE.ConeGeometry(4.4, 9.5, 6), leafMaterial);
    crown.position.set(x, groundY + 8.6, z);
    crown.castShadow = false;
    this.group.add(crown);
  }

  #buildCheckpointGates() {
    const gateMaterial = new THREE.MeshStandardMaterial({ color: 0xcfc7a0, roughness: 0.68 });

    this.checkpoints.forEach((checkpoint, index) => {
      if (index === 0) return;

      const gate = new THREE.Group();
      const side = new THREE.Vector3(Math.cos(checkpoint.heading), 0, -Math.sin(checkpoint.heading));

      for (const direction of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.4, 0.8), gateMaterial);
        post.position.copy(checkpoint.position).addScaledVector(side, direction * (this.roadWidth * 0.5 + 4.2));
        post.position.y += 1.2;
        post.castShadow = true;
        gate.add(post);

        const cap = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.45, 1.55), gateMaterial);
        cap.position.copy(checkpoint.position).addScaledVector(side, direction * (this.roadWidth * 0.5 + 4.2));
        cap.position.y += 2.65;
        cap.castShadow = true;
        gate.add(cap);
      }
      gate.name = checkpoint.name;
      this.group.add(gate);
    });
  }

  #orientedBox(t, lateralOffset, width, height, depth, material) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    box.position.copy(this.#offsetPoint(t, lateralOffset));
    box.position.y += height * 0.5;
    box.rotation.y = this.#getHeadingAt(t);
    return box;
  }

  #offsetPoint(t, lateralOffset) {
    const point = this.getPointOnCenterLine(t);
    const next = this.getPointOnCenterLine(t + 0.004);
    const tangent = next.sub(point).normalize();
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x);
    return point.addScaledVector(side, lateralOffset);
  }

  #forwardAt(t) {
    const point = this.getPointOnCenterLine(t);
    return this.getPointOnCenterLine(t + 0.004).sub(point).normalize();
  }

  #nearestCenterLinePoint(position) {
    return this.#nearestTrackInfo(position).point;
  }

  #nearestTrackInfo(position, previousProgress = null) {
    let nearestPoint = this.centerLinePoints[0].clone();
    let nearestT = 0;
    let nearestDistance = Infinity;
    const hasProgressAnchor = Number.isFinite(previousProgress);

    for (let i = 0; i < this.centerLinePoints.length; i += 1) {
      const a = this.centerLinePoints[i];
      const b = this.centerLinePoints[(i + 1) % this.centerLinePoints.length];
      const abX = b.x - a.x;
      const abZ = b.z - a.z;
      const apX = position.x - a.x;
      const apZ = position.z - a.z;
      const lengthSq = Math.max(abX * abX + abZ * abZ, 0.0001);
      const segmentRatio = THREE.MathUtils.clamp((apX * abX + apZ * abZ) / lengthSq, 0, 1);
      const candidateX = a.x + abX * segmentRatio;
      const candidateZ = a.z + abZ * segmentRatio;
      const t = THREE.MathUtils.euclideanModulo((i + segmentRatio) / this.centerLinePoints.length, 1);
      const candidateY = this.#heightAt(t) + 0.12 + this.roadSurfaceOffset;
      const dx = position.x - candidateX;
      const dz = position.z - candidateZ;
      const dy = position.y - candidateY;
      const progressGap = hasProgressAnchor ? this.#wrappedProgressDistance(t, previousProgress) : 0;
      const continuityPenalty = hasProgressAnchor ? Math.max(0, progressGap - 0.055) ** 2 * 90000 : 0;
      const distanceSq = dx * dx + dz * dz + dy * dy * 3.5 + continuityPenalty;

      if (distanceSq < nearestDistance) {
        nearestDistance = distanceSq;
        nearestT = t;
        nearestPoint = new THREE.Vector3(candidateX, this.#heightAt(nearestT) + 0.12 + this.roadSurfaceOffset, candidateZ);
      }
    }

    return {
      point: nearestPoint,
      t: nearestT,
    };
  }

  #terrainHeightAt(x, z) {
    const localX = x + 38;
    const localZ = z + 12;
    const ridge =
      Math.sin(localX * 0.018) * 16 +
      Math.cos(localZ * 0.016) * 14 +
      Math.sin((localX - localZ) * 0.012) * 9;
    return ridge - 26;
  }

  #getHeadingAt(t) {
    const point = this.getPointOnCenterLine(t);
    const next = this.getPointOnCenterLine(t + 0.004);
    return Math.atan2(point.x - next.x, point.z - next.z);
  }

  #flatDistance(a, b) {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  #wrappedProgressDistance(a, b) {
    const delta = Math.abs(THREE.MathUtils.euclideanModulo(a - b + 0.5, 1) - 0.5);
    return Math.min(delta, 1 - delta);
  }
}
