# Liquid Clock

```sh
corepack yarn install
corepack yarn dev
```

Open the local Vite URL. The display follows local time in 24-hour HH:MM format.
“Advance one minute” previews a real coil change; “Live time” restores the clock.
“Release magnets” drops the existing liquid into the visible bottom reservoir.
“Reveal coils” shows the fixed electromagnet array behind the upright display.

## Mechanism

The only digit-specific data is the activation pattern of 254 fixed coils (seven
segments per numeral, plus two colon coils). Currents ramp over time, generating
a sum of narrow Gaussian fields with weaker long-range attraction. The resulting
potential, not the numeral, is the input to the fluid solver.

A fixed supply of 5,600 equal-mass particles begins in a bottom reservoir.
They move in the vertical display plane at 120 fixed steps per simulated second,
driven by magnetic field gradients and downward gravity. Position-based contact
constraints resist compression, short-range attraction supplies cohesion, and
velocity damping supplies viscosity. The cell walls contain the particles.
There is no background layer, particle spawning, glyph targeting, or deletion.

Particle resolution is controlled by `PARTICLE_DIAMETER` in `src/constants.ts`,
currently 0.024 (half the original 0.048). The count scales inversely with diameter
squared because motion is confined to a plane: half diameter means four times
as many particles. Each now carries 0.28 mass units instead of 1.12, preserving
the original 1,568-unit charge and approximate packing area in every digit bay.
Initial spacing, cohesion range, neighbor-search cells, and reconstruction kernels
scale with this resolution. The colon controller measures nearby mass rather
than relying on a hard-coded particle count. Changing only collision diameter
without these changes compresses the same samples into smaller strokes.

The 512 × 224 surface grid is only a reconstruction of the current particle positions,
not a diffusing fluid film. Compact-support kernels deposit each particle's full
mass into nearby cells, with normalized weights even at the boundary. Empty
regions contain exactly zero mass. Fixed vertical bays retain a finite supply
for each numeral and the colon. The model assumes magnetically shielded bays;
particles do not attract or collide across their walls. Forces near a separator
sample the bay interior to avoid interpolation from the neighboring field.
Unused liquid and traveling drops stay visible in the foreground. Changing the coil pattern
does not rewrite either particle positions or their reconstructed mass.

This is a confined, position-based particle approximation, not a full
magnetohydrodynamic solver. Particles have in-plane inertia but cannot move behind
the face or out toward the viewer. The coil field includes a broad pickup
component and stronger upper-coil bias to help lift fluid against gravity.
Removing the field makes the fluid fall; reactivation attracts that same supply
back out of the reservoir.

A monotonic pickup potential pulls stray fluid toward the closest powered coil
in its bay outside a small resting radius. Its strength follows coil current,
so it fades when magnets are released. This numerical magnetic-field tail helps
fluid escape weak spots between Gaussian bumps; it never teleports particles.

The two colon coils also regulate their field power from nearby fluid mass,
so the lower dot does not trap the entire colon supply during pickup. This is a
numerical controller approximation; it changes only magnetic forces. It never
assigns particles to dots or relocates them. The colon bay uses a wider effective
particle packing distance than the numeral bays.

The WebGL 2 fragment shader ray-intersects the actual evolving height field,
then fills the liquid with one uniform, unlit black. There are no surface-normal
highlights, reflections, spike textures, or height-dependent color variations
that reveal individual particles. Height still determines the silhouette; edge
antialiasing is limited to the free boundary. All idle motion comes from the
actual fluid responding to changing coil currents.

Each transition draws a fresh random phase for traveling current variations and random
1.5% calibration variations for switched coils. The existing state also carries
forward. This makes paths vary without authoring digit morphs; it is stochastic
variation, not a mathematical guarantee that repetition is impossible. Current
variations continuously move the actual fluid, including during idle.

Sparse coil patterns receive calmer, slower idle current modulation: a two-segment
`1` uses 30% of the full modulation amplitude. This follows the continuously
ramped number of active coils, not a special digit shape in the fluid solver.
Short-range cohesion retains its original resting strength. Additional tapered
viscous resistance slows neighboring particles that are separating, so the free
surface resists shedding specks without increasing static attraction and thinning
out settled strokes. Equal and opposite pair corrections preserve the supply.

## Verification and performance

```sh
corepack yarn build
corepack yarn lint
node --experimental-strip-types --test tests/*.test.mjs
```

Use Node 22.6+ for the direct TypeScript test runner (the project specifies Node
22). Tests cover conservation, nonnegative mass, coil changes without state
rewrites, exactly empty areas, gravitational collection, and re-lifting the same
reservoir, plus recovery of droplets deliberately placed in coil gaps and beside
separators. A dense `08:08` regression checks that every active coil has nearby
fluid after settling with the smaller particles. Tests also verify that grid reconstruction accounts for all particle
mass. The footer reports retained particle mass
and measured animation FPS. Rendering starts at up to 2× pixel ratio, capped at
1800 pixels wide. Every two seconds, it lowers pixel ratio if average frames
exceed 23 ms, or gradually restores it below 18 ms (minimum 1×). The 512 × 224
surface reconstruction preserves the same physical kernel size and total mass;
the 256 × 112 magnetic grid stays independent of particle resolution. Smaller
particles increase CPU collision work; smaller neighbor cells and reconstruction
kernels limit the extra work, but adaptive display resolution cannot eliminate
a CPU bottleneck. Edge antialiasing
uses explicit screen-space samples, avoiding derivatives in divergent branches.
Shader rendering runs on the GPU; the conservative solver is CPU-based.
Fields update at 30 Hz; particle dynamics run at 120 Hz. Kernel tables
use typed arrays, and rendering skips empty space. Background/stalled
frames are time-capped to avoid expensive catch-up loops.

Requires WebGL 2. Floating-point texture filtering extensions are unnecessary:
the shader bilinearly samples RG32F explicitly. Lower-end devices may run more
slowly, especially with the coil overlay enabled. There is no benchmark claim
for untested devices. The simulation and renderer work without a backend;
optional Google Fonts fall back to system sans-serif when unavailable.
