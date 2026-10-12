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
import { NameTag3D } from './NameTag3D';
import { ThoughtBubble3D } from './ThoughtBubble3D';
import { planFurniture, type FurnitureItem } from './FurniturePlanner';
import { buildFurniture, disposeFurniture } from './Furniture3D';

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
  label: string;             // name tag text
  dot?: string;              // status dot colour (CSS)
  remote?: boolean;          // a Shared Office teammate's agent: drawn, but not selectable
  thought?: { text: string; tool?: string; visible: boolean };
  glyph?: 'none' | 'blocked' | 'success' | 'compacting' | 'looping';
}

/** Draw one Tiled tile layer into a canvas (gid flip flags honoured). */
function bakeLayers(map: TiledMap, textures: Texture[], names: string[], skip?: Set<number>): HTMLCanvasElement {
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
      if (skip && name.startsWith('furniture') && skip.has(i)) continue; // replaced by a 3D model
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

/** Average opaque colour of one tileset tile, cached by gid. */
function makeAvgColor(map: TiledMap, textures: Texture[]): (gid: number) => [number, number, number] | undefined {
  const cache = new Map<number, [number, number, number] | undefined>();
  const probe = document.createElement('canvas');
  const pctx = probe.getContext('2d', { willReadFrequently: true })!;
  return (raw) => {
    const id = raw & ID_MASK;
    if (cache.has(id)) return cache.get(id);
    let out: [number, number, number] | undefined;
    for (let k = map.tilesets.length - 1; k >= 0 && !out; k--) {
      const ts = map.tilesets[k];
      if (id < ts.firstgid) continue;
      const img = (textures[k]?.source as unknown as { resource?: CanvasImageSource })?.resource;
      if (!img) break;
      const cols = ts.columns ?? 16, tw = ts.tilewidth ?? map.tilewidth, th = ts.tileheight ?? map.tileheight, local = id - ts.firstgid;
      probe.width = tw; probe.height = th;
      pctx.clearRect(0, 0, tw, th);
      pctx.drawImage(img, (local % cols) * tw, Math.floor(local / cols) * th, tw, th, 0, 0, tw, th);
      const d = pctx.getImageData(0, 0, tw, th).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
      if (n) out = [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
      break;
    }
    cache.set(id, out);
    return out;
  };
}

export class Office3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private people = new Map<string, { p: Person3D; name: string; tag: NameTag3D; bubble: ThoughtBubble3D }>();
  private ray = new THREE.Raycaster();
  private disposables: Array<{ dispose(): void }> = [];
  private ro: ResizeObserver;
  private down = { x: 0, y: 0 };
  private sun!: THREE.DirectionalLight;
  private fill!: THREE.HemisphereLight;
  private lastSky = -1;
  private furniture: THREE.Group[] = [];
  private userMoved = false;
  private mapW = 0;
  private mapH = 0;
  private home = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
  private fly: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
  private frameGap = 1 / 32;
  private sinceRender = 0;
  private renders = 0;

  constructor(
    private host: HTMLElement,
    map: TiledMap,
    textures: Texture[],
    private onSelect: (id: string) => void,
    isWalkable: (x: number, y: number) => boolean,
  ) {
    const W = map.width, H = map.height;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.autoUpdate = false; // refreshed every other render in frame()
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const el = this.renderer.domElement;
    el.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
    host.appendChild(el);

    this.scene.background = new THREE.Color(0x14110e);

    // lights: soft sky/ground fill + one sun with shadows over the whole floor plan
    this.fill = new THREE.HemisphereLight(0xfff3e2, 0xa89a88, 1.25);
    this.scene.add(this.fill);
    const sun = new THREE.DirectionalLight(0xffe8c8, 1.7);
    sun.position.set(W / 2 - 14, 34, H / 2 + 20);
    sun.target.position.set(W / 2, 0, H / 2);
    sun.castShadow = true;
    this.sun = sun;
    sun.shadow.mapSize.set(1024, 1024); // 4 MB depth map instead of 9 MB; plenty for soft office shadows
    const sc = sun.shadow.camera;
    sc.left = -38; sc.right = 38; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 120;
    sun.shadow.bias = -0.0004;
    this.scene.add(sun, sun.target);

    // plan real 3D furniture; tiles it covers are left out of the flat ground art and of the generic blocks
    let items: FurnitureItem[] = [];
    try { items = planFurniture(map, isWalkable, makeAvgColor(map, textures)); } catch (err) { console.error('[Office3D] furniture planning failed', err); }
    const covered = new Set<number>();
    for (const it of items) for (const [tx, ty] of it.tiles) covered.add(ty * W + tx);

    // ground: floor + remaining furniture art baked flat, so the 3D floor matches the 2D map
    const groundTex = pixelTexture(bakeLayers(map, textures, ['floor', 'furniture-below', 'furniture-above'], covered), this.renderer);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(W, H),
      new THREE.MeshStandardMaterial({ map: groundTex, color: 0xfff0dc, roughness: 0.95 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(W / 2, 0, H / 2);
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.disposables.push(groundTex, ground.geometry, ground.material as THREE.Material);

    // a thick base slab so the floor plan reads as a solid model, not a sheet
    const slab = new THREE.Mesh(new THREE.BoxGeometry(W + 1, 0.6, H + 1), new THREE.MeshStandardMaterial({ color: 0x2a2520, roughness: 1 }));
    slab.position.set(W / 2, -0.31, H / 2);
    slab.receiveShadow = true;
    this.scene.add(slab);
    this.disposables.push(slab.geometry, slab.material as THREE.Material);

    this.buildWalls(map, textures);
    this.buildFurniture(map, textures, isWalkable, covered);
    for (const it of items) {
      const g = buildFurniture(it);
      g.position.set(it.x, 0, it.z);
      this.scene.add(g);
      this.furniture.push(g);
    }

    this.camera = new THREE.PerspectiveCamera(36, 1, 0.5, 300);
    this.camera.position.set(W / 2, 38, H / 2 + 27);
    this.controls = new OrbitControls(this.camera, el);
    this.controls.target.set(W / 2, 0, H / 2);
    this.controls.enableDamping = true;
    this.controls.minDistance = 10; this.controls.maxDistance = 85;
    this.controls.minPolarAngle = 0.15; this.controls.maxPolarAngle = 1.3;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('dblclick', this.onDbl);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.mapW = W; this.mapH = H;
    this.fitCamera(W, H);
    this.controls.addEventListener('start', () => { this.userMoved = true; });
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

  /** Blocking furniture tiles become low blocks: art on top, the art's average colour on the sides. */
  private buildFurniture(map: TiledMap, textures: Texture[], isWalkable: (x: number, y: number) => boolean, covered: Set<number>): void {
    const W = map.width, H = map.height;
    const art = bakeLayers(map, textures, ['furniture-below', 'furniture-above'], covered);
    const actx = art.getContext('2d', { willReadFrequently: true })!;
    const topTex = pixelTexture(art, this.renderer);
    topTex.premultiplyAlpha = false;
    const gid = (name: string, x: number, y: number) => {
      const l = map.layers.find((q) => q.name === name && q.type === 'tilelayer');
      return ((l?.data?.[y * W + x] ?? 0) & ID_MASK) !== 0;
    };
    const tpx = map.tilewidth * SRC_SCALE;
    const topPos: number[] = [], topUv: number[] = [];
    const sidePos: number[] = [], sideCol: number[] = [];
    const quad = (pos: number[], q: number[][]) => { for (const i of [0, 1, 2, 0, 2, 3]) pos.push(...q[i]); };
    const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && !covered.has(y * W + x) && gid('furniture-below', x, y) && !isWalkable(x, y);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!solid(x, y)) continue;
      // average opaque colour of the tile (furniture-above on top of it included)
      const px = actx.getImageData(x * tpx, y * tpx, tpx, tpx).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 200) { r += px[i]; g += px[i + 1]; b += px[i + 2]; n++; }
      const avg = n ? new THREE.Color(r / n / 255, g / n / 255, b / n / 255).convertSRGBToLinear() : WALL_SIDE;
      const lit = avg.clone().multiplyScalar(0.8), dark = avg.clone().multiplyScalar(0.5);
      const h = 0.85;
      quad(topPos, [[x, h, y], [x, h, y + 1], [x + 1, h, y + 1], [x + 1, h, y]]);
      const u0 = x / W, u1 = (x + 1) / W, v0 = 1 - y / H, v1 = 1 - (y + 1) / H;
      for (const [u, v] of [[u0, v0], [u0, v1], [u1, v1], [u0, v0], [u1, v1], [u1, v0]]) topUv.push(u, v);
      const sides: Array<[boolean, number[][]]> = [
        [!solid(x, y + 1), [[x, 0, y + 1], [x + 1, 0, y + 1], [x + 1, h, y + 1], [x, h, y + 1]]],
        [!solid(x, y - 1), [[x + 1, 0, y], [x, 0, y], [x, h, y], [x + 1, h, y]]],
        [!solid(x + 1, y), [[x + 1, 0, y + 1], [x + 1, 0, y], [x + 1, h, y], [x + 1, h, y + 1]]],
        [!solid(x - 1, y), [[x, 0, y], [x, 0, y + 1], [x, h, y + 1], [x, h, y]]],
      ];
      for (const [open, q] of sides) {
        if (!open) continue;
        quad(sidePos, q);
        for (const i of [0, 1, 2, 0, 2, 3]) { const c = q[i][1] === 0 ? dark : lit; sideCol.push(c.r, c.g, c.b); }
      }
    }
    if (!topPos.length) { topTex.dispose(); return; }
    const topGeo = new THREE.BufferGeometry();
    topGeo.setAttribute('position', new THREE.Float32BufferAttribute(topPos, 3));
    topGeo.setAttribute('uv', new THREE.Float32BufferAttribute(topUv, 2));
    topGeo.computeVertexNormals();
    const sideGeo = new THREE.BufferGeometry();
    sideGeo.setAttribute('position', new THREE.Float32BufferAttribute(sidePos, 3));
    sideGeo.setAttribute('color', new THREE.Float32BufferAttribute(sideCol, 3));
    sideGeo.computeVertexNormals();
    // the top shows the furniture art over the already-baked floor, so alpha cut-out keeps floor visible around it
    const topMat = new THREE.MeshStandardMaterial({ map: topTex, alphaTest: 0.5, roughness: 0.85 });
    const sideMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    for (const m of [new THREE.Mesh(topGeo, topMat), new THREE.Mesh(sideGeo, sideMat)]) {
      m.castShadow = true; m.receiveShadow = true; this.scene.add(m);
    }
    this.disposables.push(topTex, topGeo, sideGeo, topMat, sideMat);
  }

  /** Start framed so the whole floor plan fits at any window shape (the user can orbit/zoom after). */
  private fitCamera(W: number, H: number): void {
    const vf = THREE.MathUtils.degToRad(this.camera.fov);
    const hf = 2 * Math.atan(Math.tan(vf / 2) * this.camera.aspect);
    const d = THREE.MathUtils.clamp(Math.max((W * 0.56) / Math.tan(hf / 2), (H * 0.66) / Math.tan(vf / 2)), 20, 85);
    const polar = 0.88;
    this.camera.position.set(W / 2, d * Math.cos(polar), H / 2 + d * Math.sin(polar));
    this.controls.update();
    this.home.pos.copy(this.camera.position);
    this.home.target.copy(this.controls.target);
  }

  /** Warm daylight that follows the clock: low amber sun at dawn/dusk, bright at noon, dim but readable at night.
   *  Runs at most once a minute and only mutates existing lights, so it costs nothing per frame. */
  private applyTimeOfDay(): void {
    const now = new Date(), minute = now.getHours() * 60 + now.getMinutes();
    if (minute === this.lastSky) return;
    this.lastSky = minute;
    const day = Math.max(0, Math.sin(((minute / 60 - 6) / 12) * Math.PI)); // 0 at 06:00 and 18:00, 1 at noon
    const warm = 1 - Math.min(1, day * 2.2); // 1 near the horizon, 0 once the sun is high
    this.sun.intensity = 0.6 + 1.2 * day;
    this.sun.color.setRGB(1, 0.93 - 0.28 * warm, 0.8 - 0.4 * warm);
    this.sun.position.y = 12 + 22 * day;
    this.fill.intensity = 1.0 + 0.45 * day;
    (this.scene.background as THREE.Color).setRGB(0.08 + 0.04 * day, 0.065 + 0.03 * day, 0.055 + 0.025 * day);
  }

  /** Low = cheaper machines: no shadows, 1x pixels, ~20fps. */
  setQuality(q: 'high' | 'low'): void {
    this.sun.castShadow = q === 'high';
    if (q === 'low') { this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; } // free the shadow map's GPU memory
    this.renderer.setPixelRatio(q === 'high' ? Math.min(window.devicePixelRatio || 1, 1.5) : 1);
    this.frameGap = q === 'high' ? 1 / 32 : 1 / 21;
    this.resize();
  }

  /** Double-click empty floor: fly back to the starting view. */
  private onDbl = () => { this.fly = { pos: this.home.pos.clone(), target: this.home.target.clone() }; };

  private resize(): void {
    const w = this.host.clientWidth || 800, h = this.host.clientHeight || 600;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (!this.userMoved && this.mapW) this.fitCamera(this.mapW, this.mapH);
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
      if (o) {
        if (!o.userData.remote) this.onSelect(o.userData.agentId as string);
        const t = o.position.clone().setY(1);
        const off = this.camera.position.clone().sub(this.controls.target).setLength(Math.min(22, this.camera.position.distanceTo(this.controls.target)));
        this.fly = { pos: t.clone().add(off), target: t };
        return;
      }
    }
  };

  /** Called every simulation tick with the current state of everyone on the floor. */
  frame(list: Person3DState[], dt: number): void {
    const seen = new Set<string>();
    for (const s of list) {
      seen.add(s.id);
      let e = this.people.get(s.id);
      if (!e || e.name !== s.name) {
        if (e) { this.scene.remove(e.p.group); e.p.dispose(); e.tag.dispose(); e.bubble.dispose(); }
        const p = new Person3D(personLook(s.name as OfficeCharacterName));
        p.group.userData.agentId = s.id;
        p.group.userData.remote = !!s.remote;
        const tag = new NameTag3D();
        p.group.add(tag.sprite);
        const bubble = new ThoughtBubble3D();
        bubble.sprite.scale.multiplyScalar(0.5);
        p.group.add(bubble.sprite);
        this.scene.add(p.group);
        e = { p, name: s.name, tag, bubble };
        this.people.set(s.id, e);
      }
      e.p.group.visible = s.visible;
      e.tag.set(s.label, s.dot);
      if (s.visible && s.thought?.visible) e.bubble.show(s.thought.text, s.thought.tool, s.glyph); else e.bubble.hide();
      e.bubble.update(dt);
      e.p.group.position.set(s.x / 16, 0, s.y / 16);
      e.p.setPose(s.sitting && s.anim === 'idle' ? 'sit' : s.sitting && s.anim === 'walk' ? 'sit' : s.anim, s.dir);
      e.p.update(dt);
    }
    for (const [id, e] of this.people) {
      if (seen.has(id)) continue;
      this.scene.remove(e.p.group); e.p.dispose(); e.tag.dispose(); e.bubble.dispose(); this.people.delete(id);
    }
    // ponytail: render at ~30fps and refresh shadows every 2nd render; people animate at 60 via update(dt).
    this.sinceRender += dt;
    if (this.sinceRender < this.frameGap) return;
    if (this.fly) {
      const k = 1 - Math.exp(-this.sinceRender * 7);
      this.camera.position.lerp(this.fly.pos, k); this.controls.target.lerp(this.fly.target, k);
      if (this.camera.position.distanceTo(this.fly.pos) < 0.05) this.fly = null;
    }
    this.sinceRender = 0;
    this.applyTimeOfDay();
    this.renderer.shadowMap.needsUpdate = this.renders++ % 2 === 0;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.ro.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointerup', this.onUp);
    el.removeEventListener('dblclick', this.onDbl);
    this.controls.dispose();
    for (const e of this.people.values()) { e.p.dispose(); e.tag.dispose(); e.bubble.dispose(); }
    for (const g of this.furniture) disposeFurniture(g);
    this.people.clear();
    for (const d of this.disposables) d.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    el.remove();
  }
}
