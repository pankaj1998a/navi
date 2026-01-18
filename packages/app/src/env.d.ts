interface ImportMetaEnv {
  readonly VITE_navi_SERVER_HOST: string
  readonly VITE_navi_SERVER_PORT: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
