export interface ViewRegion {
  x: number;
  y: number;
  radius: number;
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
}

/** Bounded, allocation-free view selection. Distance bands favor nearby creatures when capped. */
export class EntityVisibility {
  readonly ids: Uint32Array;
  private readonly next: Int32Array;
  private readonly heads = new Int32Array(128);
  private readonly tails = new Int32Array(128);
  count = 0;
  candidates = 0;

  constructor(capacity: number) {
    this.ids = new Uint32Array(capacity);
    this.next = new Int32Array(capacity);
  }
  select(x: Float64Array, y: Float64Array, count: number, region: ViewRegion, limit: number): void {
    this.count = 0;
    this.candidates = 0;
    this.heads.fill(-1);
    this.tails.fill(-1);
    const radius2 = region.radius * region.radius;
    const left = region.left ?? region.x - region.radius,
      right = region.right ?? region.x + region.radius;
    const top = region.top ?? region.y - region.radius,
      bottom = region.bottom ?? region.y + region.radius;
    for (let i = 0; i < count; i++) {
      if (x[i] < left || x[i] > right || y[i] < top || y[i] > bottom) continue;
      const dx = x[i] - region.x,
        dy = y[i] - region.y,
        d2 = dx * dx + dy * dy;
      if (d2 > radius2) continue;
      this.candidates++;
      if (limit >= count) {
        this.ids[this.count++] = i;
        continue;
      }
      const band = Math.min(127, Math.floor((d2 / radius2) * 128));
      this.next[i] = -1;
      if (this.heads[band] < 0) this.heads[band] = i;
      else this.next[this.tails[band]] = i;
      this.tails[band] = i;
    }
    if (limit >= count) return;
    for (let band = 0; band < 128 && this.count < limit; band++) {
      for (let i = this.heads[band]; i >= 0 && this.count < limit; i = this.next[i])
        this.ids[this.count++] = i;
    }
  }
}
