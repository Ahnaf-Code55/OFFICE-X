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
  hipY: 0.78, bodyY: 0, bodyScaleY: 1, headX: 0,
  armLX: 0, armRX: 0, elbowLX: 0, elbowRX: 0,
  legLX: 0, legRX: 0, kneeLX: 0, kneeRX: 0,
};

/** A compact, procedural office character. One world unit equals one 16 px tile. */
export class Person3D {
  readonly group: THREE.Group = new THREE.Group();

  private readonly geometries = new Set<THREE.BufferGeometry>();
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
      p.armLX = -swing * 0.75; p.armRX = swing * 0.75;
      p.kneeLX = Math.max(0, -swing) * 0.35;
      p.kneeRX = Math.max(0, swing) * 0.35;
      p.bodyY = Math.abs(Math.sin(phase)) * 0.035;
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
      p.hipY = 0.9; p.legLX = p.legRX = -1.18;
      p.kneeLX = p.kneeRX = 1.18; p.armLX = p.armRX = -0.18;
    }
    this.applyRig(p, blend);
  }

  dispose(): void {
    this.geometries.forEach((geometry) => geometry.dispose());
    this.materials.forEach((material) => material.dispose());
    this.geometries.clear(); this.materials.clear();
    this.group.clear();
  }

  private material(rgb: RGB, roughness = 0.82): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(...rgb.map((v) => v / 255) as RGB), roughness });
    this.materials.add(material);
    return material;
  }

  private mesh(geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D,
    position: [number, number, number], scale?: [number, number, number]): THREE.Mesh {
    this.geometries.add(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    if (scale) mesh.scale.set(...scale);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private capsule(parent: THREE.Object3D, radius: number, length: number, material: THREE.Material,
    y: number, scale?: [number, number, number]): THREE.Mesh {
    return this.mesh(new THREE.CapsuleGeometry(radius, length, 4, 8), material, parent, [0, y, 0], scale);
  }

  private buildBody(look: PersonLook): void {
    const skin = this.material(look.skin);
    const hair = this.material(look.hair, 0.95);
    const shirt = this.material(look.shirt);
    const shirt2 = this.material(look.shirt2 ?? [238, 238, 232]);
    const pants = this.material(look.pants);
    const dark = this.material([28, 30, 35]);
    const eye = this.material([18, 15, 14], 0.55);
    const mouth = this.material([118, 55, 52]);
    const width = look.heavy ? 1.22 : 1;

    this.body.position.y = BASE.hipY;
    this.torso.position.y = 0.34;
    this.body.add(this.torso);
    this.capsule(this.torso, 0.27, 0.34, shirt, 0, [width, 1, look.heavy ? 1.12 : 1]);
    this.addClothing(look, width, shirt, shirt2);

    this.head.position.set(0, 0.71, 0);
    this.torso.add(this.head);
    this.mesh(new THREE.SphereGeometry(0.245, 12, 8), skin, this.head, [0, 0, 0], [look.heavy ? 1.08 : 0.96, look.heavy ? 0.94 : 1.06, 0.94]);
    this.addFace(look, skin, hair, eye, mouth);

    this.armL.position.set(-0.31 * width, 0.19, 0);
    this.armR.position.set(0.31 * width, 0.19, 0);
    this.torso.add(this.armL, this.armR);
    this.buildArm(this.armL, this.elbowL, shirt, skin);
    this.buildArm(this.armR, this.elbowR, shirt, skin);

    this.legL.position.set(-0.14, 0, 0);
    this.legR.position.set(0.14, 0, 0);
    this.body.add(this.legL, this.legR);
    this.buildLeg(this.legL, this.kneeL, pants, dark);
    this.buildLeg(this.legR, this.kneeR, pants, dark);
  }

  private buildArm(upper: THREE.Group, elbow: THREE.Group, cloth: THREE.Material, skin: THREE.Material): void {
    this.capsule(upper, 0.095, 0.27, cloth, -0.20);
    elbow.position.y = -0.40; upper.add(elbow);
    this.capsule(elbow, 0.082, 0.22, skin, -0.17);
    this.mesh(new THREE.SphereGeometry(0.09, 8, 6), skin, elbow, [0, -0.34, 0]);
  }

  private buildLeg(upper: THREE.Group, knee: THREE.Group, pants: THREE.Material, shoe: THREE.Material): void {
    this.capsule(upper, 0.11, 0.27, pants, -0.205);
    knee.position.y = -0.39; upper.add(knee);
    this.capsule(knee, 0.10, 0.20, pants, -0.15);
    this.mesh(new THREE.BoxGeometry(0.21, 0.12, 0.34), shoe, knee, [0, -0.33, 0.07]);
  }

  private addClothing(look: PersonLook, width: number, outer: THREE.Material, inner: THREE.Material): void {
    if (look.cloth === 'suit' || look.cloth === 'cardigan') {
      this.mesh(new THREE.BoxGeometry(0.22, 0.42, 0.035), outer, this.torso, [-0.13 * width, 0.01, 0.275]);
      this.mesh(new THREE.BoxGeometry(0.22, 0.42, 0.035), outer, this.torso, [0.13 * width, 0.01, 0.275]);
      this.mesh(new THREE.BoxGeometry(0.16, 0.37, 0.04), inner, this.torso, [0, 0.02, 0.286]);
    } else if (look.cloth === 'polo') {
      this.mesh(new THREE.BoxGeometry(0.12, 0.12, 0.035), inner, this.torso, [-0.06, 0.13, 0.278]).rotation.z = -0.45;
      this.mesh(new THREE.BoxGeometry(0.12, 0.12, 0.035), inner, this.torso, [0.06, 0.13, 0.278]).rotation.z = 0.45;
    } else if (look.cloth === 'blouse') {
      this.mesh(new THREE.SphereGeometry(0.07, 8, 5), inner, this.torso, [0, 0.12, 0.275]);
    } else if (look.cloth === 'sweater') {
      this.mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.07, 10), inner, this.torso, [0, 0.22, 0]);
    }
    if (look.tie && (look.cloth === 'suit' || look.cloth === 'dressshirt')) {
      const tie = this.material(look.tie);
      const knot = this.mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.08, 4), tie, this.torso, [0, 0.14, 0.292]);
      knot.rotation.z = Math.PI / 4;
      this.mesh(new THREE.BoxGeometry(0.075, 0.24, 0.035), tie, this.torso, [0, -0.02, 0.294]);
    }
  }

  private addFace(look: PersonLook, skin: THREE.Material, hair: THREE.Material,
    eye: THREE.Material, mouth: THREE.Material): void {
    for (const x of [-0.085, 0.085]) {
      this.mesh(new THREE.SphereGeometry(0.026, 7, 5), eye, this.head, [x, 0.035, 0.225]);
      const brow = this.mesh(new THREE.BoxGeometry(0.085, look.lashes ? 0.018 : 0.014, 0.018), hair, this.head, [x, 0.105, 0.215]);
      brow.rotation.z = x < 0 ? -0.08 : 0.08;
    }
    const smile = this.mesh(new THREE.BoxGeometry(0.105, 0.018, 0.018), mouth, this.head, [0, -0.105, 0.233]);
    smile.rotation.z = 0.02;
    this.addHair(look, hair);
    if (look.glasses) this.addGlasses();
    if (look.facial) this.addFacialHair(look.facial, hair);
    void skin;
  }

  private addHair(look: PersonLook, material: THREE.Material): void {
    const style = look.hairStyle;
    if (style !== 'styleBald') {
      const crown = this.mesh(new THREE.SphereGeometry(0.255, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), material, this.head, [0, 0.035, 0]);
      crown.scale.set(1.02, style === 'styleSpiky' ? 1.22 : 0.8, 1.02);
    }
    if (style === 'styleFrame' || style === 'styleMessy') {
      const length = THREE.MathUtils.clamp((look.hairLength ?? 16) / 28, 0.38, 0.72);
      for (const x of [-0.235, 0.235]) this.capsule(this.head, 0.075, length, material, -length / 2 + 0.05).position.x = x;
    } else if (style === 'styleBun') {
      this.mesh(new THREE.SphereGeometry(0.15, 9, 7), material, this.head, [0, 0.24, -0.11]);
    } else if (style === 'styleCurly') {
      for (let i = 0; i < 9; i++) {
        const a = i / 9 * Math.PI * 2;
        this.mesh(new THREE.SphereGeometry(0.09, 7, 5), material, this.head, [Math.cos(a) * 0.21, 0.17 + (i % 2) * 0.04, Math.sin(a) * 0.18]);
      }
    } else if (style === 'styleFloppy') {
      const fringe = this.mesh(new THREE.BoxGeometry(0.25, 0.16, 0.07), material, this.head, [0.08, 0.15, 0.215]);
      fringe.rotation.z = -0.32;
    } else if (style === 'styleSpiky') {
      for (const x of [-0.15, -0.05, 0.06, 0.16]) this.mesh(new THREE.CylinderGeometry(0, 0.055, 0.2, 6), material, this.head, [x, 0.28 + Math.abs(x) * 0.2, 0]);
    } else if (style === 'styleBald' || style === 'styleRecede') {
      for (const x of [-0.22, 0.22]) this.capsule(this.head, 0.045, 0.16, material, 0.02).position.x = x;
    }
  }

  private addGlasses(): void {
    const frame = this.material([35, 37, 42], 0.35);
    for (const x of [-0.09, 0.09]) this.mesh(new THREE.TorusGeometry(0.065, 0.012, 5, 10), frame, this.head, [x, 0.035, 0.24]);
    this.mesh(new THREE.BoxGeometry(0.06, 0.015, 0.015), frame, this.head, [0, 0.035, 0.24]);
  }

  private addFacialHair(style: string, material: THREE.Material): void {
    if (style === 'stubble') {
      this.mesh(new THREE.SphereGeometry(0.18, 10, 6, 0, Math.PI * 2, Math.PI * 0.52, Math.PI * 0.32), material, this.head, [0, -0.01, 0.075]);
    } else {
      const width = style === 'mustacheSm' ? 0.10 : 0.16;
      this.mesh(new THREE.BoxGeometry(width, 0.035, 0.025), material, this.head, [0, -0.055, 0.238]);
      if (style === 'goatee') this.capsule(this.head, 0.045, 0.10, material, -0.14, [1, 1, 0.35]).rotation.z = Math.PI / 2;
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
