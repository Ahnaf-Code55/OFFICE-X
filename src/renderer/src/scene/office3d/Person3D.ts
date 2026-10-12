import * as THREE from 'three';
import type { PersonLook } from '../office/portraitArt';

type RGB = [number, number, number];

interface RigPose {
  hipY: number; bodyY: number; bodyScaleY: number; headX: number;
  armLX: number; armRX: number; elbowLX: number; elbowRX: number;
  legLX: number; legRX: number; kneeLX: number; kneeRX: number;
}

const DIRECTIONS: Record<'down' | 'up' | 'left' | 'right', number> = {
  down: 0, up: Math.PI, right: Math.PI / 2, left: -Math.PI / 2,
};

const BASE: RigPose = {
  hipY: 0.76, bodyY: 0, bodyScaleY: 1, headX: 0,
  armLX: 0, armRX: 0, elbowLX: 0, elbowRX: 0,
  legLX: 0, legRX: 0, kneeLX: 0, kneeRX: 0,
};

/** A compact, procedural office character. One world unit equals one 16 px tile. */
export class Person3D {
  readonly group: THREE.Group = new THREE.Group();

  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly geometryCache = new Map<string, THREE.BufferGeometry>();
  private readonly materials = new Set<THREE.Material>();
  private readonly body = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly elbowL = new THREE.Group();
  private readonly elbowR = new THREE.Group();
  private readonly legL = new THREE.Group();
  private readonly legR = new THREE.Group();
  private readonly kneeL = new THREE.Group();
  private readonly kneeR = new THREE.Group();
  private pose: 'idle' | 'walk' | 'type' | 'read' | 'sit' = 'idle';
  private elapsed = 0;

  constructor(look: PersonLook) {
    this.group.name = 'Person3D';
    this.group.add(this.body);
    this.buildBody(look);
    this.applyRig(BASE, 1);
  }

  setPose(pose: 'idle' | 'walk' | 'type' | 'read' | 'sit', dir: 'down' | 'up' | 'left' | 'right'): void {
    this.pose = pose;
    this.group.userData.targetRotationY = DIRECTIONS[dir];
  }

  update(dtSeconds: number): void {
    const dt = Math.min(Math.max(dtSeconds, 0), 0.1);
    this.elapsed += dt;
    const blend = 1 - Math.exp(-10 * dt);
    const targetRotation = (this.group.userData.targetRotationY as number | undefined) ?? 0;
    let turn = targetRotation - this.group.rotation.y;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    this.group.rotation.y += turn * blend;

    const p = { ...BASE };
    const phase = this.elapsed * 8;
    if (this.pose === 'walk') {
      const swing = Math.sin(phase) * 0.62;
      p.legLX = swing; p.legRX = -swing;
      p.armLX = -swing * 0.72; p.armRX = swing * 0.72;
      p.kneeLX = Math.max(0, -swing) * 0.42;
      p.kneeRX = Math.max(0, swing) * 0.42;
      p.bodyY = Math.abs(Math.sin(phase)) * 0.035;
      p.headX = Math.sin(phase) * 0.025;
    } else if (this.pose === 'idle') {
      p.bodyScaleY = 1 + Math.sin(this.elapsed * 2.1) * 0.012;
      p.bodyY = Math.sin(this.elapsed * 2.1) * 0.008;
    } else if (this.pose === 'type') {
      p.armLX = p.armRX = -0.78;
      p.elbowLX = -1.15 + Math.sin(phase * 1.3) * 0.08;
      p.elbowRX = -1.15 + Math.sin(phase * 1.3 + 1.7) * 0.08;
      p.headX = 0.1;
    } else if (this.pose === 'read') {
      p.headX = 0.25; p.armLX = -0.55; p.elbowLX = -1.35;
      p.armRX = 0.08; p.elbowRX = -0.35;
    } else {
      p.hipY = 0.88; p.legLX = p.legRX = -1.18;
      p.kneeLX = p.kneeRX = 1.18; p.armLX = p.armRX = -0.18;
    }
    this.applyRig(p, blend);
  }

