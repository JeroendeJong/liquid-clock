// Clock patterns drive fixed coils only. No digit data enters the fluid solver.
export const NX = 256
export const NY = 112
export const SURFACE_NX = NX * 2
export const SURFACE_NY = NY * 2
export const WIDTH = 6.4
export const HEIGHT = 2.8
const N = NX * NY
// One resolution control. In this confined 2D cell, halving diameter requires
// four times the samples, not eight. Their combined physical mass stays fixed.
export const PARTICLE_DIAMETER = .036
const PARTICLE_SCALE = PARTICLE_DIAMETER / .048
export const DIGIT_PARTICLES = Math.round(300 / PARTICLE_SCALE ** 2)
export const COLON_PARTICLES = 8
export const COLON_START = DIGIT_PARTICLES * 2
export const PARTICLES = DIGIT_PARTICLES * 4 + COLON_PARTICLES
const PARTICLE_MASS = 1068 / PARTICLES
const COHESION_RANGE = .06 * PARTICLE_SCALE
const SPLAT_RADIUS = 10
const CELL = .075 * PARTICLE_SCALE
const COLS = Math.ceil(WIDTH / CELL)
const ROWS = Math.ceil(HEIGHT / CELL)

const patterns = ['abcdef', 'bc', 'abged', 'abgcd', 'fgbc', 'afgcd', 'afgecd', 'abc', 'abcdefg', 'abcdfg']

type Coil = {
  x: number;
  y: number;
  digit: number;
  segment: string;
  current: number;
  target: number;
  gain: number
}

