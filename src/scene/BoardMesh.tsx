import { useTexture } from '@react-three/drei'
import { BOARD_SIZE } from './boardGeometry'

export function BoardMesh({ imageUrl }: { imageUrl: string }) {
  const texture = useTexture(imageUrl)
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[BOARD_SIZE, BOARD_SIZE]} />
      <meshStandardMaterial map={texture} />
    </mesh>
  )
}
