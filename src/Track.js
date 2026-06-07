import * as THREE from "three";

// Track 1: German Countryside Circuit. The circuit is built from a closed
// center-line spline and lightweight low-poly meshes so it keeps the early
// 2000s console look without expensive assets or build tools.
export class Track {
  constructor() {
    this.name = "German Countryside Circuit";
    this.group = new THREE.Group();
    this.group.name = this.name;
    this.cameraCollisionObjects = [];
    this.roadWidth = 18;
    this.samples = 240;
    this.totalLaps = 3;
    this.checkpointRadius = 24;

    this.controlPoints = [
      new THREE.Vector3(0, 0, 138),
      new THREE.Vector3(2, 0, 58),
      new THREE.Vector3(22, 0, -30),
      new THREE.Vector3(78, 0, -118),
      new THREE.Vector3(148, 0, -150),
      new THREE.Vector3(216, 0, -82),
      new THREE.Vector3(224, 0, 36),
      new THREE.Vector3(164, 0, 120),
      new THREE.Vector3(88, 0, 154),
      new THREE.Vector3(18, 0, 154),
    ];
    this.curve = new THREE.CatmullRomCurve3(this.controlPoints, true, "catmullrom", 0.45);
    this.centerLinePoints = this.#sampleCenterLine();
    this.checkpoints = this.#createCheckpoints();
    this.startPosition = this.getPointOnCenterLine(0).add(new THREE.Vector3(-5, 0, 0));
    this.startRotation = this.#getHeadingAt(0);

    this.#buildTerrain();
    this.#buildRoad();
    this.#buildRoadDetails();
    this.#buildCountryside();
    this.#buildCheckpointGates();
  }

  getPointOnCenterLine(t) {
    const point = this.curve.getPointAt(THREE.MathUtils.euclideanModulo(t, 1));
    point.y = 0.12;
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
    const distance = this.#flatDistance(position, checkpoint.position);

    if (distance > checkpoint.radius) {
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
      strength: Math.min(distanceFromRoad * 0.045, 0.95),
      speedMultiplier: distanceFromRoad > 18 ? 0.965 : 0.982,
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
    const checkpointFractions = [0, 0.16, 0.32, 0.48, 0.64, 0.8];

    return checkpointFractions.map((t, index) => ({
      id: index,
      name: index === 0 ? "Start / Finish" : `Checkpoint ${index}`,
      t,
      position: this.getPointOnCenterLine(t),
      heading: this.#getHeadingAt(t),
      radius: index === 0 ? 28 : this.checkpointRadius,
    }));
  }

  #buildTerrain() {
    const geometry = new THREE.PlaneGeometry(620, 560, 42, 38);
    const positions = geometry.attributes.position;

    for (let i = 0; i < positions.count; i += 1) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const hill =
        Math.sin(x * 0.022) * 7.5 +
        Math.cos(y * 0.018) * 6.5 +
        Math.sin((x + y) * 0.012) * 4;
      positions.setZ(i, hill);
    }

    geometry.computeVertexNormals();

