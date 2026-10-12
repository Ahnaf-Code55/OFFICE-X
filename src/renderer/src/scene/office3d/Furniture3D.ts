import * as THREE from 'three';
import type { FurnitureItem } from './FurniturePlanner';

type Mat = THREE.MeshStandardMaterial;
type Palette = {
  main: Mat; light: Mat; dark: Mat; metal: Mat; screen: Mat; leaf: Mat; paper: Mat;
};

/**
 * Shared GPU resources. Floor tiles repeat the same handful of furniture
 * sizes and colours, so each unique geometry (type + size) and material
 * (colour + shading) is created once and reused by every furniture item.
 * disposeFurniture() therefore only detaches a group's children — it never
 * disposes the shared resources — and the caches are released wholesale via
 * disposeFurnitureCache() when the 3D scene is torn down for good.
 */
const geometryCache = new Map<string, THREE.BufferGeometry>();
const materialCache = new Map<string, Mat>();

function dimsKey(...dims: number[]): string {
  return dims.map((v) => v.toFixed(3)).join('x');
}

function cachedGeometry(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  const hit = geometryCache.get(key);
  if (hit) return hit;
  const made = make();
  geometryCache.set(key, made);
  return made;
}

/** Release every cached geometry and material (e.g. on final 3D teardown). */
export function disposeFurnitureCache(): void {
  for (const geometry of geometryCache.values()) geometry.dispose();
  for (const mat of materialCache.values()) mat.dispose();
  geometryCache.clear();
  materialCache.clear();
}

function itemColor(rgb: [number, number, number]): THREE.Color {
  const scale = Math.max(...rgb) > 1 ? 1 / 255 : 1;
  return new THREE.Color(
    THREE.MathUtils.clamp(rgb[0] * scale, 0, 1),
    THREE.MathUtils.clamp(rgb[1] * scale, 0, 1),
    THREE.MathUtils.clamp(rgb[2] * scale, 0, 1),
  );
}

function material(
  color: THREE.Color | number,
  roughness = 0.78,
  metalness = 0,
  emissive = 0x000000,
  emissiveIntensity = 0,
): Mat {
  const hex = typeof color === 'number' ? color.toString(16) : color.getHexString();
  const key = `${hex}/${roughness}/${metalness}/${emissive.toString(16)}/${emissiveIntensity}`;
  const hit = materialCache.get(key);
  if (hit) return hit;
  const made = new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive, emissiveIntensity });
  materialCache.set(key, made);
  return made;
}

/**
 * Item colours are per-tile averages, so almost every item differs slightly
 * and an exact cache key would never dedupe. Snapping to a coarse grid makes
 * near-identical items share one material set at no visible cost.
 */
function quantize(c: THREE.Color, step = 0.08): THREE.Color {
  const q = (v: number) => Math.round(THREE.MathUtils.clamp(v, 0, 1) / step) * step;
  return new THREE.Color(q(c.r), q(c.g), q(c.b));
}

function palette(item: FurnitureItem): Palette {
  const base = quantize(itemColor(item.color));
  return {
    main: material(base),
    light: material(base.clone().lerp(new THREE.Color(0xffffff), 0.24)),
    dark: material(base.clone().multiplyScalar(0.58)),
    metal: material(0x8a9096, 0.35, 0.6),
    // Cheap soft glow: a low-intensity emissive on the screen material.
    screen: material(0x10161c, 0.35, 0.1, 0x4fc3f7, 0.55),
    leaf: material(base.clone().lerp(new THREE.Color(0x236b3b), 0.72), 0.9),
    paper: material(0xe8ddc9, 0.92),
  };
}

