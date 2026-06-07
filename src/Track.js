import * as THREE from "three";

// Track 3: Alpine Pass. The road is a narrow low-poly mountain loop with
// hairpins, tunnels, cliff edges, scenic overlooks, fog-friendly silhouettes,
// and ordered checkpoint/lap logic.
export class Track {
  constructor() {
    this.name = "Alpine Pass";
    this.group = new THREE.Group();
    this.group.name = this.name;
    this.cameraCollisionObjects = [];
    this.roadWidth = 15;
    this.samples = 280;
    this.totalLaps = 3;
    this.checkpointRadius = 22;
    this.backgroundColor = 0xaec4d5;
    this.fogColor = 0xaec4d5;
    this.fogNear = 70;
    this.fogFar = 390;

    this.controlPoints = [
      new THREE.Vector3(-18, 0, 132),
      new THREE.Vector3(-12, 0, 42),
      new THREE.Vector3(70, 0, -38),
      new THREE.Vector3(28, 0, -118),
      new THREE.Vector3(-82, 0, -92),
      new THREE.Vector3(-142, 0, -10),
      new THREE.Vector3(-92, 0, 72),
      new THREE.Vector3(44, 0, 92),
      new THREE.Vector3(142, 0, 36),
      new THREE.Vector3(124, 0, -78),
      new THREE.Vector3(24, 0, -168),
      new THREE.Vector3(-126, 0, -154),
      new THREE.Vector3(-210, 0, -46),
      new THREE.Vector3(-164, 0, 104),
      new THREE.Vector3(-62, 0, 172),
    ];

    this.curve = new THREE.CatmullRomCurve3(this.controlPoints, true, "catmullrom", 0.7);
    this.centerLinePoints = this.#sampleCenterLine();
    this.checkpoints = this.#createCheckpoints();
    this.startPosition = this.getPointOnCenterLine(0).add(new THREE.Vector3(-4, 0, 0));
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
      strength: Math.min(distanceFromRoad * 0.055, 1.05),
      speedMultiplier: distanceFromRoad > 12 ? 0.958 : 0.978,
    };
  }

  getProgressAtPosition(position) {
    let nearestIndex = 0;
    let nearestDistance = Infinity;

    for (let i = 0; i < this.centerLinePoints.length; i += 1) {
      const distance = this.#flatDistance(position, this.centerLinePoints[i]);

      if (distance < nearestDistance) {
        nearestIndex = i;
        nearestDistance = distance;
      }
    }

    return nearestIndex / this.centerLinePoints.length;
  }

  #heightAt(t) {
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
      radius: index === 0 ? 26 : this.checkpointRadius,
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
        color: 0x566657,
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
      new THREE.MeshStandardMaterial({
        color: 0x303238,
        roughness: 0.82,
        flatShading: true,
      }),
    );
    road.receiveShadow = true;
    this.group.add(road);

    const shoulder = new THREE.Mesh(
      this.#createRoadGeometry(this.roadWidth + 4),
      new THREE.MeshStandardMaterial({
        color: 0x6b6658,
        roughness: 0.94,
        flatShading: true,
      }),
    );
    shoulder.position.y = -0.04;
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
      const tangent = next.clone().sub(point).normalize();
      const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      const left = point.clone().addScaledVector(side, width * 0.5);
      const right = point.clone().addScaledVector(side, -width * 0.5);

      vertices.push(left.x, left.y, left.z, right.x, right.y, right.z);
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

  #buildRoadDetails() {
    const lineMaterial = new THREE.MeshStandardMaterial({ color: 0xd9cf7c, roughness: 0.68 });
    const stoneMaterial = new THREE.MeshStandardMaterial({
      color: 0x9b9686,
      roughness: 0.92,
      flatShading: true,
    });

    for (let i = 0; i < 82; i += 1) {
      const t = i / 82;
      const marker = this.#orientedBox(t, 0, 0.45, 0.04, 4.3, lineMaterial);
      marker.position.y += 0.12;
      this.group.add(marker);
    }

    for (let i = 0; i < 112; i += 1) {
      const t = i / 112;
      const insideHairpin = Math.sin(t * Math.PI * 8) > 0.35;

      for (const side of [-1, 1]) {
        if (insideHairpin || i % 3 === 0) {
          const block = this.#orientedBox(t, side * (this.roadWidth * 0.5 + 1.2), 1.2, 1.2, 2.8, stoneMaterial);
          block.castShadow = true;
          block.receiveShadow = true;
          this.group.add(block);
          this.cameraCollisionObjects.push(block);
        }
      }
    }

    this.#addStartGrid();
  }

  #addStartGrid() {
    const white = new THREE.MeshStandardMaterial({ color: 0xf0eee0, roughness: 0.6 });
    const black = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.6 });

    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 6; col += 1) {
        const square = this.#orientedBox(0.002, -7.5 + col * 3, 2.8, 0.045, 3, (row + col) % 2 ? black : white);
        square.position.add(this.#forwardAt(0.002).multiplyScalar(row * 3));
        square.position.y += 0.18;
        this.group.add(square);
      }
    }
  }

  #buildMountains() {
    const rockMaterials = [
      new THREE.MeshStandardMaterial({ color: 0x65706c, roughness: 1, flatShading: true }),
      new THREE.MeshStandardMaterial({ color: 0x7a7d73, roughness: 1, flatShading: true }),
      new THREE.MeshStandardMaterial({ color: 0x4c5857, roughness: 1, flatShading: true }),
    ];
    const snowMaterial = new THREE.MeshStandardMaterial({ color: 0xdfe7e6, roughness: 0.92, flatShading: true });

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
      mountain.position.set(x, height * 0.34 - 16, z);
      mountain.scale.z = 0.72;
      mountain.rotation.y = angle * 0.7;
      mountain.castShadow = true;
      this.group.add(mountain);

      const snow = new THREE.Mesh(new THREE.ConeGeometry(15 + (i % 3) * 4, height * 0.22, 6), snowMaterial);
      snow.position.set(x, height * 0.72 - 10, z);
      snow.scale.z = 0.72;
      snow.rotation.y = mountain.rotation.y;
      this.group.add(snow);
    }
  }

  #buildTunnels() {
    const tunnelMaterial = new THREE.MeshStandardMaterial({ color: 0x3c3b37, roughness: 0.92, flatShading: true });
    const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x11151a, roughness: 0.95 });

    [0.21, 0.71].forEach((t, index) => {
      const point = this.getPointOnCenterLine(t);
      const heading = this.#getHeadingAt(t);
      const portal = new THREE.Group();

      const arch = new THREE.Mesh(new THREE.BoxGeometry(32, 22, 12), tunnelMaterial);
      arch.position.copy(point);
      arch.position.y += 10;
      arch.rotation.y = heading;
      arch.castShadow = true;
      portal.add(arch);

      const opening = new THREE.Mesh(new THREE.BoxGeometry(20, 15, 12.4), darkMaterial);
      opening.position.copy(point);
      opening.position.y += 7.5;
      opening.rotation.y = heading;
      portal.add(opening);

      const roof = new THREE.Mesh(new THREE.ConeGeometry(26, 24, 6), tunnelMaterial);
      roof.position.copy(point);
      roof.position.y += 20;
      roof.rotation.y = heading;
      roof.scale.z = 0.45;
      roof.castShadow = true;
      portal.add(roof);

      portal.name = `Tunnel ${index + 1}`;
      this.group.add(portal);
      this.cameraCollisionObjects.push(arch);
    });
  }

  #buildCliffsAndOverlooks() {
    const cliffMaterial = new THREE.MeshStandardMaterial({
      color: 0x595a51,
      roughness: 1,
      flatShading: true,
    });
    const overlookMaterial = new THREE.MeshStandardMaterial({ color: 0x8c8779, roughness: 0.86 });

    for (let i = 0; i < 34; i += 1) {
      const t = i / 34;
      const side = Math.sin(t * Math.PI * 6) > 0 ? 1 : -1;
      const cliff = this.#orientedBox(t, side * 25, 18 + (i % 3) * 5, 24 + (i % 5) * 7, 16, cliffMaterial);
      cliff.position.y -= 9;
      cliff.rotation.y += (i % 3) * 0.2;
      cliff.castShadow = true;
      cliff.receiveShadow = true;
      this.group.add(cliff);
      this.cameraCollisionObjects.push(cliff);
    }

    [0.34, 0.56, 0.86].forEach((t, index) => {
      const side = index % 2 ? -1 : 1;
      const deck = this.#orientedBox(t, side * 21, 24, 1.2, 12, overlookMaterial);
      deck.position.y += 0.2;
      deck.castShadow = true;
      deck.receiveShadow = true;
      this.group.add(deck);

      const rail = this.#orientedBox(t, side * 28, 24, 2, 1.2, overlookMaterial);
      rail.position.y += 1.4;
      rail.castShadow = true;
      this.group.add(rail);
    });
  }

  #buildAlpineScenery() {
    const trunk = new THREE.MeshStandardMaterial({ color: 0x5a3821, roughness: 0.9 });
    const leaves = new THREE.MeshStandardMaterial({ color: 0x263f32, roughness: 0.96, flatShading: true });
    const signMaterial = new THREE.MeshStandardMaterial({ color: 0xb84b32, roughness: 0.7 });

    for (let i = 0; i < 80; i += 1) {
      const t = i / 80;
      const side = i % 2 ? -1 : 1;
      const point = this.#offsetPoint(t, side * (34 + (i % 5) * 8));
      this.#addPine(point.x, point.z, trunk, leaves);
    }

    [0.1, 0.3, 0.48, 0.62, 0.82].forEach((t) => {
      const sign = this.#orientedBox(t, this.roadWidth * 0.5 + 3.5, 5, 3.2, 0.5, signMaterial);
      sign.position.y += 2.8;
      sign.rotation.y += Math.PI / 2;
      sign.castShadow = true;
      this.group.add(sign);
    });
  }

  #addPine(x, z, trunkMaterial, leafMaterial) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.7, 4, 5), trunkMaterial);
    trunk.position.set(x, -1, z);
    trunk.castShadow = true;
    this.group.add(trunk);

    const crown = new THREE.Mesh(new THREE.ConeGeometry(4.4, 9.5, 6), leafMaterial);
    crown.position.set(x, 5, z);
    crown.castShadow = true;
    this.group.add(crown);
  }

  #buildCheckpointGates() {
    const gateMaterial = new THREE.MeshStandardMaterial({ color: 0xcfc7a0, roughness: 0.68 });

    this.checkpoints.forEach((checkpoint, index) => {
      if (index === 0) return;

      const gate = new THREE.Group();
      const side = new THREE.Vector3(Math.cos(checkpoint.heading), 0, -Math.sin(checkpoint.heading));

      for (const direction of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(1, 6.8, 1), gateMaterial);
        post.position.copy(checkpoint.position).addScaledVector(side, direction * (this.roadWidth * 0.5 + 1.6));
        post.position.y += 3.4;
        post.castShadow = true;
        gate.add(post);
      }

      const banner = new THREE.Mesh(new THREE.BoxGeometry(this.roadWidth + 4, 1, 0.8), gateMaterial);
      banner.position.copy(checkpoint.position);
      banner.position.y += 7.1;
      banner.rotation.y = checkpoint.heading + Math.PI / 2;
      banner.castShadow = true;
      gate.add(banner);
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
