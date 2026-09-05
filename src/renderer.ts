import { Fluid, SURFACE_NX, SURFACE_NY } from './simulation'

const vertex = `#version 300 es
precision highp float;
out vec2 uv;
void main(){ vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2); uv=p; gl_Position=vec4(p*2.-1.,0,1); }
`
const fragment = `#version 300 es
precision highp float;
uniform sampler2D state;
uniform vec2 resolution;
uniform float showField;
uniform vec4 coils[254];
in vec2 uv;
out vec4 color;
vec2 sampleState(vec2 p){
  ivec2 size=textureSize(state,0);
  vec2 q=(p/vec2(6.4,2.8)+.5)*vec2(size)-.5;
  ivec2 i=ivec2(floor(q)); vec2 f=fract(q);
  vec2 a=texelFetch(state,clamp(i,ivec2(0),size-1),0).rg;
  vec2 b=texelFetch(state,clamp(i+ivec2(1,0),ivec2(0),size-1),0).rg;
  vec2 c=texelFetch(state,clamp(i+ivec2(0,1),ivec2(0),size-1),0).rg;
  vec2 d=texelFetch(state,clamp(i+ivec2(1),ivec2(0),size-1),0).rg;
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}
float surface(vec2 p){
  return .16*(1.-exp(-sampleState(p).x*4.));
}
float roundBox(vec2 p,vec2 b,float r){vec2 q=abs(p)-b+r;return min(max(q.x,q.y),0.)+length(max(q,0.))-r;}
void main(){
  vec2 screen=(uv-.5)*vec2(6.95,6.95*resolution.y/resolution.x);
  vec3 rd=normalize(vec3(0.,.025,-1.));
  vec3 ro=vec3(screen.x,screen.y-.075,3.);
  vec3 base=ro+rd*(-ro.z/rd.z);
  float wall=roundBox(base.xy,vec2(3.2,1.4),.13);
  vec3 floorColor=vec3(1.);
  if(wall>0.){
    color=vec4(1.);return;
  }
  vec2 s=sampleState(base.xy);
  if(showField>.01){
    float rings=0.;
    for(int i=0;i<254;i++){
      float d=length(base.xy-coils[i].xy);
      rings+=exp(-pow((d-.026)/.004,2.))*(.08+.42*coils[i].z);
    }
    floorColor=mix(floorColor,vec3(0.),clamp(rings,0.,.7)*showField);
  }
  // Ray intersection with the simulated height surface, followed by bisection.
  if(s.x==0. && sampleState(base.xy-vec2(0.,.006)).x==0.){
    color=vec4(pow(floorColor,vec3(1./2.2)),1.);return;
  }
  float start=(ro.z-.22)/(-rd.z), finish=-ro.z/rd.z;
  float t=start, prior=start;
  bool hit=false;
  for(int k=0;k<28;k++){
    t=mix(start,finish,float(k)/27.);
    vec3 p=ro+rd*t;
    if(p.z<=surface(p.xy)){hit=true;break;}
    prior=t;
  }
  vec3 result=floorColor;
  if(hit){
    for(int k=0;k<7;k++){
      float mid=(prior+t)*.5;vec3 p=ro+rd*mid;
      if(p.z>surface(p.xy))prior=mid;else t=mid;
    }
    vec3 p=ro+rd*t;
    s=sampleState(p.xy);
    // One unlit color throughout the liquid. Density/height affect its outline,
    // never its interior color; no particle normals, highlights, or reflections.
    vec3 liquid=vec3(.0015);
    // Opaque foreground liquid; smoothstep covers only the subpixel free edge.
    // Explicit screen footprint remains valid beside empty-space early exits;
    // GPU derivatives inside this divergent branch are not reliable at edges.
    float pixel=6.95/resolution.x;
    vec2 edgeGradient=vec2(
      sampleState(p.xy+vec2(pixel,0)).x-sampleState(p.xy-vec2(pixel,0)).x,
      sampleState(p.xy+vec2(0,pixel)).x-sampleState(p.xy-vec2(0,pixel)).x);
    float opacity=smoothstep(.001,.018+length(edgeGradient)*.15,s.x);
    result=mix(floorColor,liquid,opacity);
  }
  color=vec4(pow(max(result,0.),vec3(1./2.2)),1.);
}
`

