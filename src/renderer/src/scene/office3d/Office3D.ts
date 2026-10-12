// Optional 3D view of the office. The 2D (Pixi) scene stays the simulation: it owns pathfinding,
// desks, and who is doing what. This class only draws the same map and people in three.js.
// World units = tiles (1 unit = 16px). x east, z south, y up.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Texture } from 'pixi.js';
import type { TiledMap } from '../office/TiledMapRenderer';
import type { OfficeCharacterName } from '../office/cast';
import { personLook } from '../office/portraitArt';
import { Person3D } from './Person3D';

const FLIP_H = 0x80000000, FLIP_V = 0x40000000, FLIP_D = 0x20000000, ID_MASK = 0x1fffffff;
const SRC_SCALE = 3;        // canvas pixels per source pixel for the baked layer textures
const WALL_HEIGHT = 1.5;    // half-height "dollhouse" walls so rooms stay visible from above
const WALL_SIDE = new THREE.Color(0xe7e3da);
const WALL_SIDE_SHADE = new THREE.Color(0xc9c4b8);

export interface Person3DState {
  id: string;
  name: string;
  x: number; y: number;      // feet position in map pixels
  anim: 'idle' | 'walk' | 'type' | 'read';
  dir: 'down' | 'up' | 'left' | 'right';
  sitting: boolean;
  visible: boolean;
}

/** Draw one Tiled tile layer into a canvas (gid flip flags honoured). */
function bakeLayers(map: TiledMap, textures: Texture[], names: string[]): HTMLCanvasElement {
  const tw = map.tilewidth, th = map.tileheight;
  const c = document.createElement('canvas');
  c.width = map.width * tw * SRC_SCALE; c.height = map.height * th * SRC_SCALE;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  for (const name of names) {
    const layer = map.layers.find((l) => l.name === name && l.type === 'tilelayer');
    if (!layer?.data) continue;
    for (let i = 0; i < layer.data.length; i++) {
      const raw = layer.data[i] >>> 0;
      const id = raw & ID_MASK;
      if (!id) continue;
      let ti = -1;
      for (let k = map.tilesets.length - 1; k >= 0; k--) if (id >= map.tilesets[k].firstgid) { ti = k; break; }
      if (ti < 0) continue;
      const ts = map.tilesets[ti];
      const img = (textures[ti]?.source as unknown as { resource?: CanvasImageSource })?.resource;
      if (!img) continue;
      const cols = ts.columns ?? 16, stw = ts.tilewidth ?? tw, sth = ts.tileheight ?? th;
      const local = id - ts.firstgid;
      const w = tw * SRC_SCALE, h = th * SRC_SCALE;
      ctx.save();
      ctx.translate(((i % map.width) + 0.5) * w, (Math.floor(i / map.width) + 0.5) * h);
      if (raw & FLIP_H) ctx.scale(-1, 1);
      if (raw & FLIP_V) ctx.scale(1, -1);
      if (raw & FLIP_D) ctx.transform(0, 1, 1, 0, 0, 0);
      ctx.drawImage(img, (local % cols) * stw, Math.floor(local / cols) * sth, stw, sth, -w / 2, -h / 2, w, h);
      ctx.restore();
    }
  }
  return c;
}

