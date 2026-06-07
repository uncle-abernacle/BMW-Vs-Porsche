import * as THREE from "three";

// VisualPolish keeps the atmosphere work separate from gameplay. Everything
// here is geometry or renderer setup that sells the early-2000s console look
// while staying light enough for GitHub Pages and low-end browsers.
export function applyRendererPolish(renderer) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.BasicShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function buildAtmosphere(scene, track) {
  const sky = new THREE.Group();
  sky.name = "PS2 Bright Skybox";

  const skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(820, 16, 10),
    new THREE.MeshBasicMaterial({
      color: track.skyColor ?? 0xc7e6ff,
      side: THREE.BackSide,
      fog: false,
    }),
  );
  skyDome.position.y = 20;
  sky.add(skyDome);

  // A flat sun disk and blocky clouds mimic painted skybox cards from the era.
  const sunDisk = new THREE.Mesh(
    new THREE.CircleGeometry(36, 18),
    new THREE.MeshBasicMaterial({
      color: 0xfff0a8,
      transparent: true,
      opacity: 0.92,
      fog: false,
    }),
  );
  sunDisk.position.set(-240, 245, -290);
  sunDisk.lookAt(0, 0, 0);
  sky.add(sunDisk);

  const cloudMaterial = new THREE.MeshBasicMaterial({
    color: 0xf2f7ff,
    transparent: true,
    opacity: 0.72,
    fog: false,
  });

  for (let i = 0; i < 16; i += 1) {
    const cloud = new THREE.Group();
    const angle = (i / 16) * Math.PI * 2;
    const radius = 260 + (i % 4) * 28;
    cloud.position.set(Math.sin(angle) * radius - 40, 125 + (i % 3) * 9, Math.cos(angle) * radius - 20);
    cloud.rotation.y = -angle;

    for (let part = 0; part < 3; part += 1) {
      const puff = new THREE.Mesh(new THREE.BoxGeometry(24 + part * 8, 8, 11), cloudMaterial);
      puff.position.x = (part - 1) * 16;
      puff.position.y = Math.sin(part) * 3;
      cloud.add(puff);
    }

    sky.add(cloud);
  }

  scene.add(sky);
  return sky;
}