export class Renderer {
  private gl: WebGL2RenderingContext
  private program: WebGLProgram
  private texture: WebGLTexture
  private canvas: HTMLCanvasElement
  private locations: Record<string, WebGLUniformLocation | null> = {}
  private coilData = new Float32Array(254*4)
  private pixelRatio = 2
  private previousTime = 0
  private sampleSeconds = 0
  private sampleFrames = 0
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const gl = canvas.getContext('webgl2',{ alpha: false, antialias: false, powerPreference: 'high-performance' })
    if(!gl) throw new Error('This fluid display needs a browser with WebGL 2 enabled.')
    this.gl=gl
    const shaders = [this.compile(gl.VERTEX_SHADER,vertex),this.compile(gl.FRAGMENT_SHADER,fragment)]
    this.program=gl.createProgram()!
    shaders.forEach(shader => gl.attachShader(this.program,shader))
    gl.linkProgram(this.program)
    shaders.forEach(shader => gl.deleteShader(shader))
    if(!gl.getProgramParameter(this.program,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program) || 'Could not initialize the liquid renderer.')
    gl.useProgram(this.program)
    for(const name of ['state','resolution','showField','coils']) this.locations[name]=gl.getUniformLocation(this.program,name)
    this.texture=gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D,this.texture)
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RG32F,SURFACE_NX,SURFACE_NY,0,gl.RG,gl.FLOAT,null)
    gl.uniform1i(this.locations.state,0)
  }
  private compile(type: number,source: string) {
    const gl=this.gl, shader=gl.createShader(type)!
    gl.shaderSource(shader,source);gl.compileShader(shader)
    if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) {
      const message=gl.getShaderInfoLog(shader);gl.deleteShader(shader)
      throw new Error(message || 'Could not compile the liquid shader.')
    }
    return shader
  }
  draw(fluid: Fluid,time: number) {
    const gl=this.gl, canvas=this.canvas
    const elapsed=time-this.previousTime
    this.previousTime=time
    if (elapsed > 0 && elapsed < .25 && !document.hidden) {
      this.sampleSeconds += elapsed
      this.sampleFrames++
      if (this.sampleSeconds >= 2) {
        const frameMs=this.sampleSeconds*1000/this.sampleFrames
        if (frameMs > 23) this.pixelRatio=Math.max(1,this.pixelRatio-.2)
        else if (frameMs < 18) this.pixelRatio=Math.min(2,this.pixelRatio+.1)
        this.sampleSeconds=0; this.sampleFrames=0
      }
    }
    const scale=Math.min(window.devicePixelRatio,this.pixelRatio,1800/Math.max(canvas.clientWidth,1))
    const w=Math.round(canvas.clientWidth*scale),h=Math.round(canvas.clientHeight*scale)
    if(canvas.width!==w || canvas.height!==h){canvas.width=w;canvas.height=h;gl.viewport(0,0,w,h)}
    gl.useProgram(this.program)
    gl.bindTexture(gl.TEXTURE_2D,this.texture)
    gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,SURFACE_NX,SURFACE_NY,gl.RG,gl.FLOAT,fluid.texture)
    gl.uniform2f(this.locations.resolution,w,h)
    gl.uniform1f(this.locations.showField,fluid.showField?1:0)
    if(fluid.showField){
      fluid.coils.forEach((c,i)=>{this.coilData[i*4]=c.x;this.coilData[i*4+1]=c.y;this.coilData[i*4+2]=c.current})
      gl.uniform4fv(this.locations.coils,this.coilData)
    }
    gl.drawArrays(gl.TRIANGLES,0,3)
  }
  dispose(){this.gl.deleteTexture(this.texture);this.gl.deleteProgram(this.program)}
}
