import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Fluid, SURFACE_NX, SURFACE_NY, WIDTH } from '../src/simulation.ts'

// Measure visible detached pools, rather than requiring particles to be frozen.
function detachedFraction(fluid, left, right) {
  const minX = Math.ceil((left/WIDTH+.5)*SURFACE_NX)
  const maxX = Math.floor((right/WIDTH+.5)*SURFACE_NX)-1
  const seen = new Uint8Array(fluid.height.length)
  const queue = new Int32Array(fluid.height.length)
  let total = 0, largest = 0
  for (let y = 0; y < SURFACE_NY; y++) for (let x = minX; x <= maxX; x++) {
    const start = y*SURFACE_NX+x
    if (seen[start] || fluid.height[start] < .0025) continue
    let head = 0, tail = 1, mass = 0
    queue[0] = start; seen[start] = 1
    while (head < tail) {
      const i = queue[head++], px = i%SURFACE_NX, py = Math.floor(i/SURFACE_NX)
      mass += fluid.height[i]
      for (const j of [px > minX ? i-1 : -1, px < maxX ? i+1 : -1, py > 0 ? i-SURFACE_NX : -1, py < SURFACE_NY-1 ? i+SURFACE_NX : -1]) {
        if (j < 0 || seen[j] || fluid.height[j] < .0025) continue
        seen[j] = 1; queue[tail++] = j
      }
    }
    total += mass; largest = Math.max(largest,mass)
  }
  assert.ok(total > 0)
  return 1-largest/total
}

test('resting ones remain cohesive while their liquid keeps moving', () => {
  const fluid = new Fluid(() => new Date(2026,8,6,11,11))
  for (let frame = 0; frame < 600; frame++) fluid.update(1/60)
  const before = fluid.x.slice()
  let worst = 0
  for (let frame = 0; frame < 180; frame++) {
    fluid.update(1/60)
    if (frame%30 === 29) for (const [left,right] of [[-3.2,-1.6],[-1.6,-.32],[.32,1.6],[1.6,3.2]]) {
      worst = Math.max(worst,detachedFraction(fluid,left,right))
    }
  }
  assert.ok(worst < .01, `detached visible mass reached ${(worst*100).toFixed(3)}%`)
  assert.ok(fluid.x.some((x,i)=>Math.abs(x-before[i])>.003), 'cohesion must not freeze idle motion')
})
