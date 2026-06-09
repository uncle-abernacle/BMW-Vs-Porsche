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
      [-164, 0, 146],
      [-68, 0, 174],
      [58, 0, 142],
      [142, 0, 70],
      [112, 0, -10],
      [166, 0, -76],
      [72, 0, -158],
      [-48, 0, -176],
      [-150, 0, -118],
      [-208, 0, -26],
      [-178, 0, 64],
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
    this.roadThickness = 1.25;
    this.trackClearance = 26;
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
    this.#buildTrackScenery();
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
      strength: Math.min(distanceFromRoad * 0.072, 0.82),
      speedMultiplier: distanceFromRoad > 12 ? 0.975 : 0.988,
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
    const geometry = new THREE.PlaneGeometry(620, 620, 58, 58);
    const positions = geometry.attributes.position;

    for (let i = 0; i < positions.count; i += 1) {
      const worldX = positions.getX(i) - 38;
      const worldZ = -positions.getY(i) - 12;
      positions.setZ(i, this.#terrainHeightAt(worldX, worldZ) + 8);
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
    const shoulderTopOffset = 0.02;
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
    shoulder.position.y = shoulderTopOffset;
    shoulder.renderOrder = 3;
    shoulder.receiveShadow = true;
    this.group.add(shoulder);

    const slabSideMaterial = new THREE.MeshBasicMaterial({
      color: 0x4b443b,
      side: THREE.DoubleSide,
      fog: false,
    });
    const slabUndersideMaterial = new THREE.MeshBasicMaterial({
      color: 0x25282c,
      side: THREE.DoubleSide,
      fog: false,
    });

    for (const side of [-1, 1]) {
      const sideWall = new THREE.Mesh(
        this.#createRoadSideWallGeometry(this.roadWidth + 4, side, shoulderTopOffset),
        slabSideMaterial,
      );
      sideWall.renderOrder = 2;
      sideWall.castShadow = true;
      sideWall.receiveShadow = true;
      this.group.add(sideWall);
    }

    const underside = new THREE.Mesh(
      this.#createRoadUndersideGeometry(this.roadWidth + 4, shoulderTopOffset),
      slabUndersideMaterial,
    );
    underside.renderOrder = 1;
    underside.castShadow = true;
    underside.receiveShadow = true;
    this.group.add(underside);

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
      const supportOffset = this.roadWidth * 0.5 + 2.3;
      const leftSupportPoint = point.clone().addScaledVector(side, supportOffset);
      const rightSupportPoint = point.clone().addScaledVector(side, -supportOffset);
      const groundY = Math.min(
        this.#terrainHeightAt(leftSupportPoint.x, leftSupportPoint.z),
        this.#terrainHeightAt(rightSupportPoint.x, rightSupportPoint.z),
      );
      const deckBottomY = roadY - this.roadThickness - 0.05;
      const drop = deckBottomY - groundY;

      if (drop < 7) {
        continue;
      }

      for (const sideSign of [-1, 1]) {
        const supportPoint = point.clone().addScaledVector(side, sideSign * supportOffset);
        const supportGroundY = this.#terrainHeightAt(supportPoint.x, supportPoint.z);
        const supportTopY = deckBottomY - 0.48;
        const supportHeight = Math.max(supportTopY - supportGroundY, 1);
        const support = new THREE.Mesh(new THREE.BoxGeometry(1.8, supportHeight, 1.8), supportMaterial);
        support.position.copy(supportPoint);
        support.position.y = supportGroundY + supportHeight * 0.5;
        support.castShadow = true;
        support.receiveShadow = true;
        this.group.add(support);

        const cap = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.5, 2.8), supportMaterial);
        cap.position.copy(supportPoint);
        cap.position.y = deckBottomY - 0.25;
        cap.rotation.y = heading;
        cap.castShadow = true;
        cap.receiveShadow = true;
        this.group.add(cap);
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

  #createRoadSideWallGeometry(width, sideSign, topOffset = this.roadSurfaceOffset) {
    const vertices = [];
    const indices = [];
    const normals = [];

    for (let i = 0; i <= this.samples; i += 1) {
      const t = i / this.samples;
      const point = this.getPointOnCenterLine(t);
      const next = this.getPointOnCenterLine(t + 1 / this.samples);
      const tangent = next.clone().sub(point).normalize();
      const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize().multiplyScalar(sideSign);
      const edge = point.clone().addScaledVector(side, width * 0.5);
      const topY = edge.y + topOffset;
      const bottomY = topY - this.roadThickness;

      vertices.push(edge.x, topY, edge.z, edge.x, bottomY, edge.z);
      normals.push(side.x, 0, side.z, side.x, 0, side.z);

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

  #createRoadUndersideGeometry(width, topOffset = this.roadSurfaceOffset) {
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
      const bottomY = point.y + topOffset - this.roadThickness;

      vertices.push(left.x, bottomY, left.z, right.x, bottomY, right.z);
      normals.push(0, -1, 0, 0, -1, 0);

      if (i < this.samples) {
        const base = i * 2;
        indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
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

  #buildTrackScenery() {
    if (this.definition.scenery === "alpine") {
      this.#buildMountains();
      this.#buildTunnels();
      this.#buildCliffsAndOverlooks();
    } else if (this.definition.scenery === "autobahn") {
      this.#buildAutobahnScenery();
    } else {
      this.#buildCountrysideScenery();
    }

    this.#buildRoadsideScenery();
  }

  #buildCountrysideScenery() {
    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0xb9a16c,
      emissive: 0x171108,
      roughness: 0.86,
      flatShading: true,
    });
    const roofMaterial = new THREE.MeshStandardMaterial({
      color: 0x8f3c2d,
      emissive: 0x120504,
      roughness: 0.9,
      flatShading: true,
    });

    [0.08, 0.19, 0.33, 0.47, 0.61, 0.76, 0.91].forEach((t, index) => {
      const side = index % 2 ? -1 : 1;
      const baseOffset = side * (this.roadWidth * 0.5 + 66 + (index % 3) * 12);
      const house = this.#groundedOrientedBox(t, baseOffset, 10 + (index % 2) * 3, 6, 12, wallMaterial, 34);
      house.castShadow = true;
      house.receiveShadow = true;
      this.group.add(house);

      const roof = this.#groundedOrientedBox(t, baseOffset, 12 + (index % 2) * 3, 3, 14, roofMaterial, 34);
      roof.position.y += 5.2;
      roof.rotation.z = side * 0.08;
      roof.castShadow = true;
      this.group.add(roof);
    });
  }

  #buildAutobahnScenery() {
    const signMaterial = new THREE.MeshStandardMaterial({
      color: 0x246c9c,
      emissive: 0x061321,
      roughness: 0.58,
      flatShading: true,
    });
    const postMaterial = new THREE.MeshStandardMaterial({
      color: 0x6e6b60,
      roughness: 0.88,
      flatShading: true,
    });

    [0.1, 0.28, 0.5, 0.72, 0.88].forEach((t, index) => {
      const side = index % 2 ? -1 : 1;
      const sign = this.#groundedOrientedBox(t, side * (this.roadWidth * 0.5 + 18), 7, 3.4, 0.6, signMaterial, 12);
      sign.position.y += 4.3;
      sign.castShadow = true;
      this.group.add(sign);
      this.#addPanelPosts(sign, 7, 3.4, postMaterial, 2);
    });
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
      polygonOffset: true,
      polygonOffsetFactor: -8,
      polygonOffsetUnits: -8,
    });

    for (let i = 0; i < 20; i += 1) {
      const angle = (i / 20) * Math.PI * 2;
      let radius = 230 + (i % 4) * 28;
      let x = Math.sin(angle) * radius - 36;
      let z = Math.cos(angle) * radius - 12;
      if (this.#flatRoadClearance(x, z) < 54) {
        radius += 86;
        x = Math.sin(angle) * radius - 36;
        z = Math.cos(angle) * radius - 12;
      }
      const height = 66 + (i % 5) * 18;
      const mountainRadius = 42 + (i % 3) * 12;
      const mountain = new THREE.Mesh(
        new THREE.ConeGeometry(mountainRadius, height, 6),
        rockMaterials[i % rockMaterials.length],
      );
      const groundY = this.#terrainHeightAt(x, z);
      mountain.position.set(x, groundY + height * 0.34, z);
      mountain.scale.z = 0.72;
      mountain.rotation.y = angle * 0.7;
      mountain.castShadow = false;
      this.group.add(mountain);

      const snowHeight = height * 0.28;
      const snowRadius = mountainRadius * (snowHeight / height) * 1.24;
      const mountainTopY = mountain.position.y + height * 0.5;
      const snow = new THREE.Mesh(new THREE.ConeGeometry(snowRadius, snowHeight, 6), snowMaterial);
      snow.position.set(x, mountainTopY - snowHeight * 0.5 + 0.36, z);
      snow.scale.z = 0.78;
      snow.rotation.y = mountain.rotation.y;
      snow.renderOrder = 12;
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
    [0.21, 0.71].forEach((t, index) => {
      const point = this.getPointOnCenterLine(t);
      const heading = this.#getHeadingAt(t);
      const portal = new THREE.Group();
      const clearOffset = this.roadWidth * 0.5 + 7.5;

      for (const sideSign of [-1, 1]) {
        const columnPoint = this.#offsetPoint(t, this.#clearedLateralOffset(t, sideSign * clearOffset, 4, 18));
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
      const cliff = this.#groundedRock(
        t,
        side * cliffOffset,
        13 + (i % 3) * 4,
        cliffHeight,
        cliffMaterial,
        34,
      );
      cliff.castShadow = true;
      cliff.receiveShadow = true;
      this.group.add(cliff);
      this.cameraCollisionObjects.push(cliff);
    }

    [0.34, 0.56, 0.86].forEach((t, index) => {
      const side = index % 2 ? -1 : 1;
      const deck = this.#groundedOrientedBox(t, side * (this.roadWidth * 0.5 + 42), 24, 1.2, 12, overlookMaterial, 34);
      deck.position.y += 0.6;
      deck.castShadow = true;
      deck.receiveShadow = true;
      this.group.add(deck);

      const rail = this.#groundedOrientedBox(t, side * (this.roadWidth * 0.5 + 50), 24, 2, 1.2, overlookMaterial, 40);
      rail.position.y += 2.1;
      rail.castShadow = true;
      this.group.add(rail);
    });
  }

  #buildRoadsideScenery() {
    const trunk = new THREE.MeshStandardMaterial({ color: 0x684323, roughness: 0.9 });
    const leaves = new THREE.MeshStandardMaterial({
      color: 0x2f4d3a,
      emissive: 0x061208,
      roughness: 0.96,
      flatShading: true,
    });
    const signMaterial = new THREE.MeshStandardMaterial({ color: 0xd55a38, emissive: 0x230703, roughness: 0.68 });
    const postMaterial = new THREE.MeshStandardMaterial({ color: 0x5d5244, roughness: 0.86, flatShading: true });

    for (let i = 0; i < 80; i += 1) {
      const t = i / 80;
      const side = i % 2 ? -1 : 1;
      const point = this.#offsetPoint(t, this.#clearedLateralOffset(t, side * (44 + (i % 5) * 8), 8, 22));
      this.#addPine(point.x, point.z, trunk, leaves);
    }

    [0.1, 0.3, 0.48, 0.62, 0.82].forEach((t) => {
      const sign = this.#groundedOrientedBox(t, this.roadWidth * 0.5 + 18, 5, 3.2, 0.5, signMaterial, 16);
      sign.position.y += 2.8;
      sign.rotation.y += Math.PI / 2;
      sign.castShadow = true;
      this.group.add(sign);
      this.#addPanelPosts(sign, 5, 3.2, postMaterial, 1);
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

  #groundedOrientedBox(t, lateralOffset, width, height, depth, material, minClearance = this.trackClearance) {
    const safeOffset = this.#clearedLateralOffset(t, lateralOffset, width, minClearance);
    const box = this.#orientedBox(t, safeOffset, width, height, depth, material);
    box.position.y = this.#terrainHeightAt(box.position.x, box.position.z) + height * 0.5;
    return box;
  }

  #groundedRock(t, lateralOffset, radius, height, material, minClearance = this.trackClearance) {
    const safeOffset = this.#clearedLateralOffset(t, lateralOffset, radius * 2, minClearance);
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), material);
    rock.position.copy(this.#offsetPoint(t, safeOffset));
    rock.position.y = this.#terrainHeightAt(rock.position.x, rock.position.z) + height * 0.5;
    rock.scale.set(radius * 0.9, height * 0.5, radius);
    rock.rotation.set(0.08, this.#getHeadingAt(t) + radius * 0.03, -0.06);
    return rock;
  }

  #addPanelPosts(panel, panelWidth, panelHeight, material, postCount = 1) {
    const groundY = this.#terrainHeightAt(panel.position.x, panel.position.z);
    const bottomY = panel.position.y - panelHeight * 0.5;
    const postHeight = bottomY - groundY;

    if (postHeight <= 0.4) {
      return;
    }

    const across = new THREE.Vector3(Math.cos(panel.rotation.y), 0, -Math.sin(panel.rotation.y));
    const offsets = postCount > 1 ? [-panelWidth * 0.32, panelWidth * 0.32] : [0];

    for (const offset of offsets) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.45, postHeight, 0.45), material);
      post.position.copy(panel.position).addScaledVector(across, offset);
      post.position.y = groundY + postHeight * 0.5;
      post.castShadow = true;
      post.receiveShadow = true;
      this.group.add(post);
    }
  }

  #safeLateralOffset(lateralOffset, objectWidth = 0, minClearance = this.trackClearance) {
    const direction = lateralOffset < 0 ? -1 : 1;
    const minimumOffset = this.roadWidth * 0.5 + minClearance + objectWidth * 0.5;
    return direction * Math.max(Math.abs(lateralOffset), minimumOffset);
  }

  #clearedLateralOffset(t, lateralOffset, objectWidth = 0, minClearance = this.trackClearance) {
    const direction = lateralOffset < 0 ? -1 : 1;
    const requiredClearance = minClearance + objectWidth * 0.5;
    let offset = this.#safeLateralOffset(lateralOffset, objectWidth, minClearance);

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const point = this.#offsetPoint(t, offset);
      if (this.#flatRoadClearance(point.x, point.z) >= requiredClearance) {
        return offset;
      }

      offset += direction * (8 + attempt * 4);
    }

    return offset;
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
    const baseHeight = this.#baseTerrainHeightAt(x, z);
    const corridorWidth = this.roadWidth * 0.5 + this.trackClearance;
    let flatDistance = Infinity;
    let roadBottomY = Infinity;

    for (let i = 0; i < this.centerLinePoints.length; i += 1) {
      const point = this.centerLinePoints[i];
      const distance = this.#flatDistance({ x, z }, point);
      flatDistance = Math.min(flatDistance, distance);

      if (distance < corridorWidth) {
        roadBottomY = Math.min(roadBottomY, point.y + this.roadSurfaceOffset - this.roadThickness - 2.6);
      }
    }

    if (flatDistance < corridorWidth && Number.isFinite(roadBottomY)) {
      return Math.min(baseHeight, roadBottomY);
    }

    return baseHeight;
  }

  #baseTerrainHeightAt(x, z) {
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

  #flatRoadClearance(x, z) {
    let nearestDistanceSq = Infinity;

    for (const point of this.centerLinePoints) {
      const dx = x - point.x;
      const dz = z - point.z;
      nearestDistanceSq = Math.min(nearestDistanceSq, dx * dx + dz * dz);
    }

    return Math.sqrt(nearestDistanceSq) - this.roadWidth * 0.5;
  }

  #wrappedProgressDistance(a, b) {
    const delta = Math.abs(THREE.MathUtils.euclideanModulo(a - b + 0.5, 1) - 0.5);
    return Math.min(delta, 1 - delta);
  }
}
