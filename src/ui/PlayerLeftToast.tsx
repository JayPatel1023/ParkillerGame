import { useEffect, useRef, useState } from 'react'
import { getColor } from '../core/colorPalette'
import type { PieceColor } from '../core/pieceColor'

// Reported directly, with two screenshots (one side already back at the main menu after
// confirming "Sí, salir", the other side's own screen still showing the game in progress with no
// acknowledgment anything happened) - "이렇게 나왔으면 상대방들에게 알려야지않니?" (shouldn't the
// other players be told when someone leaves like that?). The game already keeps running for
// everyone still connected on purpose (BotController.takeOverColor - OnlineLobbyScreen's own
// onActorLeft handler hands the departed seat to a bot instead of ending the match for the whole
// room over one person leaving), but that handoff happened with zero on-screen acknowledgment -
// silently correct, but reads as "is this stuck?" to whoever's still there. This is that missing
// notice: reuses EliminationToast's own plain pop-in card language (no particle burst - a
// departure isn't a celebration) in a neutral slate palette distinct from both the reward toasts'
// gold and the elimination toasts' red, so it reads as informational, not as a win or a penalty.
//
// Self-clears on its own timer rather than needing the caller to null anything back out -
// GameSession's own departedPlayerNotice (OnlineLobbyScreen.tsx) is a one-shot {color, id} stamped
// once per departure and never reset, so there's no "cleared" signal to react to from the outside.
const VISIBLE_MS = 5000

export function PlayerLeftToast({ notice }: { notice: { color: PieceColor; id: number } | null }) {
  const [visible, setVisible] = useState<{ color: PieceColor; id: number } | null>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastIdRef = useRef<number | null>(null)

  useEffect(() => {
    if (!notice || notice.id === lastIdRef.current) return
    lastIdRef.current = notice.id
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    setVisible(notice)
    hideTimerRef.current = setTimeout(() => setVisible(null), VISIBLE_MS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notice])

  useEffect(() => () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
  }, [])

  if (!visible) return null
  const color = getColor(visible.color)

  return (
    <div key={visible.id} style={wrapperStyle}>
      <div style={cardStyle} className="player-left-toast-pop">
        <div style={{ ...iconStyle, borderColor: color }}>🚪</div>
        <div style={titleStyle}>Jugador desconectado</div>
        <div style={labelStyle}>
          <span style={{ color, fontWeight: 700 }}>{visible.color}</span> salió de la partida - ahora lo juega un bot
        </div>
      </div>
      <style>{`
        @keyframes player-left-toast-pop {
          0% { transform: scale(0.4) translateY(-10px); opacity: 0; }
          55% { transform: scale(1.05) translateY(3px); opacity: 1; }
          75% { transform: scale(0.98) translateY(0); }
          100% { transform: scale(1) translateY(0); }
        }
        .player-left-toast-pop { animation: player-left-toast-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
      `}</style>
    </div>
  )
}

const wrapperStyle: React.CSSProperties = {
  position: 'absolute',
  top: '8%',
  left: '50%',
  transform: 'translateX(-50%)',
  pointerEvents: 'none',
  zIndex: 5,
}

const cardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 2,
  padding: '12px 28px',
  borderRadius: 18,
  background: 'linear-gradient(155deg, #5a6570 0%, #333c44 55%, #20262c 100%)',
  boxShadow: '0 8px 24px rgba(0,0,0,0.45), 0 0 0 2px rgba(255,255,255,0.12) inset',
  fontFamily: 'system-ui, sans-serif',
}

const iconStyle: React.CSSProperties = {
  fontSize: 20,
  lineHeight: 1,
  marginBottom: 2,
  width: 32,
  height: 32,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '50%',
  border: '2px solid',
  background: 'rgba(255,255,255,0.08)',
}

const titleStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 800,
  color: '#eef2f5',
  textShadow: '0 1px 0 rgba(0,0,0,0.4)',
  lineHeight: 1,
}

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#dde4e9',
  opacity: 0.9,
  textAlign: 'center',
  maxWidth: 240,
}
