/* Tampermonkey/Violentmonkey globals */
declare function GM_setClipboard(data: string): void;
declare function GM_getValue<T = unknown>(key: string, defaultValue?: T): T;
declare function GM_setValue<T = unknown>(key: string, value: T): void;

type GMXhrResponse = {
  status: number;
  responseText?: string;
};

type GMXhrDetails = {
  method: string;
  url: string;
  headers?: Record<string, string>;
  data?: string;
  timeout?: number;
  onload?: (resp: GMXhrResponse) => void;
  onerror?: () => void;
  ontimeout?: () => void;
};

declare function GM_xmlhttpRequest(details: GMXhrDetails): void;

// Vite import queries
declare module "*.css?inline" {
  const cssText: string;
  export default cssText;
}


