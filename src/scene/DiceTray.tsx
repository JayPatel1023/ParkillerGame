import { extend } from '@react-three/fiber'
import { RoundedBoxGeometry } from 'three-stdlib'

// Registration only - the `roundedBoxGeometry` JSX element type itself is already declared
// globally by DiceMesh.tsx (same class), which always mounts alongside this in BoardScene's
// Canvas; redeclaring it here would conflict if the two declarations ever drifted apart.
extend({ RoundedBoxGeometry })

// A small real 3D tray under the dice (see DiceMesh's own CORNER_X/CORNER_Z) instead of an HTML
// backdrop - the dice are real 3D objects, so anything meant to visually "hold" them has to live
// in the same 3D space to stay aligned as the camera/viewport changes. Two stacked rounded plates
// - a gold base peeking out as a thin trim ring, a dark felt-green top inset within it - echoes
// the "dark wood + dark green felt + subtle gold trim" tray described directly, using the same
// RoundedBoxGeometry trick already used for the dice themselves.
export function DiceTray({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, -0.012, 0]} receiveShadow>
        <roundedBoxGeometry args={[1.68, 0.045, 1.1, 3, 0.09]} />
        <meshStandardMaterial color="#c9a24b" roughness={0.4} metalness={0.4} />
      </mesh>
      <mesh position={[0, 0.006, 0]} receiveShadow>
        <roundedBoxGeometry args={[1.5, 0.045, 0.92, 3, 0.08]} />
        <meshStandardMaterial color="#1f3326" roughness={0.85} metalness={0.05} />
      </mesh>
    </group>
  )
}