  dispose(): void {
    this.geometries.forEach((geometry) => geometry.dispose());
    this.materials.forEach((material) => material.dispose());
    this.geometries.clear(); this.geometryCache.clear(); this.materials.clear();
    this.group.clear();
  }

  private geometry(key: string, factory: () => THREE.BufferGeometry): THREE.BufferGeometry {
    const existing = this.geometryCache.get(key);
    if (existing) return existing;
    const geometry = factory();
    this.geometryCache.set(key, geometry);
    this.geometries.add(geometry);
    return geometry;
  }

  private material(rgb: RGB, roughness = 0.78): THREE.MeshStandardMaterial {
    const color = new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
    const material = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
    this.materials.add(material);
    return material;
  }

  private mesh(geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D,
    position: [number, number, number], scale?: [number, number, number]): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    if (scale) mesh.scale.set(...scale);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private sphere(key: string, radius: number, segments = 10): THREE.BufferGeometry {
    return this.geometry(key, () => new THREE.SphereGeometry(radius, segments, Math.max(6, segments - 2)));
  }

  private capsule(key: string, radius: number, length: number): THREE.BufferGeometry {
    return this.geometry(key, () => new THREE.CapsuleGeometry(radius, length, 4, 8));
  }

  private tapered(key: string, top: number, bottom: number, length: number): THREE.BufferGeometry {
    return this.geometry(key, () => new THREE.CylinderGeometry(top, bottom, length, 8, 1));
  }

  private buildBody(look: PersonLook): void {
    const skin = this.material(look.skin, 0.88);
    const hair = this.material(look.hair, 0.92);
    const shirt = this.material(look.shirt, 0.86);
    const shirt2 = this.material(look.shirt2 ?? [238, 238, 232], 0.84);
    const pants = this.material(look.pants, 0.9);
    const sole = this.material([25, 27, 31], 0.72);
    const leather = this.material([49, 38, 34], 0.68);
    const white = this.material([244, 242, 235], 0.55);
    const pupil = this.material([22, 19, 18], 0.5);
    const mouth = this.material([133, 62, 64], 0.72);
    const width = look.heavy ? 1.18 : 1;

    this.body.position.y = BASE.hipY;
    this.torso.position.y = 0.30;
    this.body.add(this.torso);

    const torsoShape = this.tapered('torso', 0.25, 0.205, 0.54);
    this.mesh(torsoShape, shirt, this.torso, [0, 0.08, 0], [width, 1, look.heavy ? 1.14 : 0.88]);
    const shoulders = this.mesh(this.capsule('shoulders', 0.105, 0.42), shirt, this.torso, [0, 0.28, 0], [width, 1, 0.9]);
    shoulders.rotation.z = Math.PI / 2;
    this.addClothing(look, width, shirt, shirt2, leather);

    this.head.position.set(0, 0.68, 0);
    this.torso.add(this.head);
    this.mesh(this.tapered('neck', 0.085, 0.095, 0.15), skin, this.torso, [0, 0.46, 0]);
    this.mesh(this.sphere('head', 0.27, 14), skin, this.head, [0, 0, 0],
      [look.heavy ? 1.04 : 0.94, look.heavy ? 0.97 : 1.04, 0.91]);
    this.mesh(this.sphere('ear', 0.052, 8), skin, this.head, [-0.245, 0, 0]);
    this.mesh(this.sphere('ear', 0.052, 8), skin, this.head, [0.245, 0, 0]);
    this.addFace(look, skin, hair, white, pupil, mouth);

    this.armL.position.set(-0.31 * width, 0.25, 0);
    this.armR.position.set(0.31 * width, 0.25, 0);
    this.torso.add(this.armL, this.armR);
    this.buildArm(this.armL, this.elbowL, -1, shirt, skin);
    this.buildArm(this.armR, this.elbowR, 1, shirt, skin);

    this.legL.position.set(-0.13, 0, 0);
    this.legR.position.set(0.13, 0, 0);
    this.body.add(this.legL, this.legR);
    this.buildLeg(this.legL, this.kneeL, pants, sole);
    this.buildLeg(this.legR, this.kneeR, pants, sole);
  }

