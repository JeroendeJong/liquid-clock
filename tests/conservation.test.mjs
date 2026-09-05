import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Fluid, DIGIT_PARTICLES, COLON_START, PARTICLES, PARTICLE_DIAMETER } from '../src/simulation.ts'

test('stray fluid at a separator and between colon coils is recaptured by live magnets', () => {
  const fluid = new Fluid(() => new Date(2026,8,6,11,11))
  const probes = [DIGIT_PARTICLES,DIGIT_PARTICLES+1,DIGIT_PARTICLES+2,DIGIT_PARTICLES+3,COLON_START,COLON_START+1,COLON_START+2,COLON_START+3]
  for (let k = 0; k < 4; k++) {
    fluid.x[DIGIT_PARTICLES+k] = -1.56
    fluid.y[DIGIT_PARTICLES+k] = .1+k*.05
    fluid.x[COLON_START+k] = .25
    fluid.y[COLON_START+k] = -.075+k*.05
  }
  const initialX = fluid.x.slice()
  for (let frame = 0; frame < 600; frame++) fluid.update(1/60)
  for (const i of probes) {
    const digit = i < COLON_START ? 1 : -1
    const distance = Math.min(...fluid.coils.filter(c=>c.digit===digit && c.target>0).map(c=>Math.hypot(fluid.x[i]-c.x,fluid.y[i]-c.y)))
    assert.ok(distance < .22, `particle ${i} remained stranded ${distance.toFixed(3)} from a live coil`)
    assert.ok(Math.abs(fluid.x[i]-initialX[i]) > .04, 'the particle must travel out of the gap')
  }
  assert.ok(Math.abs(fluid.height.reduce((a,b)=>a+b,0)/fluid.initialMass-1) < 1e-11)
})

test('mass remains finite, nonnegative and conserved through changing fields and release', () => {
  const fluid = new Fluid()
  const count = fluid.height.length
  assert.equal(fluid.x.length, PARTICLES)
  assert.ok(Math.abs(fluid.initialMass - 1568) < 1e-10, 'finer resolution must retain the original liquid charge')
  assert.ok(Math.abs(DIGIT_PARTICLES * PARTICLE_DIAMETER ** 2 - 340 * .048 ** 2) <= PARTICLE_DIAMETER ** 2 / 2 + 1e-10, 'the packing area of each numeral must be preserved within particle-count rounding')
  for (let frame = 0; frame < 600; frame++) {
    if (frame % 90 === 0) fluid.advance()
    if (frame === 200) fluid.released = true
    if (frame === 400) fluid.released = false
    fluid.update(frame % 100 === 0 ? .05 : 1 / 60)
    if (frame % 30 === 0) {
      assert.equal(fluid.height.length, count)
      assert.ok(Math.abs(fluid.mass() / fluid.initialMass - 1) < 1e-11)
      assert.ok(Math.abs(fluid.height.reduce((a,b)=>a+b,0) / fluid.initialMass - 1) < 1e-11, 'rendered mass must account for every particle')
      for (const h of fluid.height) assert.ok(Number.isFinite(h) && h >= 0)
      for (const y of fluid.y) assert.ok(Number.isFinite(y) && y >= -1.37 && y <= 1.37)
    }
  }
})

test('switching coils does not rewrite the liquid state', () => {
  const fluid = new Fluid()
  const before = fluid.height.slice()
  fluid.advance()
  fluid.update(0)
  assert.deepEqual(fluid.height, before)
  fluid.released = true
  fluid.update(0)
  assert.deepEqual(fluid.height, before)
})

test('magnets lift foreground fluid; release drops the same supply to the bottom', () => {
  const fluid = new Fluid(() => new Date(2026,8,6,8,8))
  const center = () => fluid.y.reduce((sum,y)=>sum+y,0)/fluid.y.length
  const resting = center()
  for (let i = 0; i < 600; i++) fluid.update(1 / 60)
  assert.ok(center() > resting+.6, 'the field must lift liquid out of the bottom reservoir')
  for (const coil of fluid.coils.filter(c => c.target > 0)) {
    assert.ok(fluid.x.some((x,i)=>(x-coil.x)**2+(fluid.y[i]-coil.y)**2 < .12**2), `dense 08:08 pattern has an unfilled coil in digit ${coil.digit}, segment ${coil.segment}`)
  }
  assert.ok(fluid.height.filter(h => h === 0).length > fluid.height.length*.5, 'most of the face must be genuinely empty, without a film')
  const beforeIdle = fluid.x.slice()
  for (let i = 0; i < 60; i++) fluid.update(1/60)
  assert.ok(fluid.x.some((x,i)=>Math.abs(x-beforeIdle[i])>.003), 'idle currents must move actual liquid at a fixed time')
  fluid.released = true
  for (let i = 0; i < 600; i++) fluid.update(1 / 60)
  assert.ok(center() < -1.1, 'gravity must collect liquid at the bottom, not spread it over the face')
  assert.ok(fluid.y.filter(y=>y < -.85).length > fluid.y.length*.95)
  assert.ok(Math.max(...fluid.potential) < 1e-5)
  assert.ok(Math.abs(fluid.mass() / fluid.initialMass - 1) < 1e-11)
  fluid.released = false
  for (let i = 0; i < 600; i++) fluid.update(1 / 60)
  assert.ok(center() > -.5, 'reactivation must lift the existing reservoir without respawning')
})