export function formatTime(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export class Fluid {
  readonly height = new Float64Array(SURFACE_NX * SURFACE_NY)
  readonly potential = new Float64Array(N)
  private reach = new Float64Array(N)
  readonly x = new Float64Array(PARTICLES)
  readonly y = new Float64Array(PARTICLES)
  private vx = new Float64Array(PARTICLES)
  private vy = new Float64Array(PARTICLES)
  private oldX = new Float64Array(PARTICLES)
  private oldY = new Float64Array(PARTICLES)
  private heads = new Int32Array(COLS * ROWS)
  private next = new Int32Array(PARTICLES)
  private bayLeft = new Float64Array(PARTICLES)
  private bayRight = new Float64Array(PARTICLES)
  private diameter = new Float64Array(PARTICLES)
  readonly texture = new Float32Array(SURFACE_NX * SURFACE_NY * 2)
  readonly coils: Coil[] = []
  readonly initialMass: number
  private readonly kernels: { weights: Float32Array; reaches: Float32Array }[] = []
  private offset = 0
  private previousPattern = ''
  private previousRelease = false
  private accumulator = 0
  private fieldAccumulator = 0
  private age = 0
  private seed = Math.random() * 1000
  private clock: () => Date
  private colonPower = [1, 1]
  private agitationPhase = new Float64Array(4)
  time = ''
  released = false
  showField = false
  constructor(clock: () => Date = () => new Date()) {
    this.clock = clock
    const segments: Record<string, number[]> = {
      a: [-.36, .76, .36, .76], b: [.4, .69, .4, .07], c: [.4, -.07, .4, -.69],
      d: [-.36, -.76, .36, -.76], e: [-.4, -.07, -.4, -.69], f: [-.4, .69, -.4, .07], g: [-.36, 0, .36, 0],
    }
    for (const [digit, center] of [-2.22, -.94, .94, 2.22].entries()) {
      for (const [segment, [x1, y1, x2, y2]] of Object.entries(segments)) {
        for (let k = 0; k < 9; k++) this.coils.push({ x: center + x1 + (x2 - x1) * k / 8, y: y1 + (y2 - y1) * k / 8, digit, segment, current: 0, target: 0, gain: 1 })
      }
    }
    for (const y of [-.27, .27]) this.coils.push({ x: 0, y, digit: -1, segment: '', current: 0, target: 1, gain: 1 })
    for (const coil of this.coils) {
      const weights = new Float32Array(N), reaches = new Float32Array(N)
      const limits = coil.digit === -1 ? [-.32, .32] : [[-3.2, -1.6], [-1.6, -.32], [.32, 1.6], [1.6, 3.2]][coil.digit]
      for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) {
        const worldX = (x + .5) / NX * WIDTH - WIDTH / 2
        if (worldX < limits[0] || worldX > limits[1]) continue
        const dx = (x + .5) / NX * WIDTH - WIDTH / 2 - coil.x, dy = (y + .5) / NY * HEIGHT - HEIGHT / 2 - coil.y
        const r2 = dx * dx + dy * dy
        const weight = .205 * Math.exp(-r2 / .013) + .012 * Math.exp(-r2 / .35)
        const reach = .045 * Math.exp(-r2 / 1.3)
        weights[y * NX + x] = coil.digit === -1 ? weight * 3.4 : weight
        reaches[y * NX + x] = reach
      }
      this.kernels.push({ weights, reaches })
    }
    // One finite charge in the visible bottom reservoir of the upright cell.
    const bays = [[-3.17, -1.60, DIGIT_PARTICLES], [-1.60, -.32, DIGIT_PARTICLES], [-.32, .32, COLON_PARTICLES], [.32, 1.60, DIGIT_PARTICLES], [1.60, 3.17, DIGIT_PARTICLES]]
    let particle = 0
    for (const [left, right, count] of bays) {
      const columns = Math.floor((right - left - .09) / (.045 * PARTICLE_SCALE))
      for (let k = 0; k < count; k++, particle++) {
        const row = Math.floor(k / columns)
        this.x[particle] = left + .045 + ((k % columns) * .045 + (row % 2) * .012) * PARTICLE_SCALE
        this.y[particle] = -1.36 + row * .039 * PARTICLE_SCALE
        this.bayLeft[particle] = left + .023
        this.bayRight[particle] = right - .023
        this.diameter[particle] = count === COLON_PARTICLES ? .055 * PARTICLE_SCALE : PARTICLE_DIAMETER
      }
    }
    this.initialMass = this.mass()
    this.updateCoils(1)
    this.pack()
  }
  advance() { this.offset += 60000 }
  resetTime() { this.offset = 0 }
  mass() { return this.x.length * PARTICLE_MASS }
  private updateCoils(dt: number) {
    this.time = formatTime(new Date(this.clock().getTime() + this.offset))
    if (this.time !== this.previousPattern || this.released !== this.previousRelease) {
      const digits = this.time.replace(':', '')
      this.seed = Math.random() * 1000
      for (const coil of this.coils) {
        const target = this.released ? 0 : coil.digit === -1 || patterns[Number(digits[coil.digit])].includes(coil.segment) ? 1 : 0
        if (target !== coil.target) coil.gain = .985 + Math.random() * .03
        coil.target = target
      }
      this.previousPattern = this.time
      this.previousRelease = this.released
    }
    this.potential.fill(0)
    this.reach.fill(0)
    const activeCoils = new Float64Array(4)
    for (const coil of this.coils) {
      coil.current += (coil.target - coil.current) * (1 - Math.exp(-dt * 5))
      if (coil.digit >= 0) activeCoils[coil.digit] += coil.current
    }
    for (let digit = 0; digit < 4; digit++) {
      const activity = .3 + .7 * Math.max(0, Math.min(1, (activeCoils[digit] - 18) / 27))
      this.agitationPhase[digit] += dt * (.6 + .4 * activity)
    }
    for (let c = 0; c < this.coils.length; c++) {
      const coil = this.coils[c]
      if (coil.current < .00001) continue
      // The same charge sits on fewer coils in sparse patterns. Reduce their
      // agitation, smoothly following actual currents during digit transitions.
      // The fluid solver still has no numeral-specific targets or material rules.
      const activity = coil.digit < 0 ? 1 : .3 + .7 * Math.max(0, Math.min(1, (activeCoils[coil.digit] - 18) / 27))
      const phase = coil.digit < 0 ? this.age : this.agitationPhase[coil.digit]
      const tremor = 1 + activity * (.065 * Math.sin(phase * 1.8 + c * .47) + .025 * Math.sin(phase * 2.7 + c * .81 + this.seed))
      const { weights, reaches } = this.kernels[c]
      const current = coil.current * coil.gain * tremor
      for (let y = 0; y < NY; y += 2) for (let x = 0; x < NX; x += 2) {
        const k = y * NX + x
        this.potential[k] += weights[k] * current
        this.reach[k] += reaches[k] * coil.current
      }
    }
    for (let yy = 0; yy < NY; yy += 2) for (let xx = 0; xx < NX; xx += 2) {
      const i = yy * NX + xx
      const ridge = 1 - Math.exp(-this.potential[i] * 4.5)
      const y = (Math.floor(i / NX) + .5) / NY * HEIGHT - HEIGHT / 2
      const x = (xx + .5) / NX * WIDTH - WIDTH / 2
      const digit = x < -1.6 ? 0 : x < -.32 ? 1 : x < .32 ? -1 : x < 1.6 ? 2 : 3
      const first = digit === -1 ? 252 : digit * 63, last = digit === -1 ? 254 : first + 63
      let distance2 = Infinity, strength = 0
      for (let c = first; c < last; c++) {
        const coil = this.coils[c]
        if (coil.current < .005) continue
        const d2 = (x - coil.x) ** 2 + (y - coil.y) ** 2
        if (d2 < distance2) { distance2 = d2; strength = coil.current }
      }
      // A monotonic pickup tail removes off-coil local traps. This is a scalar
      // magnetic potential, not a particle destination or a position correction.
      const capture = strength > 0 ? -strength * Math.max(0, Math.sqrt(distance2) - .15) : 0
      this.potential[i] = ridge * (2.8 + .26 * y) + this.reach[i] * (1 - .9 * ridge) + capture
    }
    for (let y = 0; y < NY; y += 2) for (let x = 1; x < NX; x += 2) {
      this.potential[y * NX + x] = (this.potential[y * NX + x - 1] + this.potential[y * NX + Math.min(NX - 2, x + 1)]) * .5
    }
    for (let y = 1; y < NY; y += 2) for (let x = 0; x < NX; x++) {
      this.potential[y * NX + x] = (this.potential[(y - 1) * NX + x] + this.potential[Math.min(NY - 2, y + 1) * NX + x]) * .5
    }
    // Independently regulated colon coils prevent the lower dot from trapping
    // the entire charge during pickup. Feedback changes field power, never fluid.
    for (let dot = 0; dot < 2; dot++) {
      const coil = this.coils[252 + dot]
      let nearby = 0
      for (let i = COLON_START; i < COLON_START + COLON_PARTICLES; i++) if ((this.x[i] - coil.x) ** 2 + (this.y[i] - coil.y) ** 2 < .055) nearby += PARTICLE_MASS
      const demand = Math.max(.4, Math.min(3, 22.4 / (nearby + 1.12)))
      this.colonPower[dot] += (demand - this.colonPower[dot]) * (1 - Math.exp(-dt * 2))
      for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) {
        const px = (x + .5) / NX * WIDTH - WIDTH / 2, py = (y + .5) / NY * HEIGHT - HEIGHT / 2
        const r2 = px * px + (py - coil.y) ** 2
        const shield = Math.max(0, 1 - (Math.abs(px) / .27) ** 8)
        this.potential[y * NX + x] += shield * coil.current * this.colonPower[dot] * (1.6 * Math.exp(-r2 / .045) + .5 * Math.exp(-r2 / .35))
      }
    }
  }
  update(dt: number) {
    this.age += dt
    this.fieldAccumulator += dt
    if (this.fieldAccumulator >= 1 / 30 || dt === 0) {
      this.updateCoils(this.fieldAccumulator)
      this.fieldAccumulator = 0
    }
    this.accumulator += dt
    let steps = 0
    while (this.accumulator >= 1 / 120 && steps < 6) {
      this.step()
      this.accumulator -= 1 / 120
      steps++
    }
    this.accumulator = Math.min(this.accumulator, 1 / 30)
    this.pack()
  }
  private step() {
    const dt = 1 / 120
    for (let i = 0; i < PARTICLES; i++) {
      const x = this.x[i], y = this.y[i], e = .025
      // The blurred grid crosses separator edges. Sample within this bay's
      // interior so a neighboring field cannot pin fluid against the wall.
      const fieldX = Math.max(this.bayLeft[i] + .065, Math.min(this.bayRight[i] - .065, x))
      const fx = (this.field(fieldX + e, y) - this.field(fieldX - e, y)) / (2 * e)
      const fy = (this.field(fieldX, y + e) - this.field(fieldX, y - e)) / (2 * e)
      this.oldX[i] = x; this.oldY[i] = y
      this.vx[i] = (this.vx[i] + fx * 10 * dt) * .97
      this.vy[i] = (this.vy[i] + (fy * 10 - 2.2) * dt) * .97
      this.x[i] += Math.max(-2, Math.min(2, this.vx[i])) * dt
      this.y[i] += Math.max(-2, Math.min(2, this.vy[i])) * dt
    }
    // Position-based near-incompressibility and short-range cohesion. Particles
    // never leave the foreground plane, get deleted, or jump to a glyph target.
    for (let iteration = 0; iteration < 2; iteration++) {
      this.heads.fill(-1)
      for (let i = 0; i < PARTICLES; i++) {
        const cx = Math.max(0, Math.min(COLS - 1, Math.floor((this.x[i] + WIDTH / 2) / CELL)))
        const cy = Math.max(0, Math.min(ROWS - 1, Math.floor((this.y[i] + HEIGHT / 2) / CELL)))
        const cell = cy * COLS + cx
        this.next[i] = this.heads[cell]; this.heads[cell] = i
      }
      for (let i = 0; i < PARTICLES; i++) {
        const cx = Math.max(0, Math.min(COLS - 1, Math.floor((this.x[i] + WIDTH / 2) / CELL)))
        const cy = Math.max(0, Math.min(ROWS - 1, Math.floor((this.y[i] + HEIGHT / 2) / CELL)))
        for (let yy = Math.max(0, cy - 1); yy <= Math.min(ROWS - 1, cy + 1); yy++) {
          for (let xx = Math.max(0, cx - 1); xx <= Math.min(COLS - 1, cx + 1); xx++) {
            for (let j = this.heads[yy * COLS + xx]; j !== -1; j = this.next[j]) {
              if (j <= i) continue
              if (this.bayLeft[i] !== this.bayLeft[j]) continue
              const dx = this.x[j] - this.x[i], dy = this.y[j] - this.y[i]
              const distance = Math.sqrt(dx * dx + dy * dy)
              const diameter = (this.diameter[i] + this.diameter[j]) * .5
              if (distance < 1e-7 || distance > Math.max(COHESION_RANGE, diameter)) continue
              // Preserve resting cohesion/packing. Dampen separating neighbors
              // instead of stronger static attraction that can starve thin strokes.
              const separation = Math.max(0, distance - diameter)
              const taper = Math.max(0, 1 - separation / Math.max(1e-6, COHESION_RANGE - diameter))
              const separatingSpeed = Math.max(0, ((this.vx[j] - this.vx[i]) * dx + (this.vy[j] - this.vy[i]) * dy) / distance)
              const viscosity = Math.min(separation, separatingSpeed * dt) * .08 * taper
              const correction = distance < diameter ? (diameter - distance) * .46 : -separation * .007 - viscosity
              const ox = dx / distance * correction, oy = dy / distance * correction
              this.x[i] -= ox; this.y[i] -= oy
              this.x[j] += ox; this.y[j] += oy
            }
          }
        }
        this.x[i] = Math.max(this.bayLeft[i], Math.min(this.bayRight[i], this.x[i]))
        this.y[i] = Math.max(-1.37, Math.min(1.37, this.y[i]))
      }
    }
    for (let i = 0; i < PARTICLES; i++) {
      this.vx[i] = (this.x[i] - this.oldX[i]) / dt
      this.vy[i] = (this.y[i] - this.oldY[i]) / dt
    }
  }
  private field(x: number, y: number) {
    const gx = Math.max(0, Math.min(NX - 1.001, (x / WIDTH + .5) * NX - .5))
    const gy = Math.max(0, Math.min(NY - 1.001, (y / HEIGHT + .5) * NY - .5))
    const ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy
    const i = iy * NX + ix, p = this.potential
    return (p[i] * (1 - fx) + p[i + 1] * fx) * (1 - fy) + (p[i + NX] * (1 - fx) + p[i + NX + 1] * fx) * fy
  }
  private pack() {
    this.height.fill(0)
    // Compact-support, normalized splats: empty space is genuinely empty.
    // Every particle deposits its entire mass, including at the tank boundary.
    for (let i = 0; i < PARTICLES; i++) {
      const gx = (this.x[i] / WIDTH + .5) * SURFACE_NX - .5, gy = (this.y[i] / HEIGHT + .5) * SURFACE_NY - .5
      const x0 = Math.max(0, Math.floor(gx - SPLAT_RADIUS)), x1 = Math.min(SURFACE_NX - 1, Math.ceil(gx + SPLAT_RADIUS))
      const y0 = Math.max(0, Math.floor(gy - SPLAT_RADIUS)), y1 = Math.min(SURFACE_NY - 1, Math.ceil(gy + SPLAT_RADIUS))
      let sum = 0
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const r2 = ((x - gx) ** 2 + (y - gy) ** 2) / (SPLAT_RADIUS * SPLAT_RADIUS)
        if (r2 < 1) sum += (1 - r2) ** 3
      }
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const r2 = ((x - gx) ** 2 + (y - gy) ** 2) / (SPLAT_RADIUS * SPLAT_RADIUS)
        if (r2 < 1) this.height[y * SURFACE_NX + x] += PARTICLE_MASS * (1 - r2) ** 3 / sum
      }
    }
    for (let y = 0; y < SURFACE_NY; y++) for (let x = 0; x < SURFACE_NX; x++) {
      const i = y * SURFACE_NX + x
      // Convert cell mass to the original density units; do not change volume
      // or kernel support when increasing the reconstruction resolution.
      this.texture[i * 2] = this.height[i] * 4
      this.texture[i * 2 + 1] = this.potential[Math.floor(y / 2) * NX + Math.floor(x / 2)]
    }
  }
}
