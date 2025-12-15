/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_PROXY_ENDPOINT: string;
    readonly VITE_PROXY_SECRET: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
