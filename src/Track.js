import * as THREE from "three";

// Track 2: Autobahn Sprint. This track keeps the same public API as Track 1
// while changing the world into a wide, fast, low-poly highway circuit.
export class Track {
  constructor() {
    this.name = "Autobahn Sprint";
    this.group = new THREE.Group();
    this.group.name = this.name;
    this.cameraCollisionObjects = [];
    this.roadWidth = 38;
    this.samples = 260;
    this.totalLaps = 3;
    this.checkpointRadius = 34;

    this.controlPoints = [
      new THREE.Vector3(-18, 0, 210),
      new THREE.Vector3(-8, 0, 86),
      new THREE.Vector3(18, 0, -76),
      new THREE.Vector3(86, 0, -246),
      new THREE.Vector3(214, 0, -330),
      new THREE.Vector3(370, 0, -292),
      new THREE.Vector3(458, 0, -150),
      new THREE.Vector3(452, 0, 34),
      new THREE.Vector3(340, 0, 176),
      new THREE.Vector3(168, 0, 226),
    ];

    this.curve = new THREE.CatmullRomCurve3(this.controlPoints, true, "catmullrom", 0.28);
    this.centerLinePoints = this.#sampleCenterLine();
    this.checkpoints = this.#createCheckpoints();
    this.startPosition = this.getPointOnCenterLine(0).add(new THREE.Vector3(-7, 0, 0));
    this.startRotation = this.#getHeadingAt(0);

    this.#buildTerrain();
    this.#buildHighway();
    this.#buildLaneDetails();
    this.#buildOverpasses();
    this.#buildSigns();
    this.#buildSpeedScenery();
    this.#buildCheckpointGates();
  }

  getPointOnCenterLine(t) {
    const point = this.curve.getPointAt(THREE.MathUtils.euclideanModulo(t, 1));
    point.y = 0.1;
    return point;
  }

  createLapState(totalLaps = this.totalLaps) {
    return {
      currentLap: 1,
      totalLaps,
      nextCheckpoint: 1,
      checkpointsPassed: 0,
      finished: false,
      lastCheckpointName: "Start",
    };
  }

  updateLapProgress(position, lapState) {
    if (lapState.finished) {
      return lapState;
    }

    const checkpoint = this.checkpoints[lapState.nextCheckpoint];

    if (this.#flatDistance(position, checkpoint.position) > checkpoint.radius) {
      return lapState;
    }

    lapState.lastCheckpointName = checkpoint.name;
    lapState.nextCheckpoint = (lapState.nextCheckpoint + 1) % this.checkpoints.length;
    lapState.checkpointsPassed += 1;

    if (lapState.nextCheckpoint === 1) {
      lapState.currentLap += 1;
      lapState.finished = lapState.currentLap > lapState.totalLaps;
      lapState.currentLap = Math.min(lapState.currentLap, lapState.totalLaps);
    }

    return lapState;
  }

  getSurfaceCorrection(position) {
    const nearest = this.#nearestCenterLinePoint(position);
    const offset = new THREE.Vector3(position.x - nearest.x, 0, position.z - nearest.z);
    const distanceFromRoad = offset.length() - this.roadWidth * 0.5;

    if (distanceFromRoad <= 0) {
      return null;
    }

    const direction = nearest.sub(new THREE.Vector3(position.x, nearest.y, position.z)).normalize();

    return {
      direction,
      strength: Math.min(distanceFromRoad * 0.04, 0.85),
      speedMultiplier: distanceFromRoad > 22 ? 0.972 : 0.988,
    };
  }

  #sampleCenterLine() {
    const points = [];

    for (let i = 0; i < this.samples; i += 1) {
      points.push(this.getPointOnCenterLine(i / this.samples));
    }