function box(parent: THREE.Object3D, mat: Mat, sx: number, sy: number, sz: number, x: number, y: number, z: number): THREE.Mesh {
  const cx = Math.max(0.025, sx), cy = Math.max(0.025, sy), cz = Math.max(0.025, sz);
  const mesh = new THREE.Mesh(cachedGeometry(`box/${dimsKey(cx, cy, cz)}`, () => new THREE.BoxGeometry(cx, cy, cz)), mat);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function cylinder(
  parent: THREE.Object3D,
  mat: Mat,
  top: number,
  bottom: number,
  height: number,
  x: number,
  y: number,
  z: number,
  sides = 8,
): THREE.Mesh {
  const geometry = cachedGeometry(`cyl/${dimsKey(top, bottom, height)}/${sides}`, () =>
    new THREE.CylinderGeometry(top, bottom, height, sides));
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function sphere(parent: THREE.Object3D, mat: Mat, radius: number, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(cachedGeometry(`sph/${radius.toFixed(3)}`, () => new THREE.SphereGeometry(radius, 8, 6)), mat);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

/** Slim modern desk: a thin light top on four thin metal legs. */
function desk(parent: THREE.Object3D, p: Palette, w: number, d: number): void {
  const topW = Math.max(0.72, w * 0.9), topD = Math.max(0.55, d * 0.76);
  box(parent, p.light, topW, 0.05, topD, 0, 0.74, 0);
  const lx = Math.max(0.2, topW / 2 - 0.08), lz = Math.max(0.13, topD / 2 - 0.08);
  for (const x of [-lx, lx]) for (const z of [-lz, lz]) box(parent, p.metal, 0.05, 0.72, 0.05, x, 0.36, z);
}

/** Desk plus a thin-bezel monitor whose screen has a soft emissive glow. */
function monitor(parent: THREE.Object3D, p: Palette, w: number, d: number): void {
  desk(parent, p, w, d);
  const sw = Math.min(0.78, Math.max(0.48, w * 0.31));
  const mz = -d * 0.13;
  box(parent, p.metal, 0.3, 0.02, 0.18, 0, 0.775, mz); // stand foot
  box(parent, p.metal, 0.05, 0.24, 0.05, 0, 0.9, mz); // stand neck
  box(parent, p.dark, sw + 0.04, 0.46, 0.035, 0, 1.12, mz); // thin bezel
  box(parent, p.screen, sw, 0.4, 0.012, 0, 1.12, mz + 0.024); // glowing screen
  box(parent, p.light, Math.min(0.44, w * 0.24), 0.015, 0.14, 0, 0.775, d * 0.2); // keyboard
}

/** Mesh-back ergonomic chair on a 5-star base with casters. */
function chair(parent: THREE.Object3D, p: Palette, w: number, d: number): void {
  const seatW = Math.min(0.68, Math.max(0.46, w * 0.64));
  const seatD = Math.min(0.62, Math.max(0.42, d * 0.48));
  box(parent, p.main, seatW, 0.09, seatD, 0, 0.5, 0); // seat
  const back = box(parent, p.dark, seatW * 0.88, 0.52, 0.045, 0, 0.95, -seatD / 2 + 0.03); // mesh back
  back.rotation.x = -0.12;
  box(parent, p.metal, 0.05, 0.3, 0.05, 0, 0.68, -seatD / 2 + 0.05); // back post
  cylinder(parent, p.metal, 0.03, 0.03, 0.4, 0, 0.28, 0, 8); // gas lift
  for (let i = 0; i < 5; i++) {
    const a = (i * Math.PI * 2) / 5;
    const leg = box(parent, p.dark, 0.34, 0.035, 0.05, 0.15, 0.05, 0);
    leg.rotation.y = a;
    cylinder(parent, p.dark, 0.028, 0.028, 0.05, Math.cos(a) * 0.31, 0.03, -Math.sin(a) * 0.31, 6);
  }
}

function shelf(parent: THREE.Object3D, p: Palette, w: number, d: number): void {
  const ww = Math.max(0.8, w * 0.88), dd = Math.max(0.38, d * 0.66), h = 1.75;
  box(parent, p.dark, 0.11, h, dd, -ww / 2 + 0.055, h / 2, 0);
  box(parent, p.dark, 0.11, h, dd, ww / 2 - 0.055, h / 2, 0);
  box(parent, p.dark, ww, h, 0.06, 0, h / 2, dd / 2);
  for (const y of [0.08, 0.55, 1.02, 1.7]) box(parent, p.main, ww, 0.09, dd, 0, y, 0);
  const colors = [material(0x8f3f3f), material(0x386a83), material(0xc1943d), p.paper];
  for (let i = 0; i < Math.min(8, Math.max(3, Math.floor(w * 2))); i++) {
    const row = i % 2, bw = Math.min(0.16, ww / 10);
    box(parent, colors[i % colors.length], bw, 0.28 + (i % 3) * 0.04, dd * 0.45,
      -ww * 0.34 + (i % 4) * bw * 1.25, 0.24 + row * 0.48, -dd * 0.18);
  }
}

/** Plain cabinet body with a door split line, handles, and a bevelled top. */
function cabinet(parent: THREE.Object3D, p: Palette, w: number, d: number): void {
  const ww = Math.max(0.68, w * 0.82), dd = Math.max(0.48, d * 0.72), h = 1.28;
  box(parent, p.main, ww, h, dd, 0, h / 2, 0);
  box(parent, p.light, ww * 0.94, 0.05, dd * 0.94, 0, h + 0.02, 0);
  box(parent, p.dark, 0.025, h * 0.8, 0.02, 0, h * 0.5, -dd / 2 - 0.012);
  for (const x of [-0.07, 0.07]) box(parent, p.metal, 0.03, 0.18, 0.03, x, h * 0.52, -dd / 2 - 0.03);
}

/** Slim conference table: thin top, veneer inlay, and two narrow panel legs. */
function table(parent: THREE.Object3D, p: Palette, w: number, d: number): void {
  const ww = Math.max(1, w * 0.88), dd = Math.max(0.75, d * 0.78), y = 0.76;
  box(parent, p.main, ww, 0.1, dd, 0, y, 0);
  box(parent, p.light, ww * 0.9, 0.02, dd * 0.86, 0, y + 0.06, 0);
  for (const x of [-ww * 0.34, ww * 0.34]) box(parent, p.dark, 0.08, 0.7, dd * 0.6, x, 0.37, 0);
}

/** Sofa with cylindrical rolled arms and back rail for a rounded read. */
function sofa(parent: THREE.Object3D, p: Palette, w: number, d: number): void {
  const ww = Math.max(1.25, w * 0.88), dd = Math.max(0.7, d * 0.72);
  box(parent, p.main, ww, 0.3, dd, 0, 0.22, 0);
  box(parent, p.main, ww, 0.5, 0.2, 0, 0.58, dd / 2 - 0.1);
  const rail = cylinder(parent, p.main, 0.1, 0.1, ww, 0, 0.86, dd / 2 - 0.1, 8);
  rail.rotation.z = Math.PI / 2;
  for (const x of [-ww / 2 + 0.13, ww / 2 - 0.13]) {
    const arm = cylinder(parent, p.main, 0.13, 0.13, dd * 0.92, x, 0.5, 0, 8);
    arm.rotation.x = Math.PI / 2;
  }
  const cushions = Math.max(2, Math.min(5, Math.round(ww / 0.8)));
  const cw = (ww - 0.58) / cushions;
  for (let i = 0; i < cushions; i++) {
    box(parent, p.light, cw * 0.9, 0.15, dd * 0.62, -ww / 2 + 0.29 + cw * (i + 0.5), 0.44, -dd * 0.05);
  }
}

function plant(parent: THREE.Object3D, p: Palette, w: number, d: number): void {
  const radius = Math.min(0.36, Math.max(0.22, Math.min(w, d) * 0.3));
  cylinder(parent, p.dark, radius * 0.78, radius, 0.42, 0, 0.21, 0, 10);
  cylinder(parent, p.leaf, 0.045, 0.055, 0.62, 0, 0.65, 0, 7);
  for (const [x, y, z, s] of [
    [-0.18, 0.78, 0, 0.25], [0.18, 0.9, 0.03, 0.28], [0, 1.03, -0.13, 0.29],
    [-0.05, 0.82, 0.18, 0.23], [0.08, 1.16, 0.05, 0.22],
  ] as Array<[number, number, number, number]>) sphere(parent, p.leaf, s, x, y, z);
}

function counter(parent: THREE.Object3D, p: Palette, w: number, d: number): void {
  const ww = Math.max(0.9, w * 0.92), dd = Math.max(0.54, d * 0.76);
  box(parent, p.dark, ww * 0.94, 0.88, dd * 0.78, 0, 0.44, 0.04);
  box(parent, p.main, ww, 0.13, dd, 0, 0.93, 0);
  box(parent, p.light, ww, 0.045, 0.055, 0, 1.02, -dd / 2 + 0.03);
  const panels = Math.max(1, Math.min(5, Math.floor(ww / 0.7)));
  for (let i = 1; i < panels; i++) box(parent, p.main, 0.025, 0.66, 0.03, -ww / 2 + ww * i / panels, 0.47, -dd * 0.4);
}

/** Plain appliance body with a door line, handle, bevelled top, and display. */
function appliance(parent: THREE.Object3D, p: Palette, w: number, d: number): void {
  const ww = Math.max(0.65, w * 0.82), dd = Math.max(0.56, d * 0.74), h = 1.45;
  box(parent, p.main, ww, h, dd, 0, h / 2, 0);
  box(parent, p.light, ww * 0.94, 0.05, dd * 0.94, 0, h + 0.02, 0);
  box(parent, p.dark, ww * 0.8, 0.025, 0.02, 0, h * 0.55, -dd / 2 - 0.012);
  box(parent, p.metal, ww * 0.4, 0.035, 0.03, 0, h * 0.62, -dd / 2 - 0.03);
  box(parent, p.screen, ww * 0.26, h * 0.09, 0.02, ww * 0.2, h * 0.8, -dd / 2 - 0.02);
}

/** Plain crate with a lid seam, small handle, and a bevelled top edge. */
function crate(parent: THREE.Object3D, p: Palette, w: number, d: number): void {
  const ww = Math.max(0.45, w * 0.76), dd = Math.max(0.45, d * 0.76), h = 0.62;
  box(parent, p.main, ww, h, dd, 0, h / 2, 0);
  box(parent, p.light, ww * 0.92, 0.045, dd * 0.92, 0, h + 0.015, 0);
  box(parent, p.dark, ww * 0.7, 0.02, 0.02, 0, h * 0.55, -dd / 2 - 0.01);
  box(parent, p.metal, 0.16, 0.035, 0.03, 0, h * 0.68, -dd / 2 - 0.02);
}

/** Build a low-poly prop whose group origin is the footprint's top-left floor corner. */
export function buildFurniture(item: FurnitureItem): THREE.Group {
  const group = new THREE.Group();
  group.name = `furniture-${item.kind}`;
  group.userData.furniture = item;

  const pivot = new THREE.Group();
  pivot.position.set(item.w / 2, 0, item.d / 2);
  pivot.rotation.y = -THREE.MathUtils.degToRad(item.rot);
  group.add(pivot);

  // Builders work in their unrotated local footprint. Swapping dimensions for
  // quarter turns keeps the rotated model inside the original w-by-d bounds.
  const quarterTurn = item.rot === 90 || item.rot === 270;
  const w = Math.max(0.5, quarterTurn ? item.d : item.w);
  const d = Math.max(0.5, quarterTurn ? item.w : item.d);
  const p = palette(item);
  switch (item.kind) {
    case 'desk': desk(pivot, p, w, d); break;
    case 'chair': chair(pivot, p, w, d); break;
    case 'monitor': monitor(pivot, p, w, d); break;
    case 'shelf': shelf(pivot, p, w, d); break;
    case 'cabinet': cabinet(pivot, p, w, d); break;
    case 'table': table(pivot, p, w, d); break;
    case 'sofa': sofa(pivot, p, w, d); break;
    case 'plant': plant(pivot, p, w, d); break;
    case 'counter': counter(pivot, p, w, d); break;
    case 'appliance': appliance(pivot, p, w, d); break;
    case 'box': crate(pivot, p, w, d); break;
  }
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; }
  });
  return group;
}

/**
 * Detach a furniture group's children. All geometry and materials come from
 * the shared module caches, so nothing GPU-side is disposed per item — call
 * disposeFurnitureCache() to release the shared resources wholesale.
 */
export function disposeFurniture(group: THREE.Group): void {
  group.clear();
}
