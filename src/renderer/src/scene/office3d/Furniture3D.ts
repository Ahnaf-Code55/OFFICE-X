import * as THREE from 'three';
import type { FurnitureItem } from './FurniturePlanner';

type Mat = THREE.MeshStandardMaterial;
type Palette = {
  main: Mat; light: Mat; dark: Mat; metal: Mat; screen: Mat; leaf: Mat; paper: Mat;
};

function itemColor(rgb: [number, number, number]): THREE.Color {
  const scale = Math.max(...rgb) > 1 ? 1 / 255 : 1;
  return new THREE.Color(
    THREE.MathUtils.clamp(rgb[0] * scale, 0, 1),
    THREE.MathUtils.clamp(rgb[1] * scale, 0, 1),
    THREE.MathUtils.clamp(rgb[2] * scale, 0, 1),
  );
}

function material(color: THREE.Color | number, roughness = 0.78, metalness = 0): Mat {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function palette(item: FurnitureItem): Palette {
  const base = itemColor(item.color);
  return {
    main: material(base),
    light: material(base.clone().lerp(new THREE.Color(0xffffff), 0.24)),
    dark: material(base.clone().multiplyScalar(0.58)),
    metal: material(0x565b60, 0.4, 0.45),
    screen: material(0x18252c, 0.25, 0.18),
    leaf: material(base.clone().lerp(new THREE.Color(0x236b3b), 0.72), 0.9),
    paper: material(0xe8ddc9, 0.92),
  };
}

function box(parent: THREE.Object3D, mat: Mat, sx: number, sy: number, sz: number, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.025, sx), Math.max(0.025, sy), Math.max(0.025, sz)), mat);
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
  sides = 10,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, height, sides), mat);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function sphere(parent: THREE.Object3D, mat: Mat, radius: number, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 8, 6), mat);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function desk(parent: THREE.Object3D, p: Palette, w: number, d: number): void {
  const topW = Math.max(0.72, w * 0.9), topD = Math.max(0.55, d * 0.76);
  box(parent, p.main, topW, 0.12, topD, 0, 0.79, 0);
  const lx = Math.max(0.2, topW / 2 - 0.12), lz = Math.max(0.13, topD / 2 - 0.11);
  for (const x of [-lx, lx]) for (const z of [-lz, lz]) box(parent, p.dark, 0.1, 0.7, 0.1, x, 0.39, z);
  box(parent, p.dark, Math.min(0.42, topW * 0.28), 0.48, topD * 0.64, topW * 0.29, 0.5, 0);
}

function monitor(parent: THREE.Object3D, p: Palette, w: number, d: number): void {
  desk(parent, p, w, d);
  const sw = Math.min(0.78, Math.max(0.48, w * 0.31));
  box(parent, p.dark, sw + 0.06, 0.5, 0.07, 0, 1.14, -d * 0.13);
  box(parent, p.screen, sw, 0.4, 0.025, 0, 1.15, -d * 0.13 - 0.04);
  box(parent, p.metal, 0.07, 0.24, 0.07, 0, 0.92, -d * 0.13);
  box(parent, p.metal, 0.34, 0.035, 0.2, 0, 0.86, -d * 0.13);
  box(parent, p.light, Math.min(0.56, w * 0.27), 0.025, 0.18, 0, 0.87, d * 0.22);
}

