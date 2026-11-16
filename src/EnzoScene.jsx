import { useEffect, useRef, useState } from 'react'
import { createScene, DEFAULT_PARAMS } from './lib/scene.ts'
import { createFlameLayer } from './lib/flame-layer.ts'
import { createGpuWorld } from './lib/gpu-world.ts'

const KEYS = Object.keys(DEFAULT_PARAMS)

const HINTS = {
  top: 'Move to steer · Click to roll · Hold for throttle and smoke · B to bomb · V to walk · Space for chase view',
  chase: 'Point to turn, climb and dive · Click to roll · Hold for throttle and smoke · B to bomb · V to walk · Space for the cockpit',
  cockpit: 'Point to turn, climb and dive · Click to roll · Hold for throttle and smoke · B to bomb · V to walk · Space for overhead',
}

const TOUCH_HINTS = {
  top: 'Touch to steer · Tap to roll · Hold Boost · Bomb the houses · View for chase view',
  chase: 'Touch to turn, climb and dive · Tap to roll · Hold Boost · Bomb · View for the cockpit',
  cockpit: 'Touch to turn, climb and dive · Tap to roll · Hold Boost · Bomb · View for overhead',
}

const viewOf = (v) => (v === 'cockpit' ? 'cockpit' : v === 'chase' ? 'chase' : 'top')

const FLY = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ShiftLeft: 'boost', ShiftRight: 'boost',
  TouchBoost: 'boost',
  KeyB: 'bomb',
  KeyF: 'bomb',
  TouchBomb: 'bomb',
}