    const ground = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: 0x557445,
        roughness: 0.96,
        flatShading: true,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(96, -3.8, 4);
    ground.receiveShadow = true;
    this.group.add(ground);
  }

  #buildRoad() {
    const vertices = [];
    const indices = [];
    const normals = [];

    for (let i = 0; i <= this.samples; i += 1) {
      const t = i / this.samples;
      const point = this.getPointOnCenterLine(t);
      const next = this.getPointOnCenterLine(t + 1 / this.samples);
      const tangent = next.sub(point).normalize();
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
      const left = point.clone().addScaledVector(normal, this.roadWidth * 0.5);
      const right = point.clone().addScaledVector(normal, -this.roadWidth * 0.5);

      vertices.push(left.x, 0.08, left.z, right.x, 0.08, right.z);
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

    const road = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: 0x2b2d2f,
        roughness: 0.82,
        flatShading: true,
      }),
    );
    road.receiveShadow = true;
    this.group.add(road);
  }

  #buildRoadDetails() {
    const lineMaterial = new THREE.MeshStandardMaterial({ color: 0xd8cf85, roughness: 0.65 });
    const shoulderMaterial = new THREE.MeshStandardMaterial({ color: 0xe6e2cf, roughness: 0.72 });

    for (let i = 0; i < 72; i += 1) {
      const t = i / 72;
      const point = this.getPointOnCenterLine(t);
      const heading = this.#getHeadingAt(t);
      const dash = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.035, 5.5), lineMaterial);
      dash.position.set(point.x, 0.14, point.z);
      dash.rotation.y = heading;
      dash.receiveShadow = true;
      this.group.add(dash);
    }

    for (let i = 0; i < 96; i += 1) {
      const t = i / 96;
      const point = this.getPointOnCenterLine(t);
      const next = this.getPointOnCenterLine(t + 0.006);
      const tangent = next.sub(point).normalize();
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);

      for (const side of [-1, 1]) {
        const marker = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 3), shoulderMaterial);
        marker.position.copy(point).addScaledVector(normal, side * (this.roadWidth * 0.5 + 0.5));
        marker.position.y = 0.16;
        marker.rotation.y = Math.atan2(tangent.x, tangent.z);
        this.group.add(marker);
      }
    }

    this.#addStartGrid();
  }

  #addStartGrid() {
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f2e8, roughness: 0.56 });
    const black = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.56 });
    const start = this.checkpoints[0];

    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 6; col += 1) {
        const square = new THREE.Mesh(
          new THREE.BoxGeometry(3.2, 0.045, 3.1),
          (row + col) % 2 === 0 ? white : black,
        );
        square.position.set(-8 + col * 3.2, 0.18, 132 + row * 3.1);
        square.rotation.y = start.heading;
        square.receiveShadow = true;
        this.group.add(square);
      }
    }
  }

  #buildCountryside() {
    this.#buildTreeClusters();
    this.#buildFarms();
    this.#buildVillages();
    this.#buildHayFields();
    this.#buildDistantHills();
  }

  #buildTreeClusters() {
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x6b4526, roughness: 0.9 });
    const leafMaterials = [
      new THREE.MeshStandardMaterial({ color: 0x244f2b, roughness: 0.95, flatShading: true }),
      new THREE.MeshStandardMaterial({ color: 0x315f34, roughness: 0.95, flatShading: true }),
      new THREE.MeshStandardMaterial({ color: 0x486d31, roughness: 0.95, flatShading: true }),
    ];

    const treePositions = [
      [-58, 96], [-82, 74], [-104, 36], [-72, -34], [-30, -92], [42, -172], [82, -196],
      [168, -196], [248, -124], [266, -48], [260, 76], [206, 158], [134, 196], [62, 206],
      [-24, 198], [-86, 152], [118, 70], [118, 24], [128, -28],
    ];

    treePositions.forEach(([x, z], index) => {
      for (let cluster = 0; cluster < 4; cluster += 1) {
        const offsetX = Math.sin(index * 7.3 + cluster) * 10;
        const offsetZ = Math.cos(index * 5.1 + cluster) * 9;
        this.#addTree(x + offsetX, z + offsetZ, trunkMaterial, leafMaterials[index % leafMaterials.length]);
      }
    });
  }

  #addTree(x, z, trunkMaterial, leafMaterial) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 4.2, 5), trunkMaterial);
    trunk.position.set(x, 2, z);
    trunk.castShadow = true;
    this.group.add(trunk);

    const leaves = new THREE.Mesh(new THREE.ConeGeometry(4.2, 9, 6), leafMaterial);
    leaves.position.set(x, 7.6, z);
    leaves.castShadow = true;
    this.group.add(leaves);
  }

  #buildFarms() {
    this.#addFarmstead(-104, -132, 0.28);
    this.#addFarmstead(250, 126, -0.75);
  }

  #addFarmstead(x, z, rotation) {
    const wall = new THREE.MeshStandardMaterial({ color: 0xc8b48d, roughness: 0.86 });
    const roof = new THREE.MeshStandardMaterial({ color: 0x8f2f24, roughness: 0.88, flatShading: true });
    const barn = new THREE.MeshStandardMaterial({ color: 0x9f3d2d, roughness: 0.82 });

    this.#addBuilding(x, z, 16, 7, 12, wall, roof, rotation);
    this.#addBuilding(x + 24, z + 10, 20, 8, 14, barn, roof, rotation + 0.08);
    this.#addSilo(x + 42, z - 8);
  }

  #buildVillages() {
    const wallColors = [0xc8c2aa, 0xd6d2c1, 0xbba98b, 0xd0b78f];
    const roofColors = [0x823427, 0x6e2930, 0x8b5a34];
    const villagePositions = [
      [58, -204], [82, -218], [108, -208], [132, -220],
      [244, 14], [266, 28], [238, 44],
    ];

    villagePositions.forEach(([x, z], index) => {
      this.#addBuilding(
        x,
        z,
        12 + (index % 2) * 4,
        6,
        10,
        new THREE.MeshStandardMaterial({ color: wallColors[index % wallColors.length], roughness: 0.84 }),
        new THREE.MeshStandardMaterial({
          color: roofColors[index % roofColors.length],
          roughness: 0.86,
          flatShading: true,
        }),
        (index % 3) * 0.25,
      );
    });
  }

  #addBuilding(x, z, width, height, depth, wallMaterial, roofMaterial, rotation = 0) {
    const house = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), wallMaterial);
    body.position.y = height * 0.5;
    body.castShadow = true;
    body.receiveShadow = true;
    house.add(body);

    const roof = new THREE.Mesh(new THREE.ConeGeometry(width * 0.72, height * 0.58, 4), roofMaterial);
    roof.position.y = height + height * 0.3;
    roof.rotation.y = Math.PI * 0.25;
    roof.castShadow = true;
    house.add(roof);

    house.position.set(x, 0, z);
    house.rotation.y = rotation;
    this.group.add(house);
    this.cameraCollisionObjects.push(body);
  }

  #addSilo(x, z) {
    const silo = new THREE.Mesh(
      new THREE.CylinderGeometry(3.2, 3.2, 18, 10),
      new THREE.MeshStandardMaterial({ color: 0xbfc4bd, roughness: 0.76, flatShading: true }),
    );
    silo.position.set(x, 9, z);
    silo.castShadow = true;
    this.group.add(silo);
    this.cameraCollisionObjects.push(silo);
  }

  #buildHayFields() {
    const fieldMaterial = new THREE.MeshStandardMaterial({ color: 0xa98c3a, roughness: 0.94 });
    const hayMaterial = new THREE.MeshStandardMaterial({ color: 0xc99b35, roughness: 0.9, flatShading: true });

    [
      [-130, 52, 58, 42],
      [180, -176, 72, 34],
      [230, 92, 62, 40],
    ].forEach(([x, z, width, depth]) => {
      const field = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), fieldMaterial);
      field.rotation.x = -Math.PI / 2;
      field.position.set(x, 0.02, z);
      field.receiveShadow = true;
      this.group.add(field);

      for (let i = 0; i < 9; i += 1) {
        const bale = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 3), hayMaterial);
        bale.position.set(
          x - width * 0.35 + (i % 3) * width * 0.28,
          1,
          z - depth * 0.28 + Math.floor(i / 3) * depth * 0.28,
        );
        bale.rotation.y = i * 0.35;
        bale.castShadow = true;
        this.group.add(bale);
      }
    });
  }

  #buildDistantHills() {
    const hillMaterial = new THREE.MeshStandardMaterial({
      color: 0x6f8355,
      roughness: 1,
      flatShading: true,
    });

    for (let i = 0; i < 16; i += 1) {
      const hill = new THREE.Mesh(new THREE.ConeGeometry(42 + (i % 4) * 8, 34 + (i % 3) * 12, 7), hillMaterial);
      const angle = (i / 16) * Math.PI * 2;
      hill.position.set(100 + Math.sin(angle) * 310, 11, Math.cos(angle) * 300);
      hill.scale.z = 0.6;
      hill.rotation.y = angle;
      this.group.add(hill);
    }
  }

  #buildCheckpointGates() {
    const gateMaterial = new THREE.MeshStandardMaterial({ color: 0xf0df92, roughness: 0.62 });

    this.checkpoints.forEach((checkpoint, index) => {
      if (index === 0) {
        return;
      }

      const gate = new THREE.Group();
      const side = new THREE.Vector3(Math.cos(checkpoint.heading), 0, -Math.sin(checkpoint.heading));

      for (const direction of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(1.2, 7.5, 1.2), gateMaterial);
        post.position.copy(checkpoint.position).addScaledVector(side, direction * (this.roadWidth * 0.5 + 1.8));
        post.position.y = 3.8;
        post.castShadow = true;
        gate.add(post);
      }

      const crossbar = new THREE.Mesh(new THREE.BoxGeometry(this.roadWidth + 5, 1.1, 1), gateMaterial);
      crossbar.position.copy(checkpoint.position);
      crossbar.position.y = 7.7;
      crossbar.rotation.y = checkpoint.heading + Math.PI / 2;
      crossbar.castShadow = true;
      gate.add(crossbar);
      gate.name = checkpoint.name;
      this.group.add(gate);
    });
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
}