function chair(parent: THREE.Object3D, p: Palette, w: number, d: number): void {
  const seatW = Math.min(0.68, Math.max(0.46, w * 0.64));
  const seatD = Math.min(0.62, Math.max(0.42, d * 0.48));
  box(parent, p.main, seatW, 0.14, seatD, 0, 0.55, 0.04);
  box(parent, p.main, seatW, 0.58, 0.12, 0, 0.84, -seatD / 2 + 0.03);
  cylinder(parent, p.metal, 0.055, 0.055, 0.4, 0, 0.29, 0, 8);
  for (const angle of [0, Math.PI / 2]) {
    const leg = box(parent, p.metal, 0.72, 0.05, 0.07, 0, 0.08, 0);
    leg.rotation.y = angle;
  }
  for (const [x, z] of [[-0.33, 0], [0.33, 0], [0, -0.33], [0, 0.33]] as Array<[number, number]>) {
    cylinder(parent, p.dark, 0.055, 0.055, 0.08, x, 0.04, z, 8);
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

function cabinet(parent: THREE.Object3D, p: Palette, w: number, d: number): void {
  const ww = Math.max(0.68, w * 0.82), dd = Math.max(0.48, d * 0.72), h = 1.28;
  box(parent, p.main, ww, h, dd, 0, h / 2, 0);
  box(parent, p.light, ww * 0.47, h * 0.88, 0.035, -ww * 0.245, h * 0.52, -dd / 2 - 0.018);
  box(parent, p.light, ww * 0.47, h * 0.88, 0.035, ww * 0.245, h * 0.52, -dd / 2 - 0.018);
  for (const x of [-0.055, 0.055]) box(parent, p.metal, 0.025, 0.2, 0.035, x, h * 0.55, -dd / 2 - 0.055);
}

function table(parent: THREE.Object3D, p: Palette, w: number, d: number): void {
  const ww = Math.max(1, w * 0.88), dd = Math.max(0.75, d * 0.78), y = 0.78;
  box(parent, p.main, ww, 0.16, dd, 0, y, 0);
  // A contrasting narrow rim makes a large conference table read clearly.
  box(parent, p.light, ww, 0.045, 0.055, 0, y + 0.1, -dd / 2 + 0.03);
  box(parent, p.light, ww, 0.045, 0.055, 0, y + 0.1, dd / 2 - 0.03);
  box(parent, p.light, 0.055, 0.045, dd, -ww / 2 + 0.03, y + 0.1, 0);
  box(parent, p.light, 0.055, 0.045, dd, ww / 2 - 0.03, y + 0.1, 0);
  for (const x of [-ww * 0.34, ww * 0.34]) box(parent, p.dark, 0.16, 0.7, dd * 0.58, x, 0.38, 0);
}

function sofa(parent: THREE.Object3D, p: Palette, w: number, d: number): void {
  const ww = Math.max(1.25, w * 0.88), dd = Math.max(0.7, d * 0.72);
  box(parent, p.dark, ww, 0.28, dd, 0, 0.2, 0);
  box(parent, p.main, ww, 0.72, 0.22, 0, 0.64, dd / 2 - 0.11);
  for (const x of [-ww / 2 + 0.12, ww / 2 - 0.12]) box(parent, p.main, 0.24, 0.58, dd, x, 0.43, 0);
  const cushions = Math.max(2, Math.min(5, Math.round(ww / 0.8)));
  const cw = (ww - 0.58) / cushions;
  for (let i = 0; i < cushions; i++) {
    box(parent, p.light, cw * 0.9, 0.18, dd * 0.64, -ww / 2 + 0.29 + cw * (i + 0.5), 0.47, -dd * 0.06);
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

function appliance(parent: THREE.Object3D, p: Palette, w: number, d: number): void {
  const ww = Math.max(0.65, w * 0.82), dd = Math.max(0.56, d * 0.74), h = 1.45;
  box(parent, p.main, ww, h, dd, 0, h / 2, 0);
  box(parent, p.dark, ww * 0.76, h * 0.29, 0.035, 0, h * 0.69, -dd / 2 - 0.02);
  box(parent, p.screen, ww * 0.28, h * 0.1, 0.025, ww * 0.2, h * 0.79, -dd / 2 - 0.045);
  box(parent, p.metal, ww * 0.46, 0.035, 0.035, 0, h * 0.46, -dd / 2 - 0.045);
}

function crate(parent: THREE.Object3D, p: Palette, w: number, d: number): void {
  const ww = Math.max(0.45, w * 0.76), dd = Math.max(0.45, d * 0.76), h = 0.62;
  box(parent, p.main, ww, h, dd, 0, h / 2, 0);
  box(parent, p.dark, ww, 0.07, 0.07, 0, h * 0.72, -dd / 2 - 0.01);
  box(parent, p.dark, ww, 0.07, 0.07, 0, h * 0.28, -dd / 2 - 0.01);
  box(parent, p.dark, 0.07, h, 0.07, 0, h / 2, -dd / 2 - 0.01).rotation.z = Math.PI / 5;
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
  group.userData.ownedMaterials = Object.values(p);
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

/** Dispose all GPU resources owned by a furniture group. */
export function disposeFurniture(group: THREE.Group): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    geometries.add(o.geometry);
    const own = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of own) materials.add(m);
  });
  const owned = group.userData.ownedMaterials as THREE.Material[] | undefined;
  for (const mat of owned ?? []) materials.add(mat);
  for (const geometry of geometries) geometry.dispose();
  for (const mat of materials) mat.dispose();
  group.clear();
}
