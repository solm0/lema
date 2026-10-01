declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_APP_VARIANT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
