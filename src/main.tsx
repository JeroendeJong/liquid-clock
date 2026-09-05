import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Fluid, formatTime } from './simulation'
import { Renderer } from './renderer'
import './style.css'

export function App() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const engine = useRef<Fluid | null>(null)
  const [released, setReleased] = useState(false)
  const [demo, setDemo] = useState(false)
  const [field, setField] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [stats, setStats] = useState({ fps: 0, mass: 100, time: formatTime(new Date()) })
  const [error, setError] = useState('')
  useEffect(() => {
    let frame = 0
    let renderer: Renderer
    const fluid = new Fluid()
    engine.current = fluid
    try { renderer = new Renderer(canvas.current!) } catch (e) {
      queueMicrotask(() => setError(e instanceof Error ? e.message : String(e)))
      return
    }
    let previous = performance.now(), lastReport = previous, frames = 0
    const animate = (now: number) => {
      const elapsed = Math.min((now - previous) / 1000, 0.05)
      previous = now
      fluid.update(elapsed)
      renderer.draw(fluid, now / 1000)
      frames++
      if (now - lastReport > 1000) {
        setStats({ fps: Math.round(frames * 1000 / (now - lastReport)), mass: fluid.mass() / fluid.initialMass * 100, time: fluid.time })
        frames = 0
        lastReport = now
      }
      frame = requestAnimationFrame(animate)
    }
    frame = requestAnimationFrame(animate)
    return () => { cancelAnimationFrame(frame); renderer.dispose(); engine.current = null }
  }, [])
  return <main>
    <section className="instrument" aria-label={`Ferrofluid clock displaying ${stats.time}`}>
      <canvas ref={canvas} aria-label="Three-dimensional simulated ferrofluid, attracted by clock-shaped electromagnet patterns" />
      {error && <div className="error">{error}</div>}
    </section>
    <div className="menu">
      <button className="menu-toggle" aria-label="Open actions" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>+</button>
      {menuOpen && <div className="menu-items">
        <button onClick={() => { engine.current!.advance(); setDemo(true) }} disabled={released || !!error}>Advance one minute</button>
        <button disabled={!!error} aria-pressed={released} onClick={() => { const next = !released; engine.current!.released = next; setReleased(next) }}>{released ? 'Activate magnets' : 'Release magnets'}</button>
        <button disabled={!!error} aria-pressed={field} onClick={() => { engine.current!.showField = !field; setField(!field) }}>{field ? 'Hide coils' : 'Reveal coils'}</button>
        {demo && <button onClick={() => { engine.current!.resetTime(); setDemo(false) }}>Live time</button>}
      </div>}
    </div>
  </main>
}
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