function pixelTexture(c: HTMLCanvasElement, renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

export class Office3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private people = new Map<string, { p: Person3D; name: string }>();
  private ray = new THREE.Raycaster();
  private disposables: Array<{ dispose(): void }> = [];
  private ro: ResizeObserver;
  private down = { x: 0, y: 0 };

  constructor(
    private host: HTMLElement,
    map: TiledMap,
    textures: Texture[],
    private onSelect: (id: string) => void,
  ) {
    const W = map.width, H = map.height;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const el = this.renderer.domElement;
    el.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
    host.appendChild(el);

    this.scene.background = new THREE.Color(0x0b0d10);

    // lights: soft sky/ground fill + one sun with shadows over the whole floor plan
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8d8a86, 1.15));
    const sun = new THREE.DirectionalLight(0xfff4e4, 1.5);
    sun.position.set(W / 2 - 14, 34, H / 2 + 20);
    sun.target.position.set(W / 2, 0, H / 2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -38; sc.right = 38; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 120;
    sun.shadow.bias = -0.0004;
    this.scene.add(sun, sun.target);

    // ground: floor + furniture art baked flat, so the 3D floor matches the 2D map
    const groundTex = pixelTexture(bakeLayers(map, textures, ['floor', 'furniture-below', 'furniture-above']), this.renderer);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(W, H),
      new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(W / 2, 0, H / 2);
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.disposables.push(groundTex, ground.geometry, ground.material as THREE.Material);

    this.buildWalls(map, textures);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 300);
    this.camera.position.set(W / 2, 40, H / 2 + 30);
    this.controls = new OrbitControls(this.camera, el);
    this.controls.target.set(W / 2, 0, H / 2);
    this.controls.enableDamping = true;
    this.controls.minDistance = 10; this.controls.maxDistance = 85;
    this.controls.minPolarAngle = 0.15; this.controls.maxPolarAngle = 1.3;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointerup', this.onUp);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
  }

  /** Extrude every wall-layer tile into a low block: tile art on top, plaster on the sides. */
  private buildWalls(map: TiledMap, textures: Texture[]): void {
    const layer = map.layers.find((l) => l.name === 'walls' && l.type === 'tilelayer');
    if (!layer?.data) return;
    const W = map.width, H = map.height;
    const has = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && ((layer.data![y * W + x] ?? 0) & ID_MASK) !== 0;
    const topTex = pixelTexture(bakeLayers(map, textures, ['walls']), this.renderer);
    const topPos: number[] = [], topUv: number[] = [];
    const sidePos: number[] = [], sideCol: number[] = [];
    const quad = (pos: number[], q: number[][]) => { for (const i of [0, 1, 2, 0, 2, 3]) pos.push(...q[i]); };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!has(x, y)) continue;
      const h = WALL_HEIGHT;
      quad(topPos, [[x, h, y], [x, h, y + 1], [x + 1, h, y + 1], [x + 1, h, y]]);
      const u0 = x / W, u1 = (x + 1) / W, v0 = 1 - y / H, v1 = 1 - (y + 1) / H;
      for (const [u, v] of [[u0, v0], [u0, v1], [u1, v1], [u0, v0], [u1, v1], [u1, v0]]) topUv.push(u, v);
      const sides: Array<[boolean, number[][]]> = [
        [!has(x, y + 1), [[x, 0, y + 1], [x + 1, 0, y + 1], [x + 1, h, y + 1], [x, h, y + 1]]], // south
        [!has(x, y - 1), [[x + 1, 0, y], [x, 0, y], [x, h, y], [x + 1, h, y]]],                 // north
        [!has(x + 1, y), [[x + 1, 0, y + 1], [x + 1, 0, y], [x + 1, h, y], [x + 1, h, y + 1]]], // east
        [!has(x - 1, y), [[x, 0, y], [x, 0, y + 1], [x, h, y + 1], [x, h, y]]],                 // west
      ];
      for (const [open, q] of sides) {
        if (!open) continue;
        quad(sidePos, q);
        for (const i of [0, 1, 2, 0, 2, 3]) {
          const c = q[i][1] === 0 ? WALL_SIDE_SHADE : WALL_SIDE; // darker at the base
          sideCol.push(c.r, c.g, c.b);
        }
      }
    }
    const topGeo = new THREE.BufferGeometry();
    topGeo.setAttribute('position', new THREE.Float32BufferAttribute(topPos, 3));
    topGeo.setAttribute('uv', new THREE.Float32BufferAttribute(topUv, 2));
    topGeo.computeVertexNormals();
    const sideGeo = new THREE.BufferGeometry();
    sideGeo.setAttribute('position', new THREE.Float32BufferAttribute(sidePos, 3));
    sideGeo.setAttribute('color', new THREE.Float32BufferAttribute(sideCol, 3));
    sideGeo.computeVertexNormals();
    const topMat = new THREE.MeshStandardMaterial({ map: topTex, alphaTest: 0.5, roughness: 0.9 });
    const sideMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    const top = new THREE.Mesh(topGeo, topMat);
    const sides = new THREE.Mesh(sideGeo, sideMat);
    for (const m of [top, sides]) { m.castShadow = true; m.receiveShadow = true; this.scene.add(m); }
    this.disposables.push(topTex, topGeo, sideGeo, topMat, sideMat);
  }

  private resize(): void {
    const w = this.host.clientWidth || 800, h = this.host.clientHeight || 600;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private onDown = (e: PointerEvent) => { this.down = { x: e.clientX, y: e.clientY }; };
  private onUp = (e: PointerEvent) => {
    if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 5) return; // it was a drag
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    const hits = this.ray.intersectObjects([...this.people.values()].map((v) => v.p.group), true);
    for (const hit of hits) {
      let o: THREE.Object3D | null = hit.object;
      while (o && o.userData.agentId === undefined) o = o.parent;
      if (o) { this.onSelect(o.userData.agentId as string); return; }
    }
  };

  /** Called every simulation tick with the current state of everyone on the floor. */
  frame(list: Person3DState[], dt: number): void {
    const seen = new Set<string>();
    for (const s of list) {
      seen.add(s.id);
      let e = this.people.get(s.id);
      if (!e || e.name !== s.name) {
        if (e) { this.scene.remove(e.p.group); e.p.dispose(); }
        const p = new Person3D(personLook(s.name as OfficeCharacterName));
        p.group.userData.agentId = s.id;
        this.scene.add(p.group);
        e = { p, name: s.name };
        this.people.set(s.id, e);
      }
      e.p.group.visible = s.visible;
      e.p.group.position.set(s.x / 16, 0, s.y / 16);
      e.p.setPose(s.sitting && s.anim === 'idle' ? 'sit' : s.sitting && s.anim === 'walk' ? 'sit' : s.anim, s.dir);
      e.p.update(dt);
    }
    for (const [id, e] of this.people) {
      if (seen.has(id)) continue;
      this.scene.remove(e.p.group); e.p.dispose(); this.people.delete(id);
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.ro.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointerup', this.onUp);
    this.controls.dispose();
    for (const e of this.people.values()) e.p.dispose();
    this.people.clear();
    for (const d of this.disposables) d.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    el.remove();
  }
}
