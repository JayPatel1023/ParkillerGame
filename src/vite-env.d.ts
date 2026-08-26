/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
  readonly VITE_PHOTON_APP_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
