/// <reference types="vite/client" />

import type { AppState, BenchmarkPayload, BenchmarkResponse, ConfigInput } from "./types";

declare global {
  interface Window {
    desktopApi: {
      getMeta: () => Promise<{ version: string; userDataPath: string }>;
      getState: () => Promise<AppState>;
      createConfig: (input: ConfigInput) => Promise<AppState>;
      saveConfig: (input: ConfigInput & { id: string }) => Promise<AppState>;
      deleteConfig: (configId: string) => Promise<AppState>;
      moveConfig: (payload: { sourceId: string; targetId: string }) => Promise<AppState>;
      pinConfig: (configId: string) => Promise<AppState>;
      setCurrentModel: (payload: { configId: string; model: string }) => Promise<AppState>;
      runTest: (configId: string) => Promise<{ state: AppState }>;
      runProbe: (configId: string) => Promise<{ state: AppState }>;
      runBenchmark: (payload: BenchmarkPayload) => Promise<BenchmarkResponse>;
    };
  }
}

export {};
