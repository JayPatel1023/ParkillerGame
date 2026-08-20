import { useMemo, useRef } from 'react'
import { extend, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Group } from 'three'
import { RoundedBoxGeometry } from 'three-stdlib'

extend({ RoundedBoxGeometry })

// Reported directly, with a screenshot of the earlier flat 2D popup ("이런식으로 만들지 말고 말을
// 눌렀을때 말우에 주사위가 현시되면서 선택할수잇게 해달라" - not like this, show the dice floating
// above the piece itself so you can pick from there): a piece reachable by more than one die used to
// open a centered text-button dialog, which read as a generic web form dropped onto an otherwise
// fully 3D board. These render as small floating markers directly above the clicked piece instead -
// same glossy rounded-box material language as the real dice (DiceMesh.tsx), just showing a plain
// numeral rather than pips, since a choice can be a die's own face value (1-6) or the two dice's sum
// (up to 12) - pips alone can't represent that range.
const MARKER_SIZE = 0.34
const HOVER_HEIGHT = 0.85
const MARKER_SPACING = 0.46
const BOB_HEIGHT = 0.05
const BOB_FREQ = 2.2

function createNumberFaceTexture(text: string): THREE.CanvasTexture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  const bg = ctx.createRadialGradient(size * 0.4, size * 0.35, size * 0.1, size * 0.5, size * 0.5, size * 0.75)
  bg.addColorStop(0, '#4a86f0')
  bg.addColorStop(1, '#1a4bb8')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, size, size)

  ctx.fillStyle = '#ffffff'
  ctx.font = `800 ${size * 0.52}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = 'rgba(0,0,0,0.45)'
  ctx.shadowBlur = size * 0.04
  ctx.fillText(text, size / 2, size / 2 + size * 0.015)

  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

function SingleMarker({
  position,
  amount,
  onClick,
  phaseOffset,
}: {
  position: [number, number, number]
  amount: number
  onClick: () => void
  phaseOffset: number
}) {
  const groupRef = useRef<Group>(null)
  const faceTexture = useMemo(() => createNumberFaceTexture(String(amount)), [amount])
  // Six *distinct* material instances, even though four are visually identical - reusing the same
  // object across more than one <primitive attach="material-N"> (as an earlier version of this did)
  // throws inside three's own render path ("Cannot read properties of undefined (reading 'side')"),
  // reproduced directly. Matches DiceMesh's own array-of-6-distinct-materials pattern for exactly
  // this reason. Box face order is [+x, -x, +y (top), -y (bottom), +z, -z] - the numeral goes on
  // top, same convention DiceMesh uses for its own pip face.
  const materials = useMemo(() => {
    const side = () => new THREE.MeshPhysicalMaterial({ color: '#2a5bc4', roughness: 0.3, clearcoat: 0.5 })
    const face = () => new THREE.MeshPhysicalMaterial({ map: faceTexture, roughness: 0.25, clearcoat: 0.7, clearcoatRoughness: 0.2 })
    return [side(), side(), face(), side(), side(), side()]
  }, [faceTexture])

  useFrame((state) => {
    const group = groupRef.current
    if (!group) return
    const t = state.clock.elapsedTime + phaseOffset
    group.position.set(position[0], position[1] + Math.sin(t * BOB_FREQ) * BOB_HEIGHT, position[2])
    group.rotation.y = Math.sin(t * 0.6) * 0.18
  })

  return (
    <group ref={groupRef} position={position}>
      <mesh onClick={onClick} castShadow>
        <roundedBoxGeometry args={[MARKER_SIZE, MARKER_SIZE, MARKER_SIZE, 4, MARKER_SIZE * 0.18]} />
        {materials.map((mat, i) => (
          <primitive key={i} object={mat} attach={`material-${i}`} />
        ))}
      </mesh>
    </group>
  )
}

/** One floating marker per legal amount, arranged in a small row hovering above `anchor` (the
 * chosen piece's own world rest position) - clicking one resolves the choice with that amount. */
export function PieceChoiceMarkers({
  anchor,
  amounts,
  onChoose,
}: {
  anchor: [number, number, number]
  amounts: number[]
  onChoose: (amount: number) => void
}) {
  const startX = -((amounts.length - 1) * MARKER_SPACING) / 2
  return (
    <>
      {amounts.map((amount, i) => (
        <SingleMarker
          key={`${amount}-${i}`}
          position={[anchor[0] + startX + i * MARKER_SPACING, anchor[1] + HOVER_HEIGHT, anchor[2]]}
          amount={amount}
          onClick={() => onChoose(amount)}
          phaseOffset={i * 0.5}
        />
      ))}
    </>
  )
}
