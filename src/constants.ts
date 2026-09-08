// Simulation grid dimensions. The magnetic field uses the lower-resolution grid;
// the surface grid is doubled for a smoother reconstructed display.
export const GRID_COLUMNS = 256
export const GRID_ROWS = 112
export const SURFACE_COLUMNS = GRID_COLUMNS * 2
export const SURFACE_ROWS = GRID_ROWS * 2

// World-space dimensions of the upright display cell.
export const WORLD_WIDTH = 6.4
export const WORLD_HEIGHT = 2.8

// Particle resolution controls the visual stroke width and total particle count.
// Keeping the scale derived from the diameter preserves the original mass and
// packing density when the resolution changes.
export const PARTICLE_DIAMETER = 0.036
export const PARTICLE_SCALE = PARTICLE_DIAMETER / 0.048
export const DIGIT_PARTICLE_COUNT = Math.round(300 / PARTICLE_SCALE ** 2)
export const COLON_PARTICLE_COUNT = 8
export const COLON_PARTICLE_START = DIGIT_PARTICLE_COUNT * 2
export const PARTICLE_COUNT = DIGIT_PARTICLE_COUNT * 4 + COLON_PARTICLE_COUNT
export const PARTICLE_MASS = 1068 / PARTICLE_COUNT

// Spatial hashing and surface reconstruction limits. These values are scaled
// with particle resolution so neighboring particles keep the same behavior.
export const COHESION_RANGE = 0.06 * PARTICLE_SCALE
export const SPLAT_RADIUS = 10
export const CELL_SIZE = 0.075 * PARTICLE_SCALE
export const COLLISION_COLUMNS = Math.ceil(WORLD_WIDTH / CELL_SIZE)
export const COLLISION_ROWS = Math.ceil(WORLD_HEIGHT / CELL_SIZE)
export const GRID_SIZE = GRID_COLUMNS * GRID_ROWS

// Seven-segment patterns used to activate the fixed coils for each digit.
export const DIGIT_PATTERNS = [
  'abcdef', 'bc', 'abged', 'abgcd', 'fgbc',
  'afgcd', 'afgecd', 'abc', 'abcdefg', 'abcdfg',
]

// Segment endpoints are centered around each digit's world-space position.
export const SEGMENT_ENDPOINTS: Record<string, [number, number, number, number]> = {
  a: [-0.36, 0.76, 0.36, 0.76],
  b: [0.4, 0.69, 0.4, 0.07],
  c: [0.4, -0.07, 0.4, -0.69],
  d: [-0.36, -0.76, 0.36, -0.76],
  e: [-0.4, -0.07, -0.4, -0.69],
  f: [-0.4, 0.69, -0.4, 0.07],
  g: [-0.36, 0, 0.36, 0],
}

export const DIGIT_CENTERS = [-2.22, -0.94, 0.94, 2.22]
export const COLON_POSITIONS = [-0.27, 0.27]
export const COILS_PER_DIGIT = 7 * 9
export const TOTAL_COILS = COILS_PER_DIGIT * 4 + COLON_POSITIONS.length
export const COIL_SAMPLES_PER_SEGMENT = 9

// The field and particle loops run at separate fixed rates. The renderer can
// still draw more often without changing solver behavior.
export const FIELD_UPDATE_RATE = 30
export const PARTICLE_UPDATE_RATE = 120

// Renderer limits balance image quality and frame time on different displays.
export const COIL_DATA_COMPONENTS = 4
export const INITIAL_PIXEL_RATIO = 2
export const MIN_PIXEL_RATIO = 1
export const MAX_PIXEL_RATIO = 2
export const MAX_RENDER_WIDTH = 1800
export const FRAME_SAMPLE_WINDOW = 2
export const SLOW_FRAME_MS = 23
export const FAST_FRAME_MS = 18
export const PIXEL_RATIO_DECREASE = 0.2
export const PIXEL_RATIO_INCREASE = 0.1
export const MAX_FRAME_DELTA = 0.25

// Each bay holds an independent finite supply of liquid. The colon bay is
// narrower and uses its own particle count and packing distance.
export const DIGIT_BAY_BOUNDS = [
  [-3.17, -1.60],
  [-1.60, -0.32],
  [0.32, 1.60],
  [1.60, 3.17],
] as const
export const COLON_BAY_BOUNDS = [-0.32, 0.32] as const