  private buildArm(upper: THREE.Group, elbow: THREE.Group, side: -1 | 1,
    cloth: THREE.Material, skin: THREE.Material): void {
    this.mesh(this.tapered('upperArm', 0.09, 0.075, 0.34), cloth, upper, [0, -0.18, 0]);
    elbow.position.y = -0.35; upper.add(elbow);
    this.mesh(this.sphere('jointSmall', 0.078, 8), skin, elbow, [0, 0, 0], [1, 0.9, 1]);
    this.mesh(this.tapered('forearm', 0.073, 0.062, 0.27), skin, elbow, [0, -0.15, 0]);
    const palm = this.mesh(this.sphere('palm', 0.082, 9), skin, elbow, [0, -0.32, 0.015], [0.9, 1.12, 0.72]);
    palm.rotation.x = -0.08;
    const thumb = this.mesh(this.capsule('thumb', 0.025, 0.065), skin, elbow, [side * 0.065, -0.30, 0.035], [1, 1, 0.8]);
    thumb.rotation.z = side * 0.72;
  }

  private buildLeg(upper: THREE.Group, knee: THREE.Group, pants: THREE.Material, shoe: THREE.Material): void {
    this.mesh(this.tapered('thigh', 0.12, 0.10, 0.36), pants, upper, [0, -0.18, 0]);
    knee.position.y = -0.36; upper.add(knee);
    this.mesh(this.sphere('knee', 0.102, 8), pants, knee, [0, 0, 0], [1, 0.82, 1]);
    this.mesh(this.tapered('shin', 0.095, 0.075, 0.30), pants, knee, [0, -0.17, 0]);
    const foot = this.mesh(this.geometry('shoe', () => new THREE.CapsuleGeometry(0.085, 0.18, 3, 8)),
      shoe, knee, [0, -0.34, 0.075], [1.1, 0.72, 1.3]);
    foot.rotation.x = Math.PI / 2;
    this.mesh(this.geometry('sole', () => new THREE.BoxGeometry(0.19, 0.035, 0.31)), shoe, knee, [0, -0.405, 0.08]);
  }

  private addClothing(look: PersonLook, width: number, outer: THREE.Material,
    inner: THREE.Material, leather: THREE.Material): void {
    if (look.cloth === 'suit' || look.cloth === 'cardigan') {
      const panel = this.geometry('jacketPanel', () => new THREE.BoxGeometry(0.20, 0.43, 0.035));
      this.mesh(panel, outer, this.torso, [-0.12 * width, 0.06, 0.235]);
      this.mesh(panel, outer, this.torso, [0.12 * width, 0.06, 0.235]);
      this.mesh(this.geometry('shirtFront', () => new THREE.BoxGeometry(0.14, 0.38, 0.038)), inner, this.torso, [0, 0.07, 0.254]);
    }
    if (look.cloth === 'polo' || look.cloth === 'dressshirt') {
      const collar = this.geometry('collar', () => new THREE.BoxGeometry(0.13, 0.12, 0.032));
      const left = this.mesh(collar, inner, this.torso, [-0.055, 0.27, 0.225]);
      const right = this.mesh(collar, inner, this.torso, [0.055, 0.27, 0.225]);
      left.rotation.z = -0.48; right.rotation.z = 0.48;
    } else if (look.cloth === 'blouse') {
      this.mesh(this.sphere('brooch', 0.052, 8), inner, this.torso, [0, 0.23, 0.235], [1, 0.72, 0.35]);
    } else if (look.cloth === 'sweater') {
      this.mesh(this.geometry('sweaterCollar', () => new THREE.TorusGeometry(0.12, 0.025, 6, 12)),
        inner, this.torso, [0, 0.31, 0.08]).rotation.x = Math.PI / 2;
    }

    this.mesh(this.geometry('belt', () => new THREE.CylinderGeometry(0.213, 0.213, 0.055, 12)),
      leather, this.torso, [0, -0.205, 0], [width, 1, look.heavy ? 1.14 : 0.88]);
    this.mesh(this.geometry('buckle', () => new THREE.BoxGeometry(0.075, 0.06, 0.025)),
      inner, this.torso, [0, -0.205, 0.225]);

    if (look.tie && (look.cloth === 'suit' || look.cloth === 'dressshirt')) {
      const tie = this.material(look.tie, 0.78);
      const knot = this.mesh(this.geometry('tieKnot', () => new THREE.CylinderGeometry(0.038, 0.055, 0.075, 4)),
        tie, this.torso, [0, 0.225, 0.264]);
      knot.rotation.z = Math.PI / 4;
      this.mesh(this.geometry('tie', () => new THREE.BoxGeometry(0.065, 0.23, 0.028)), tie, this.torso, [0, 0.075, 0.267]);
    }
  }

