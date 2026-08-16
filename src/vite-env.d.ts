/// <reference types="vite/client" />
/// <reference lib="dom" />

interface ExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}

declare module "@vite-pwa/assets-generator/api" {
  export type ImageAssetsInstructions = Record<string, unknown>;
  export type IconAsset<T = unknown> = Record<string, unknown> & { buffer: Promise<unknown> };
  export type FaviconLink = Record<string, unknown>;
  export type HtmlLink = Record<string, unknown>;
  export type AppleSplashScreenLink = Record<string, unknown>;
  export type HtmlLinkPreset = string;
}

declare module "@vite-pwa/assets-generator/config" {
  export type BuiltInPreset = string;
  export type Preset = Record<string, unknown>;
}
