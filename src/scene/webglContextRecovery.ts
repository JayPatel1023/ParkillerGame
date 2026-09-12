import { useCallback, useRef, useState } from 'react'
import type { WebGLRenderer } from 'three'

// Reported directly, via a browser console screenshot: "THREE.WebGLRenderer: Context Lost." -
// right after which the board just stayed permanently blank/gray, with nothing in this app ever
// noticing or reacting to it. Confirmed directly against the WebGL spec: a lost context is *not*
// automatically restorable - the browser only fires 'webglcontextrestored' (and actually goes
// looking for a fresh context to hand back) if the page's own 'webglcontextlost' handler calls
// event.preventDefault() when it happens. Without a handler here at all (this codebase had none,
// on either <Canvas>), a real, ordinary-enough browser/GPU event (a driver reset, the OS reclaiming
// GPU memory under pressure, a backgrounded tab's context getting reclaimed) turned into a
// permanently dead canvas for the rest of that session - not a network or file-size problem at
// all, confirmed by that same console log showing a perfectly healthy, already-completed Photon
// connection right alongside the context loss.
//
// Three.js's own WebGLRenderer already re-uploads every live geometry/texture/material back to the
// GPU automatically on the next render call once a context is actually restored - the JS-side
// scene graph objects were never touched by a context loss, only their GPU-side resources - so
// nothing further is needed here beyond allowing that restoration to happen at all and giving the
// player some visible sign of what happened while it does.
export function watchForContextLoss(gl: WebGLRenderer, onLost?: () => void, onRestored?: () => void): () => void {
  const canvas = gl.domElement
  const handleLost = (event: Event) => {
    event.preventDefault()
    onLost?.()
  }
  const handleRestored = () => {
    onRestored?.()
  }
  canvas.addEventListener('webglcontextlost', handleLost, false)
  canvas.addEventListener('webglcontextrestored', handleRestored, false)
  return () => {
    canvas.removeEventListener('webglcontextlost', handleLost)
    canvas.removeEventListener('webglcontextrestored', handleRestored)
  }
}

// Reported directly, again, months after the fix above shipped and had already been confirmed
// working once ("SIGUE HABIENDO VACIOS DE PANTALLA SIN TABLERO" - there continue to be blank
// screens with no board): a screenshot showed the board *and* the dice both rendering with no
// texture at all, mid-game, sitting on the color-draw screen. The dice pips are drawn onto an
// in-memory <canvas> and uploaded as a THREE.CanvasTexture - no network fetch, no shared cache,
// nothing that a stalled image request could ever explain - so a texture-loading bug (the other
// failure mode this app already has retry logic for, see useRobustTexture.ts) can't produce this
// combination on its own. Every GPU-side texture going blank *together*, board and dice alike, is
// exactly what a context loss looks like - watchForContextLoss above already handles the *ordinary*
// case (the browser fires 'webglcontextrestored' once it manages to hand back a working context,
// and Three.js re-uploads everything automatically from there) - but restoration was never
// guaranteed by the WebGL spec, only *possible*: a browser/driver that can't actually recover a
// context (GPU resource exhaustion from this same page having created and torn down several other
// canvases already - see OnlineLobbyScreen.tsx's own several separate StartScreenBackground mount
// points - a stricter mobile GPU budget, or just a driver that gives up) can leave a page's own
// 'webglcontextlost' handler waiting on an event that simply never comes, exactly the permanently
// blank board this report describes. Passive waiting has no way to distinguish "still trying" from
// "never coming" - only a timeout can. If restoration hasn't happened by then, forcing a full
// remount (a fresh `<Canvas key={...}>`, not just calling the WebGLRenderer's own methods again)
// tears down whatever's left of the broken context and lets the browser allocate a genuinely new
// one from scratch, the same recovery a full page reload would force, without actually reloading
// the page (and losing this client's live game/Photon connection to do it).
const STUCK_CONTEXT_REMOUNT_MS = 4000

/**
 * Pairs with a `<Canvas key={canvasKey} onCreated={onCreated}>` - remounts the canvas (a fresh
 * WebGLRenderer/context, not just re-running this same renderer's own methods) if a context loss
 * hasn't self-restored within STUCK_CONTEXT_REMOUNT_MS, instead of trusting the browser's own
 * 'webglcontextrestored' event to always eventually fire. `label` is only for the console
 * messages, so a report naming which screen's board is affected is unambiguous.
 */
export function useCanvasRemountOnStuckContext(label: string): { canvasKey: number; onCreated: (state: { gl: WebGLRenderer }) => void } {
  const [canvasKey, setCanvasKey] = useState(0)
  const remountTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const onCreated = useCallback(
    ({ gl }: { gl: WebGLRenderer }) => {
      watchForContextLoss(
        gl,
        () => {
          console.warn(`${label}: WebGL context lost - waiting for the browser to restore it`)
          remountTimeoutRef.current = setTimeout(() => {
            remountTimeoutRef.current = null
            console.warn(`${label}: context still lost after ${STUCK_CONTEXT_REMOUNT_MS}ms - forcing a fresh canvas`)
            setCanvasKey((key) => key + 1)
          }, STUCK_CONTEXT_REMOUNT_MS)
        },
        () => {
          console.info(`${label}: WebGL context restored`)
          if (remountTimeoutRef.current) {
            clearTimeout(remountTimeoutRef.current)
            remountTimeoutRef.current = null
          }
        },
      )
    },
    [label],
  )

  return { canvasKey, onCreated }
}