  private addFace(look: PersonLook, skin: THREE.Material, hair: THREE.Material,
    white: THREE.Material, pupil: THREE.Material, mouth: THREE.Material): void {
    for (const x of [-0.085, 0.085]) {
      this.mesh(this.sphere('eyeWhite', 0.038, 9), white, this.head, [x, 0.035, 0.242], [1, 0.78, 0.42]);
      this.mesh(this.sphere('pupil', 0.017, 8), pupil, this.head, [x, 0.034, 0.263], [1, 1, 0.48]);
      const brow = this.mesh(this.geometry('brow', () => new THREE.CapsuleGeometry(0.009, 0.065, 2, 6)),
        hair, this.head, [x, 0.105, 0.245]);
      brow.rotation.z = Math.PI / 2 + (x < 0 ? -0.08 : 0.08);
      if (look.lashes) {
        const lash = this.mesh(this.geometry('lash', () => new THREE.BoxGeometry(0.078, 0.009, 0.009)),
          hair, this.head, [x, 0.065, 0.261]);
        lash.rotation.z = x < 0 ? -0.06 : 0.06;
      }
    }
    const nose = this.mesh(this.geometry('nose', () => new THREE.ConeGeometry(0.032, 0.075, 7)),
      skin, this.head, [0, -0.025, 0.273]);
    nose.rotation.x = Math.PI / 2;
    const smile = this.mesh(this.geometry('smile', () => new THREE.TorusGeometry(0.057, 0.009, 5, 12, Math.PI)),
      mouth, this.head, [0, -0.102, 0.253]);
    smile.rotation.z = Math.PI;
    this.addHair(look, hair);
    if (look.glasses) this.addGlasses();
    if (look.facial) this.addFacialHair(look.facial, hair);
  }

  private addHair(look: PersonLook, material: THREE.Material): void {
    const style = look.hairStyle;
    if (style !== 'styleBald') {
      const crown = this.mesh(this.geometry('hairCrown', () => new THREE.SphereGeometry(0.275, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2)),
        material, this.head, [0, 0.025, -0.005]);
      const crownHeight = style === 'styleSpiky' ? 1.12 : style === 'styleRecede' ? 0.62 : 0.84;
      crown.scale.set(1.01, crownHeight, 1.01);
    }

    if (style === 'styleFrame' || style === 'styleMessy') {
      const length = THREE.MathUtils.clamp((look.hairLength ?? 16) / 28, 0.38, 0.72);
      for (const x of [-0.235, 0.235]) {
        const side = this.mesh(this.capsule('longHair', 0.075, length), material, this.head,
          [x, -length / 2 + 0.08, -0.015]);
        side.rotation.z = x < 0 ? -0.05 : 0.05;
      }
      if (style === 'styleMessy') {
        for (const x of [-0.15, 0, 0.15]) {
          const tuft = this.mesh(this.geometry('messyTuft', () => new THREE.ConeGeometry(0.055, 0.16, 6)),
            material, this.head, [x, 0.265 + Math.abs(x) * 0.12, -0.02]);
          tuft.rotation.z = -x * 1.5;
        }
      }
    } else if (style === 'styleBun') {
      this.mesh(this.sphere('bun', 0.155, 10), material, this.head, [0, 0.18, -0.20], [1, 1.08, 0.92]);
      this.mesh(this.capsule('bunTail', 0.055, 0.23), material, this.head, [0, -0.03, -0.225]);
    } else if (style === 'styleCurly') {
      for (let i = 0; i < 11; i++) {
        const a = i / 11 * Math.PI * 2;
        this.mesh(this.sphere('curl', 0.09, 7), material, this.head,
          [Math.cos(a) * 0.215, 0.15 + (i % 3) * 0.045, Math.sin(a) * 0.18]);
      }
      this.mesh(this.sphere('curl', 0.09, 7), material, this.head, [0, 0.29, 0]);
    } else if (style === 'styleFloppy') {
      for (const x of [-0.11, 0, 0.11]) {
        const fringe = this.mesh(this.capsule('fringe', 0.052, 0.18), material, this.head, [x + 0.045, 0.14, 0.215]);
        fringe.rotation.z = -0.38 + x * 0.6;
      }
    } else if (style === 'styleSpiky') {
      for (const x of [-0.16, -0.055, 0.055, 0.16]) {
        const spike = this.mesh(this.geometry('spike', () => new THREE.ConeGeometry(0.057, 0.21, 6)),
          material, this.head, [x, 0.28 + Math.abs(x) * 0.12, -0.015]);
        spike.rotation.z = x * -1.3;
      }
    } else if (style === 'styleShort') {
      const part = this.mesh(this.geometry('shortSweep', () => new THREE.BoxGeometry(0.23, 0.075, 0.075)),
        material, this.head, [0.07, 0.205, 0.185]);
      part.rotation.z = -0.16;
    } else if (style === 'styleBald' || style === 'styleRecede') {
      for (const x of [-0.22, 0.22]) this.mesh(this.capsule('temple', 0.043, 0.16), material, this.head, [x, 0.02, -0.01]);
    }
  }