    return points;
  }

  #createCheckpoints() {
    return [0, 0.14, 0.29, 0.44, 0.59, 0.74, 0.88].map((t, index) => ({
      id: index,
      name: index === 0 ? "Start / Finish" : `Autobahn Sector ${index}`,
      t,
      position: this.getPointOnCenterLine(t),
      heading: this.#getHeadingAt(t),
      radius: index === 0 ? 38 : this.checkpointRadius,
    }));
  }

  #buildTerrain() {
    const geometry = new THREE.PlaneGeometry(860, 760, 26, 24);
    const positions = geometry.attributes.position;

    for (let i = 0; i < positions.count; i += 1) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const height = Math.sin(x * 0.01) * 3 + Math.cos(y * 0.012) * 4;
      positions.setZ(i, height);
    }

    geometry.computeVertexNormals();

    const terrain = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: 0x59695c,
        roughness: 0.95,
        flatShading: true,
      }),
    );
    terrain.rotation.x = -Math.PI / 2;
    terrain.position.set(220, -4.3, -56);
    terrain.receiveShadow = true;
    this.group.add(terrain);
  }

  #buildHighway() {
    const geometry = this.#createRoadGeometry(this.roadWidth);
    const highway = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: 0x282b30,
        roughness: 0.78,
        metalness: 0.04,
        flatShading: true,
      }),
    );
    highway.receiveShadow = true;
    this.group.add(highway);

    const shoulderGeometry = this.#createRoadGeometry(this.roadWidth + 7);
    const shoulder = new THREE.Mesh(
      shoulderGeometry,
      new THREE.MeshStandardMaterial({
        color: 0x55575a,
        roughness: 0.86,
        flatShading: true,
      }),
    );
    shoulder.position.y = -0.025;
    shoulder.receiveShadow = true;
    this.group.add(shoulder);
  }

  #createRoadGeometry(width) {
    const vertices = [];
    const indices = [];
    const normals = [];

    for (let i = 0; i <= this.samples; i += 1) {
      const t = i / this.samples;
      const point = this.getPointOnCenterLine(t);
      const next = this.getPointOnCenterLine(t + 1 / this.samples);
      const tangent = next.sub(point).normalize();
      const side = new THREE.Vector3(-tangent.z, 0, tangent.x);
      const left = point.clone().addScaledVector(side, width * 0.5);
      const right = point.clone().addScaledVector(side, -width * 0.5);

      vertices.push(left.x, 0.1, left.z, right.x, 0.1, right.z);
      normals.push(0, 1, 0, 0, 1, 0);

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

  #buildLaneDetails() {
    const white = new THREE.MeshStandardMaterial({ color: 0xe9e4d0, roughness: 0.62 });
    const yellow = new THREE.MeshStandardMaterial({ color: 0xdacb62, roughness: 0.65 });
    const barrier = new THREE.MeshStandardMaterial({ color: 0x9ca3a5, roughness: 0.72, flatShading: true });

    for (let i = 0; i < 115; i += 1) {
      const t = i / 115;
      const point = this.getPointOnCenterLine(t);
      const heading = this.#getHeadingAt(t);

      for (const offset of [-12, -6, 6, 12]) {
        const dash = this.#orientedBox(t, offset, 0.2, 0.04, 7.6, white);
        dash.rotation.y = heading;
        this.group.add(dash);
      }

      if (i % 2 === 0) {
        const median = this.#orientedBox(t, 0, 1.4, 0.9, 7, barrier);
        median.position.y = 0.55;
        median.rotation.y = heading;
        median.castShadow = true;
        this.group.add(median);
        this.cameraCollisionObjects.push(median);
      }

      if (i % 5 === 0) {
        const leftShoulder = this.#orientedBox(t, this.roadWidth * 0.5 + 1.2, 1, 0.05, 4, yellow);
        const rightShoulder = this.#orientedBox(t, -this.roadWidth * 0.5 - 1.2, 1, 0.05, 4, yellow);
        leftShoulder.rotation.y = heading;
        rightShoulder.rotation.y = heading;
        this.group.add(leftShoulder, rightShoulder);
      }
    }

    this.#addStartGrid();
  }

  #addStartGrid() {
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f2e8, roughness: 0.56 });
    const black = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.56 });

    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 10; col += 1) {
        const square = this.#orientedBox(0.002, -18 + col * 4, 3.8, 0.05, 3.4, (row + col) % 2 ? black : white);
        square.position.add(this.#forwardAt(0.002).multiplyScalar(row * 3.4));
        square.position.y = 0.23;
        square.rotation.y = this.startRotation;
        square.receiveShadow = true;
        this.group.add(square);
      }
    }
  }

  #buildOverpasses() {
    const concrete = new THREE.MeshStandardMaterial({ color: 0x777a78, roughness: 0.84, flatShading: true });
    const shadow = new THREE.MeshStandardMaterial({ color: 0x1b2025, roughness: 0.92 });

    [0.18, 0.38, 0.66, 0.83].forEach((t, index) => {
      const heading = this.#getHeadingAt(t) + Math.PI / 2;
      const point = this.getPointOnCenterLine(t);
      const bridge = new THREE.Group();

      const deck = new THREE.Mesh(new THREE.BoxGeometry(72, 3.2, 16), concrete);
      deck.position.set(point.x, 10.6, point.z);
      deck.rotation.y = heading;
      deck.castShadow = true;
      deck.receiveShadow = true;
      bridge.add(deck);

      const shade = new THREE.Mesh(new THREE.BoxGeometry(62, 0.08, 14), shadow);
      shade.position.set(point.x, 0.24, point.z);
      shade.rotation.y = heading;
      bridge.add(shade);

      const side = new THREE.Vector3(Math.cos(heading), 0, -Math.sin(heading));
      for (const offset of [-30, 30]) {
        const support = new THREE.Mesh(new THREE.BoxGeometry(3.6, 10, 3.6), concrete);
        support.position.copy(point).addScaledVector(side, offset);
        support.position.y = 5;
        support.castShadow = true;
        bridge.add(support);
        this.cameraCollisionObjects.push(support);
      }

      bridge.name = `Overpass ${index + 1}`;
      this.group.add(bridge);
      this.cameraCollisionObjects.push(deck);
    });
  }

  #buildSigns() {
    const blue = new THREE.MeshStandardMaterial({ color: 0x214e8a, roughness: 0.62 });
    const green = new THREE.MeshStandardMaterial({ color: 0x1e6b4a, roughness: 0.62 });
    const metal = new THREE.MeshStandardMaterial({ color: 0xb8bdba, roughness: 0.55, metalness: 0.2 });

    [
      [0.1, -26, "A7"],
      [0.24, 27, "KOLN"],
      [0.47, -27, "180"],
      [0.57, 27, "A9"],
      [0.76, -27, "AUSFAHRT"],
      [0.92, 27, "SPRINT"],
    ].forEach(([t, offset, label], index) => {
      const material = index % 2 === 0 ? blue : green;
      const point = this.#offsetPoint(t, offset);
      const sign = new THREE.Group();
      const heading = this.#getHeadingAt(t);

      const post = new THREE.Mesh(new THREE.BoxGeometry(1.2, 8, 1.2), metal);
      post.position.set(point.x, 4, point.z);
      post.castShadow = true;
      sign.add(post);

      const board = new THREE.Mesh(new THREE.BoxGeometry(12, 5.4, 0.55), material);
      board.position.set(point.x, 9.2, point.z);
      board.rotation.y = heading + Math.PI / 2;
      board.castShadow = true;
      sign.add(board);

      const text = this.#makeSignSprite(label);
      text.position.set(point.x, 9.35, point.z);
      text.rotation.y = board.rotation.y;
      sign.add(text);

      this.group.add(sign);
    });
  }

  #buildSpeedScenery() {
    const soundWallMaterial = new THREE.MeshStandardMaterial({
      color: 0x61717c,
      roughness: 0.9,
      flatShading: true,
    });
    const lampMaterial = new THREE.MeshStandardMaterial({ color: 0x2f363c, roughness: 0.68, metalness: 0.25 });
    const blockMaterial = new THREE.MeshStandardMaterial({ color: 0x9b9f9b, roughness: 0.86, flatShading: true });

    for (let i = 0; i < 46; i += 1) {
      const t = i / 46;
      const heading = this.#getHeadingAt(t);

      for (const side of [-1, 1]) {
        if (i % 2 === 0 && i > 3 && i < 43) {
          const wall = this.#orientedBox(t, side * 34, 14, 7, 8, soundWallMaterial);
          wall.position.y = 3.5;
          wall.rotation.y = heading;
          wall.castShadow = true;
          this.group.add(wall);
          this.cameraCollisionObjects.push(wall);
        }

        if (i % 5 === 0) {
          const lamp = this.#orientedBox(t, side * 25, 1, 13, 1, lampMaterial);
          lamp.position.y = 6.5;
          lamp.rotation.y = heading;
          lamp.castShadow = true;
          this.group.add(lamp);
        }
      }
    }

    for (let i = 0; i < 22; i += 1) {
      const t = i / 22;
      const block = this.#orientedBox(t, i % 2 ? 58 : -58, 18 + (i % 3) * 8, 8, 16, blockMaterial);
      block.position.y = 4;
      block.rotation.y += (i % 4) * 0.28;
      block.castShadow = true;
      block.receiveShadow = true;
      this.group.add(block);
    }
  }

  #buildCheckpointGates() {
    const gateMaterial = new THREE.MeshStandardMaterial({ color: 0xd4e2ef, roughness: 0.55 });

    this.checkpoints.forEach((checkpoint, index) => {
      if (index === 0) return;

      const heading = checkpoint.heading + Math.PI / 2;
      const gate = new THREE.Mesh(new THREE.BoxGeometry(this.roadWidth + 8, 1.2, 1.2), gateMaterial);
      gate.position.copy(checkpoint.position);
      gate.position.y = 11;
      gate.rotation.y = heading;
      gate.castShadow = true;
      gate.name = checkpoint.name;
      this.group.add(gate);
    });
  }

  #orientedBox(t, lateralOffset, width, height, depth, material) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    box.position.copy(this.#offsetPoint(t, lateralOffset));
    box.position.y = height * 0.5 + 0.12;
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
    let nearest = this.centerLinePoints[0];
    let nearestDistance = Infinity;

    for (const point of this.centerLinePoints) {
      const distance = this.#flatDistance(position, point);
      if (distance < nearestDistance) {
        nearest = point;
        nearestDistance = distance;
      }
    }

    return nearest.clone();
  }

  #getHeadingAt(t) {
    const point = this.getPointOnCenterLine(t);
    const next = this.getPointOnCenterLine(t + 0.004);
    return Math.atan2(next.x - point.x, next.z - point.z);
  }

  #flatDistance(a, b) {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  #makeSignSprite(label) {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 96;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.font = "700 42px Arial";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(label, 128, 48);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
      }),
    );
    sprite.scale.set(8, 3, 1);
    return sprite;
  }
}
