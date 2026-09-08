import {
  COIL_DATA_COMPONENTS,
  FAST_FRAME_MS,
  FRAME_SAMPLE_WINDOW,
  INITIAL_PIXEL_RATIO,
  MAX_FRAME_DELTA,
  MAX_PIXEL_RATIO,
  MAX_RENDER_WIDTH,
  MIN_PIXEL_RATIO,
  PIXEL_RATIO_DECREASE,
  PIXEL_RATIO_INCREASE,
  SLOW_FRAME_MS,
  SURFACE_COLUMNS,
  SURFACE_ROWS,
  TOTAL_COILS,
} from './constants.ts'
import { Fluid } from './simulation'

// The vertex shader draws a full-screen triangle. The fragment shader then
// projects the simulation texture onto the clock face and adds the liquid.
const vertex = `#version 300 es
precision highp float;

out vec2 uv;

void main() {
  // gl_VertexID provides the three corners without a vertex buffer.
  vec2 position = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  uv = position;
  gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
}
`

const fragment = `#version 300 es
precision highp float;

uniform sampler2D state;
uniform vec2 resolution;
uniform float showField;
uniform vec4 coils[254];

in vec2 uv;
out vec4 color;

// Read the simulation texture in world coordinates. The texture stores mass
// in the red channel and the magnetic potential in the green channel.
vec2 sampleState(vec2 point) {
  ivec2 textureSizeInCells = textureSize(state, 0);
  ivec2 textureMinimum = ivec2(0);
  ivec2 textureMaximum = textureSizeInCells - 1;

  // Convert world coordinates to texture coordinates, keeping the sample
  // centered on texels so the four fetched values can be interpolated.
  vec2 texturePosition = (point / vec2(6.4, 2.8) + 0.5)
    * vec2(textureSizeInCells) - 0.5;
  ivec2 lowerCell = ivec2(floor(texturePosition));
  vec2 cellFraction = fract(texturePosition);

  // Fetch all four neighboring cells. Explicit interpolation is used because
  // the floating-point texture does not rely on hardware filtering.
  vec2 lowerLeft = texelFetch(
    state,
    clamp(lowerCell, textureMinimum, textureMaximum),
    0
  ).rg;
  vec2 lowerRight = texelFetch(
    state,
    clamp(lowerCell + ivec2(1, 0), textureMinimum, textureMaximum),
    0
  ).rg;
  vec2 upperLeft = texelFetch(
    state,
    clamp(lowerCell + ivec2(0, 1), textureMinimum, textureMaximum),
    0
  ).rg;
  vec2 upperRight = texelFetch(
    state,
    clamp(lowerCell + ivec2(1, 1), textureMinimum, textureMaximum),
    0
  ).rg;

  vec2 lowerRow = mix(lowerLeft, lowerRight, cellFraction.x);
  vec2 upperRow = mix(upperLeft, upperRight, cellFraction.x);
  return mix(lowerRow, upperRow, cellFraction.y);
}

// Convert simulated mass into the height used by the ray intersection.
float surfaceHeight(vec2 point) {
  float mass = sampleState(point).x;
  return 0.16 * (1.0 - exp(-mass * 4.0));
}

// Signed distance function for the rounded rectangular clock face.
float roundedBox(vec2 point, vec2 bounds, float radius) {
  vec2 corner = abs(point) - bounds + radius;
  vec2 outsideCorner = max(corner, 0.0);
  float insideDistance = min(max(corner.x, corner.y), 0.0);
  return insideDistance + length(outsideCorner) - radius;
}

void main() {
  // Map the fullscreen triangle to the world-space plane of the clock.
  vec2 screen = (uv - 0.5)
    * vec2(6.95, 6.95 * resolution.y / resolution.x);
  vec3 rayDirection = normalize(vec3(0.0, 0.025, -1.0));
  vec3 rayOrigin = vec3(screen.x, screen.y - 0.075, 3.0);
  vec3 facePoint = rayOrigin + rayDirection * (-rayOrigin.z / rayDirection.z);

  // Pixels outside the rounded face are rendered as white and stop here.
  float wallDistance = roundedBox(facePoint.xy, vec2(3.2, 1.4), 0.13);
  vec3 floorColor = vec3(1.0);
  if (wallDistance > 0.0) {
    color = vec4(1.0);
    return;
  }

  vec2 state = sampleState(facePoint.xy);

  // Optionally draw the fixed coil positions as soft dark rings on the face.
  if (showField > 0.01) {
    float coilRings = 0.0;
    for (int coilIndex = 0; coilIndex < 254; coilIndex++) {
      float coilDistance = length(facePoint.xy - coils[coilIndex].xy);
      float ringDistance = (coilDistance - 0.026) / 0.004;
      float ringStrength = exp(-pow(ringDistance, 2.0));
      float currentStrength = 0.08 + 0.42 * coils[coilIndex].z;
      coilRings += ringStrength * currentStrength;
    }
    float fieldOpacity = clamp(coilRings, 0.0, 0.7) * showField;
    floorColor = mix(floorColor, vec3(0.0), fieldOpacity);
  }

  // Skip expensive ray marching for empty pixels. The backward sample catches
  // a liquid edge that is just behind the current face point.
  vec2 previousState = sampleState(facePoint.xy - vec2(0.0, 0.006));
  if (state.x == 0.0 && previousState.x == 0.0) {
    color = vec4(pow(floorColor, vec3(1.0 / 2.2)), 1.0);
    return;
  }

  // Find a first intersection by stepping from the front of the face toward
  // the back. A second pass below refines that interval with bisection.
  float rayStart = (rayOrigin.z - 0.22) / (-rayDirection.z);
  float rayEnd = -rayOrigin.z / rayDirection.z;
  float rayPosition = rayStart;
  float previousRayPosition = rayStart;
  bool hitSurface = false;

  for (int stepIndex = 0; stepIndex < 28; stepIndex++) {
    float stepFraction = float(stepIndex) / 27.0;
    rayPosition = mix(rayStart, rayEnd, stepFraction);
    vec3 point = rayOrigin + rayDirection * rayPosition;
    if (point.z <= surfaceHeight(point.xy)) {
      hitSurface = true;
      break;
    }
    previousRayPosition = rayPosition;
  }

  vec3 result = floorColor;
  if (hitSurface) {
    // Refine the intersection so the liquid silhouette does not look stepped.
    for (int refinement = 0; refinement < 7; refinement++) {
      float midpoint = (previousRayPosition + rayPosition) * 0.5;
      vec3 point = rayOrigin + rayDirection * midpoint;
      if (point.z > surfaceHeight(point.xy)) {
        previousRayPosition = midpoint;
      } else {
        rayPosition = midpoint;
      }
    }

    vec3 liquidPoint = rayOrigin + rayDirection * rayPosition;
    state = sampleState(liquidPoint.xy);

    // The liquid is uniformly black. Height and density affect only its edge,
    // not its interior color, lighting, or surface reflections.
    vec3 liquidColor = vec3(0.0015);

    // Estimate an explicit screen-space footprint for edge smoothing. This is
    // kept independent of GPU derivatives because this branch is divergent.
    float pixelWorldSize = 6.95 / resolution.x;
    float xGradient = sampleState(
      liquidPoint.xy + vec2(pixelWorldSize, 0.0)
    ).x - sampleState(
      liquidPoint.xy - vec2(pixelWorldSize, 0.0)
    ).x;
    float yGradient = sampleState(
      liquidPoint.xy + vec2(0.0, pixelWorldSize)
    ).x - sampleState(
      liquidPoint.xy - vec2(0.0, pixelWorldSize)
    ).x;
    vec2 edgeGradient = vec2(xGradient, yGradient);

    float edgeWidth = 0.018 + length(edgeGradient) * 0.15;
    float opacity = smoothstep(0.001, edgeWidth, state.x);
    result = mix(floorColor, liquidColor, opacity);
  }

  // Apply display gamma correction after combining the floor and liquid.
  color = vec4(pow(max(result, 0.0), vec3(1.0 / 2.2)), 1.0);
}
`

