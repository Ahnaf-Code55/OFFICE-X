/** Floating name tag sprite: canvas-drawn dark pill with status dot and truncated label. */
import * as THREE from 'three';

const W = 512;
const H = 128;
const PAD = 8;
const BORDER = 2;
const DOT_R = 13;
const FONT = 'bold 52px system-ui, -apple-system, "Segoe UI", sans-serif';

export class NameTag3D {
  readonly sprite: THREE.Sprite;

  private readonly canvas = document.createElement('canvas');
  private readonly texture: THREE.CanvasTexture;
  private readonly material: THREE.SpriteMaterial;
  private lastKey = '';

  constructor() {
    this.canvas.width = W;
    this.canvas.height = H;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.material = new THREE.SpriteMaterial({
      map: this.texture, depthTest: false, transparent: true, sizeAttenuation: true,
    });
    this.sprite = new THREE.Sprite(this.material);
    this.sprite.scale.set(2.4, 2.4 * H / W, 1);
    this.sprite.position.y = 2.55;
    this.sprite.renderOrder = 10;
  }

  set(text: string, dotColor?: string): void {
    const key = `${text}${dotColor ?? ''}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    const x = PAD; const y = PAD; const w = W - PAD * 2; const h = H - PAD * 2; const r = h / 2;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fillStyle = 'rgba(15,17,20,0.82)';
    ctx.fill();
    ctx.lineWidth = BORDER;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.stroke();
    const dotX = x + 22 + DOT_R;
    if (dotColor) {
      ctx.beginPath();
      ctx.arc(dotX, y + h / 2, DOT_R, 0, Math.PI * 2);
      ctx.fillStyle = dotColor;
      ctx.fill();
    }
    ctx.font = FONT;
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    const tx = dotX + DOT_R + 18;
    const maxW = x + w - tx - 24;
    let label = text;
    if (ctx.measureText(label).width > maxW) {
      while (label.length > 1 && ctx.measureText(`${label}…`).width > maxW) label = label.slice(0, -1);
      label = `${label}…`;
    }
    ctx.fillText(label, tx, y + h / 2 + 2);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
  }
}
