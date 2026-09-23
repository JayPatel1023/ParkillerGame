// Requested directly ("마우스 지시자표시도 애니메이션효과를 넣어멋지게 아이들의 동심에 맞게 만들어줘" -
// give the mouse cursor indicator an animation too, cool, fitting a child's sense of wonder): a
// plain CSS `cursor: url(...)` (interactiveCursor.ts's own INTERACTIVE_CURSOR) is a single static
// image - no browser animates a cursor image, so "animated cursor" can't be done by swapping that
// value for a fancier one. InteractiveCursorOverlay.tsx renders an actual DOM element that follows
// the pointer instead, which CSS keyframes can animate freely - this tiny pub-sub is how
// PieceMesh/DiceMesh/ParkillerMesh's own onPointerOver/Out handlers (unchanged in every other way)
// tell that overlay component to show/hide, without each of those three files needing to reach into
// React state or import the overlay component directly.
type Listener = (active: boolean) => void

const listeners = new Set<Listener>()
let active = false

export function setInteractiveCursorActive(next: boolean): void {
  if (active === next) return
  active = next
  listeners.forEach((listener) => listener(active))
}

export function subscribeInteractiveCursor(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