export class Renderer {
  private gl: WebGL2RenderingContext
  private program: WebGLProgram
  private texture: WebGLTexture
  private canvas: HTMLCanvasElement
  private locations: Record<string, WebGLUniformLocation | null> = {}
  private coilData = new Float32Array(TOTAL_COILS * COIL_DATA_COMPONENTS)
  private pixelRatio = INITIAL_PIXEL_RATIO
  private previousTime = 0
  private sampleSeconds = 0
  private sampleFrames = 0

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.gl = this.getContext(canvas)
    this.program = this.createProgram()
    this.cacheUniformLocations()
    this.texture = this.createTexture()
  }

  private getContext(canvas: HTMLCanvasElement) {
    const context = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      powerPreference: 'high-performance',
    })
    if (!context) {
      throw new Error('This fluid display needs a browser with WebGL 2 enabled.')
    }
    return context
  }

  private createProgram() {
    const vertexShader = this.compile(this.gl.VERTEX_SHADER, vertex)
    const fragmentShader = this.compile(this.gl.FRAGMENT_SHADER, fragment)
    const program = this.gl.createProgram()!

    this.gl.attachShader(program, vertexShader)
    this.gl.attachShader(program, fragmentShader)
    this.gl.linkProgram(program)
    this.gl.deleteShader(vertexShader)
    this.gl.deleteShader(fragmentShader)

    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      throw new Error(
        this.gl.getProgramInfoLog(program) || 'Could not initialize the liquid renderer.',
      )
    }

    this.gl.useProgram(program)
    return program
  }

  private cacheUniformLocations() {
    for (const name of ['state', 'resolution', 'showField', 'coils']) {
      this.locations[name] = this.gl.getUniformLocation(this.program, name)
    }
  }

  private createTexture() {
    const texture = this.gl.createTexture()!
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture)
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST)
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST)
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE)
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE)
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RG32F,
      SURFACE_COLUMNS,
      SURFACE_ROWS,
      0,
      this.gl.RG,
      this.gl.FLOAT,
      null,
    )
    this.gl.uniform1i(this.locations.state, 0)
    return texture
  }

  private compile(type: number, source: string) {
    const shader = this.gl.createShader(type)!
    this.gl.shaderSource(shader, source)
    this.gl.compileShader(shader)

    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      const message = this.gl.getShaderInfoLog(shader)
      this.gl.deleteShader(shader)
      throw new Error(message || 'Could not compile the liquid shader.')
    }
    return shader
  }

  private updateFrameSampling(elapsed: number) {
    if (elapsed <= 0 || elapsed >= MAX_FRAME_DELTA || document.hidden) {
      return
    }

    this.sampleSeconds += elapsed
    this.sampleFrames++
    if (this.sampleSeconds >= FRAME_SAMPLE_WINDOW) {
      const frameMs = this.sampleSeconds * 1000 / this.sampleFrames
      if (frameMs > SLOW_FRAME_MS) {
        this.pixelRatio = Math.max(MIN_PIXEL_RATIO, this.pixelRatio - PIXEL_RATIO_DECREASE)
      } else if (frameMs < FAST_FRAME_MS) {
        this.pixelRatio = Math.min(MAX_PIXEL_RATIO, this.pixelRatio + PIXEL_RATIO_INCREASE)
      }
      this.sampleSeconds = 0
      this.sampleFrames = 0
    }
  }

  private resizeCanvas() {
    const scale = Math.min(
      window.devicePixelRatio,
      this.pixelRatio,
      MAX_RENDER_WIDTH / Math.max(this.canvas.clientWidth, 1),
    )
    const width = Math.round(this.canvas.clientWidth * scale)
    const height = Math.round(this.canvas.clientHeight * scale)

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
      this.gl.viewport(0, 0, width, height)
    }

    return { width, height }
  }

  private uploadCoils(fluid: Fluid) {
    for (const [index, coil] of fluid.coils.entries()) {
      const offset = index * COIL_DATA_COMPONENTS
      this.coilData[offset] = coil.x
      this.coilData[offset + 1] = coil.y
      this.coilData[offset + 2] = coil.current
    }
    this.gl.uniform4fv(this.locations.coils, this.coilData)
  }

  draw(fluid: Fluid, time: number) {
    const elapsed = time - this.previousTime
    this.previousTime = time
    this.updateFrameSampling(elapsed)

    const { width, height } = this.resizeCanvas()
    this.gl.useProgram(this.program)
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture)
    this.gl.texSubImage2D(
      this.gl.TEXTURE_2D,
      0,
      0,
      0,
      SURFACE_COLUMNS,
      SURFACE_ROWS,
      this.gl.RG,
      this.gl.FLOAT,
      fluid.texture,
    )
    this.gl.uniform2f(this.locations.resolution, width, height)
    this.gl.uniform1f(this.locations.showField, fluid.showField ? 1 : 0)

    if (fluid.showField) {
      this.uploadCoils(fluid)
    }

    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3)
  }

  dispose() {
    this.gl.deleteTexture(this.texture)
    this.gl.deleteProgram(this.program)
  }
}
