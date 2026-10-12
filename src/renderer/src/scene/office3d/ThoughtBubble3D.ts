/** Floating thought/speech bubble sprite: canvas-drawn cream bubble with tail, tool tag, status badge and animated thinking dots. */
import * as THREE from 'three';

export type BubbleGlyph = 'none' | 'blocked' | 'success' | 'compacting' | 'looping';

const W = 640;
const H = 256;
const INK = '#26222e';
const FONT = 'bold 34px system-ui, -apple-system, "Segoe UI", sans-serif';
const TAG_FONT = 'bold 22px system-ui, -apple-system, "Segoe UI", sans-serif';
const BADGE: Record<Exclude<BubbleGlyph, 'none'>, { bg: string; mark: string }> = {
  blocked: { bg: '#e5484d', mark: '!' },
  success: { bg: '#30a46c', mark: '✓' },
  compacting: { bg: '#f5a524', mark: '~' },
  looping: { bg: '#3e8ef7', mark: 'o' },
};

export class ThoughtBubble3D {
  readonly sprite: THREE.Sprite;

  private readonly canvas = document.createElement('canvas');
  private readonly texture: THREE.CanvasTexture;
  private readonly material: THREE.SpriteMaterial;
  private lastKey = ''; private shown = false;
  private text = ''; private tool: string | undefined; private glyph: BubbleGlyph = 'none';
  private dotTime = 0; private dots = 1;

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
    this.sprite.scale.set(3.3, 1.32, 1);
    this.sprite.position.y = 3.5;
    this.sprite.renderOrder = 11;
    this.sprite.visible = false;
  }

  show(text: string, tool?: string, glyph: BubbleGlyph = 'none'): void {
    this.shown = true;
    this.sprite.visible = true;
    if (text === this.text && tool === this.tool && glyph === this.glyph) return;
    this.text = text; this.tool = tool; this.glyph = glyph;
    this.dotTime = 0; this.dots = 1;
    this.draw();
  }

  hide(): void {
    this.shown = false;
    this.sprite.visible = false;
  }

  update(dt: number): void {
    if (!this.shown || this.text !== '') return;
    this.dotTime += dt;
    const n = Math.floor(this.dotTime / 0.4) % 3 + 1;
    if (n !== this.dots) { this.dots = n; this.draw(); }
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
  }

  private draw(): void {
    const key = `${this.text}|${this.tool ?? ''}|${this.glyph}|${this.dots}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    ctx.beginPath();
    ctx.roundRect(12, 12, W - 24, H - 60, 36);
    ctx.moveTo(W / 2 - 26, H - 50); ctx.lineTo(W / 2, H - 8); ctx.lineTo(W / 2 + 26, H - 50);
    ctx.fillStyle = '#fffdf5'; ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = INK; ctx.stroke();
    if (this.glyph !== 'none') {
      const b = BADGE[this.glyph];
      ctx.beginPath(); ctx.arc(W - 26, 26, 30, 0, Math.PI * 2);
      ctx.fillStyle = b.bg; ctx.fill(); ctx.stroke();
      ctx.font = FONT; ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(b.mark, W - 26, 28);
    }
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    let ty = 36;
    if (this.tool) {
      ctx.font = TAG_FONT;
      ctx.beginPath(); ctx.roundRect(40, ty, ctx.measureText(this.tool).width + 28, 34, 17);
      ctx.fillStyle = '#e7e0d0'; ctx.fill();
      ctx.fillStyle = '#5a5470'; ctx.fillText(this.tool, 54, ty + 7);
      ty += 46;
    }
    ctx.font = FONT; ctx.fillStyle = INK;
    if (this.text === '') {
      ctx.textAlign = 'center';
      ctx.fillText('.'.repeat(this.dots), W / 2, ty + 14);
    } else {
      for (const line of wrap(this.text)) { ctx.fillText(line, 44, ty); ty += 42; }
    }
    this.texture.needsUpdate = true;
  }
}

function wrap(text: string): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= 26) { line = next; continue; }
    if (line) lines.push(line);
    line = word;
  }
  if (line) lines.push(line);
  if (lines.length > 3) {
    lines.length = 3;
    while (`${lines[2]}…`.length > 26 && lines[2].length > 1) lines[2] = lines[2].slice(0, -1);
    lines[2] = `${lines[2].trimEnd()}…`;
  }
  return lines;
}
