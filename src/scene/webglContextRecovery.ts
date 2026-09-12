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