export default function EnzoScene({ pixelSize = 0, showHint = true, touchControls = 'auto', ...rest }) {
  const [noFire, setNoFire] = useState(false)
  const [fingerScreen, setFingerScreen] = useState(false)
  useEffect(() => {
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) setFingerScreen(true)
  }, [])
  const buttons = touchControls === 'on' || (touchControls === 'auto' && fingerScreen)
  const [boosting, setBoosting] = useState(false)
  const [bombing, setBombing] = useState(false)
  const [onFoot, setOnFoot] = useState(false)
  const [aboard, setAboard] = useState(false)
  const [footView, setFootView] = useState('above')
  const heldRef = useRef(new Set())
  const sendKeysRef = useRef(() => {})
  const steerRef = useRef(null)

  const params = { ...DEFAULT_PARAMS }
  for (const k of KEYS) {
    const v = rest[k]
    if (v !== undefined && v !== null) params[k] = v
  }
  if (noFire) params.flameStyle = 'pixel'
  const signature = JSON.stringify(params)

  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const fireRef = useRef(null)
  const sceneRef = useRef(null)
  const paramsRef = useRef(params)
  const pixelRef = useRef(pixelSize)
  const scaleRef = useRef(4)
  const layoutRef = useRef(() => {})
  const [hint, setHint] = useState({ mode: viewOf(params.view), on: true })
  const hintTimer = useRef(0)
  const revealHint = (mode, seconds) => {
    setHint({ mode, on: true })
    window.clearTimeout(hintTimer.current)
    hintTimer.current = window.setTimeout(() => setHint((h) => ({ ...h, on: false })), seconds * 1000)
  }
  const revealHintRef = useRef(revealHint)
  revealHintRef.current = revealHint
  paramsRef.current = params
  pixelRef.current = pixelSize

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const scene = createScene(paramsRef.current)
    sceneRef.current = scene
    // the ground and clouds are drawn on the graphics card when it can (add ?cpu to the address to
    // draw them on the CPU instead)
    const gpu = new URLSearchParams(window.location.search).has('cpu') ? null : createGpuWorld()
    scene.setGpu(gpu)
    if (import.meta.env.DEV) window.enzoScene = scene
    let image = null
    const fire = fireRef.current
    let layer = null
    let fireDead = false
    const onFireLost = (e) => {
      e.preventDefault()
      layer = null
      fireDead = true
      setNoFire(true)
    }
    fire?.addEventListener('webglcontextlost', onFireLost)

    const layout = () => {
      const cw = wrap.clientWidth
      const ch = wrap.clientHeight
      if (!cw || !ch) return
      const auto = Math.min(12, Math.max(2, Math.round(Math.sqrt((cw * ch) / 100000))))
      const px = pixelRef.current > 0 ? Math.round(pixelRef.current) : auto
      const lw = Math.ceil(cw / px)
      const lh = Math.ceil(ch / px)
      const sizeChanged = canvas.width !== lw || canvas.height !== lh
      if (sizeChanged) {
        canvas.width = lw
        canvas.height = lh
        image = null
      }
      // A fresh scene starts at 0×0. The canvas can already be the right size
      // (React remounts the effect without clearing it), so check the scene too.
      if (sizeChanged || scene.width !== lw || scene.height !== lh) {
        scene.resize(lw, lh)
        image = null
      }
      canvas.style.width = lw * px + 'px'
      canvas.style.height = lh * px + 'px'
      canvas.style.left = Math.round((cw - lw * px) / 2) + 'px'
      canvas.style.top = Math.round((ch - lh * px) / 2) + 'px'
      if (fire) {
        const dpr = Math.min(2, window.devicePixelRatio || 1)
        const fw = Math.round(lw * px * dpr)
        const fh = Math.round(lh * px * dpr)
        if (fire.width !== fw || fire.height !== fh) {
          fire.width = fw
          fire.height = fh
        }
        fire.style.width = canvas.style.width
        fire.style.height = canvas.style.height
        fire.style.left = canvas.style.left
        fire.style.top = canvas.style.top
      }
      scaleRef.current = px
    }
    layoutRef.current = layout
    layout()
    const ro = new ResizeObserver(layout)
    ro.observe(wrap)

    let raf = 0
    let last = performance.now()
    const frame = (now) => {
      raf = requestAnimationFrame(frame)
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000))
      last = now
      if (!scene.width) return
      scene.step(dt)
      const bytes = scene.render()
      if (!image || image.width !== scene.width || image.height !== scene.height) {
        image = new ImageData(scene.width, scene.height)
      }
      image.data.set(bytes)
      ctx.putImageData(image, 0, 0)
      const flames = scene.flames
      if (fire && flames.count > 0 && !layer && !fireDead) {
        layer = createFlameLayer(fire)
        if (!layer) {
          fireDead = true
          setNoFire(true)
        }
      }
      if (fire && layer) layer.draw(flames.count, flames.data, fire.width / scene.width, now / 1000)
    }
    raf = requestAnimationFrame(frame)

    const held = heldRef.current
    held.clear()
    const sendKeys = () => {
      let turn = 0
      let climb = 0
      let boost = false
      let bomb = false
      let move = 0
      held.forEach((code) => {
        const k = FLY[code]
        if (k === 'left') turn -= 1
        else if (k === 'right') turn += 1
        else if (k === 'up') { climb -= 1; move += 1 }
        else if (k === 'down') { climb += 1; move -= 1 }
        else if (k === 'boost') boost = true
        else if (k === 'bomb') bomb = true
      })
      if (scene.onFoot) {
        scene.setWalk(turn, move)
        scene.setKeys(0, 0, false)
        scene.setBomb(false)
      } else {
        scene.setWalk(0, 0)
        scene.setKeys(turn, climb, boost)
        scene.setBomb(bomb)
      }
    }
    sendKeysRef.current = sendKeys
    const typing = (e) => {
      const el = e.target
      return !!el && el !== wrap && (/^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(el.tagName) || el.isContentEditable)
    }
    const onKey = (e) => {
      if (typing(e)) return
      if (e.code === 'KeyV' && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        scene.toggleFoot()
        sendKeys()
        setOnFoot(scene.onFoot)
        setAboard(scene.aboard)
        setFootView(scene.footView)
        if (!scene.onFoot) revealHintRef.current(scene.view, 7)
        return
      }
      if (e.code === 'KeyE' && !e.repeat && scene.onFoot && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        scene.board()
        setAboard(scene.aboard)
        return
      }
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault()
        if (e.repeat) return
        if (scene.onFoot) {
          scene.toggleFootView()
          setFootView(scene.footView)
          return
        }
        scene.toggleView()
        revealHintRef.current(scene.view, 7)
        return
      }
      if (FLY[e.code] && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.code.startsWith('Arrow')) e.preventDefault()
        held.add(e.code)
        sendKeys()
      }
    }
    const onKeyUp = (e) => {
      if (held.delete(e.code)) sendKeys()
    }
    const onBlur = () => {
      held.clear()
      sendKeys()
      setBoosting(false)
      setBombing(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      window.clearTimeout(hintTimer.current)
      fire?.removeEventListener('webglcontextlost', onFireLost)
      layer?.dispose()
      gpu?.dispose()
      sceneRef.current = null
    }
  }, [])

  useEffect(() => {
    sceneRef.current?.setParams(paramsRef.current)
  }, [signature])

  useEffect(() => {
    layoutRef.current()
  }, [pixelSize])

  const firstView = useRef(true)
  useEffect(() => {
    if (firstView.current) {
      firstView.current = false
      return
    }
    revealHintRef.current(viewOf(params.view), 7)
  }, [params.view])

  const toScene = (e) => {
    const r = canvasRef.current.getBoundingClientRect()
    return [(e.clientX - r.left) / scaleRef.current, (e.clientY - r.top) / scaleRef.current]
  }

  const byFinger = (e) => touchControls !== 'off' && e.pointerType === 'touch'
  const endFinger = (e, tap) => {
    const s = steerRef.current
    if (!s || s.id !== e.pointerId) return
    steerRef.current = null
    const scene = sceneRef.current
    if (!scene) return
    if (tap && !s.moved && performance.now() - s.t < 260) {
      scene.press()
      scene.release()
    }
    scene.pointerLeave()
  }
  const mine = (e) => e.stopPropagation()
  const nextView = () => {
    const scene = sceneRef.current
    if (!scene) return
    if (scene.onFoot) {
      scene.toggleFootView()
      setFootView(scene.footView)
    } else {
      scene.toggleView()
      revealHint(scene.view, 7)
    }
    wrapRef.current?.focus({ preventScroll: true })
  }
  const boostOn = (e) => {
    e.stopPropagation()
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* touch already ended */ }
    heldRef.current.add('TouchBoost')
    sendKeysRef.current()
    setBoosting(true)
  }
  const boostOff = (e) => {
    e.stopPropagation()
    heldRef.current.delete('TouchBoost')
    sendKeysRef.current()
    setBoosting(false)
    wrapRef.current?.focus({ preventScroll: true })
  }
  const bombOn = (e) => {
    e.stopPropagation()
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* touch already ended */ }
    heldRef.current.add('TouchBomb')
    sendKeysRef.current()
    sceneRef.current?.dropBomb()
    setBombing(true)
  }
  const bombOff = (e) => {
    e.stopPropagation()
    heldRef.current.delete('TouchBomb')
    sendKeysRef.current()
    setBombing(false)
    wrapRef.current?.focus({ preventScroll: true })
  }
  const hints = buttons ? TOUCH_HINTS : HINTS
  const footHint = !onFoot ? null
    : aboard
      ? (footView === 'first'
        ? 'W starts · S stops · A D turn · downwind is faster · E ashore · Space for overhead · V back to the plane'
        : 'W starts · S stops · A D turn · downwind is faster · E ashore · Space for first person · V back to the plane')
      : (footView === 'first'
        ? 'WASD walks · E hops on a boat · Space for overhead · V back to the plane'
        : 'WASD walks · E hops on a boat · Space for first person · V back to the plane')
  const buttonLook =
    'absolute flex h-14 w-[4.5rem] cursor-pointer select-none items-center justify-center rounded-[4px] border font-mono text-[11px] uppercase leading-none tracking-[0.14em] text-white/90 outline-none transition-colors duration-100 focus-visible:border-white'

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      className="relative h-screen min-h-[320px] w-full touch-none select-none overflow-hidden bg-[#2468b4] outline-none"
      style={{ cursor: 'crosshair', height: '100dvh', WebkitTouchCallout: 'none', WebkitTapHighlightColor: 'transparent' }}
      onContextMenu={(e) => { if (fingerScreen) e.preventDefault() }}
      onPointerEnter={() => wrapRef.current?.focus({ preventScroll: true })}
      onPointerMove={(e) => {
        if (byFinger(e)) {
          const s = steerRef.current
          if (!s || s.id !== e.pointerId) return
          if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > 12) s.moved = true
        }
        const [x, y] = toScene(e)
        sceneRef.current?.pointerMove(x, y)
      }}
      onPointerDown={(e) => {
        const [x, y] = toScene(e)
        if (byFinger(e)) {
          if (!fingerScreen) setFingerScreen(true)
          if (steerRef.current) return
          steerRef.current = { id: e.pointerId, t: performance.now(), x: e.clientX, y: e.clientY, moved: false }
          sceneRef.current?.pointerMove(x, y)
        } else {
          sceneRef.current?.pointerMove(x, y)
          sceneRef.current?.press()
        }
        wrapRef.current?.focus({ preventScroll: true })
        if (!hintTimer.current) hintTimer.current = window.setTimeout(() => setHint((h) => ({ ...h, on: false })), 9000)
      }}
      onPointerUp={(e) => {
        if (byFinger(e)) endFinger(e, true)
        else sceneRef.current?.release()
      }}
      onPointerLeave={(e) => {
        if (byFinger(e)) endFinger(e, false)
        else sceneRef.current?.pointerLeave()
      }}
      onPointerCancel={(e) => {
        if (byFinger(e)) endFinger(e, false)
        else sceneRef.current?.pointerLeave()
      }}
    >
      <canvas
        ref={canvasRef}
        aria-label="Enzo's day: a pixel-art 1920s biplane, built from stacked slices, flying over islands. Space moves between the overhead view, the view from behind the plane and the open cockpit; arrow keys fly it, Shift opens the throttle and trails smoke, and B drops a bomb."
        role="img"
        className="absolute block"
        style={{ imageRendering: 'pixelated' }}
      />
      <canvas ref={fireRef} aria-hidden="true" className="pointer-events-none absolute block" />
      {showHint && (
        <div
          className={`pointer-events-none absolute inset-x-0 flex justify-center px-4 transition-opacity duration-700 ${buttons || hint.mode === 'cockpit' || (onFoot && footView === 'first') ? 'top-4' : 'bottom-4'}`}
          style={{ opacity: onFoot || hint.on ? 1 : 0 }}
        >
          <p
            className="rounded-[3px] bg-[#0b1a33]/55 px-2.5 py-1.5 text-center font-mono text-[11px] uppercase leading-none tracking-[0.14em] text-white/90"
            style={{ textShadow: '0 1px 0 rgba(0,0,0,.45)' }}
          >
            {footHint || hints[hint.mode]}
          </p>
        </div>
      )}
      {buttons && (
        <>
          <button
            type="button"
            aria-label="Change view"
            className={`${buttonLook} border-white/30 bg-[#0b1a33]/60 active:bg-[#0b1a33]/90`}
            style={{ left: 'max(14px, env(safe-area-inset-left))', bottom: 'max(14px, env(safe-area-inset-bottom))', touchAction: 'none' }}
            onClick={nextView}
            onPointerDown={mine}
            onPointerMove={mine}
            onPointerUp={mine}
          >
            View
          </button>
          <button
            type="button"
            aria-label="Drop a bomb"
            aria-pressed={bombing}
            className={`${buttonLook} ${bombing ? 'border-white/70 bg-[#7a2418]/90' : 'border-white/30 bg-[#0b1a33]/60'}`}
            style={{
              right: 'max(14px, env(safe-area-inset-right))',
              bottom: 'calc(max(14px, env(safe-area-inset-bottom)) + 68px)',
              touchAction: 'none',
            }}
            onPointerDown={bombOn}
            onPointerMove={mine}
            onPointerUp={bombOff}
            onPointerCancel={bombOff}
            onLostPointerCapture={bombOff}
            onContextMenu={(e) => e.preventDefault()}
          >
            Bomb
          </button>
          <button
            type="button"
            aria-label="Throttle: hold to open it and trail smoke"
            aria-pressed={boosting}
            className={`${buttonLook} ${boosting ? 'border-white/70' : 'border-white/30 bg-[#0b1a33]/60'}`}
            style={{
              right: 'max(14px, env(safe-area-inset-right))',
              bottom: 'max(14px, env(safe-area-inset-bottom))',
              touchAction: 'none',
              backgroundColor: boosting ? params.accentColor : undefined,
            }}
            onPointerDown={boostOn}
            onPointerMove={mine}
            onPointerUp={boostOff}
            onPointerCancel={boostOff}
            onLostPointerCapture={boostOff}
            onContextMenu={(e) => e.preventDefault()}
          >
            Boost
          </button>
        </>
      )}
    </div>
  )
}