  private addGlasses(): void {
    const frame = this.material([38, 40, 46], 0.36);
    for (const x of [-0.09, 0.09]) this.mesh(this.geometry('glassesRim', () => new THREE.TorusGeometry(0.061, 0.009, 5, 12)), frame, this.head, [x, 0.035, 0.272]);
    this.mesh(this.geometry('glassesBridge', () => new THREE.BoxGeometry(0.06, 0.012, 0.012)), frame, this.head, [0, 0.035, 0.272]);
  }

  private addFacialHair(style: string, material: THREE.Material): void {
    if (style === 'stubble') {
      this.mesh(this.geometry('stubble', () => new THREE.SphereGeometry(0.19, 10, 7, 0, Math.PI * 2, Math.PI * 0.50, Math.PI * 0.34)),
        material, this.head, [0, -0.015, 0.075], [0.95, 0.9, 1]);
    } else {
      const width = style === 'mustacheSm' ? 0.10 : 0.16;
      const moustache = this.mesh(this.capsule('moustache', 0.022, 0.10), material, this.head,
        [0, -0.064, 0.265], [width / 0.144, 1, 0.45]);
      moustache.rotation.z = Math.PI / 2;
      if (style === 'goatee') this.mesh(this.capsule('goatee', 0.038, 0.10), material, this.head, [0, -0.145, 0.235], [1, 1, 0.45]);
    }
  }

  private applyRig(p: RigPose, alpha: number): void {
    const lerp = (from: number, to: number) => THREE.MathUtils.lerp(from, to, alpha);
    this.body.position.y = lerp(this.body.position.y, p.hipY + p.bodyY);
    this.torso.scale.y = lerp(this.torso.scale.y, p.bodyScaleY);
    this.head.rotation.x = lerp(this.head.rotation.x, p.headX);
    this.armL.rotation.x = lerp(this.armL.rotation.x, p.armLX);
    this.armR.rotation.x = lerp(this.armR.rotation.x, p.armRX);
    this.elbowL.rotation.x = lerp(this.elbowL.rotation.x, p.elbowLX);
    this.elbowR.rotation.x = lerp(this.elbowR.rotation.x, p.elbowRX);
    this.legL.rotation.x = lerp(this.legL.rotation.x, p.legLX);
    this.legR.rotation.x = lerp(this.legR.rotation.x, p.legRX);
    this.kneeL.rotation.x = lerp(this.kneeL.rotation.x, p.kneeLX);
    this.kneeR.rotation.x = lerp(this.kneeR.rotation.x, p.kneeRX);
  }
}
