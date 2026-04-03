export type TestStatus = "success" | "error";

export type TestResult = {
  status: TestStatus;
  message: string;
  detail?: string;
  testedAt: string;
};

export type ProbeResult = {
  status: TestStatus;
  supportedModels: string[];
  recommendedModel?: string;
  detail?: string;
  testedAt: string;
};

export type BenchmarkRoundDetail = {
  round: number;
  ok: boolean;
  elapsedMs?: number;
  firstTokenMs?: number;
  error?: string;
};

export type BenchmarkResult = {
  status: TestStatus;
  model: string;
  tags: string[];
  detail?: string;
  testedAt: string;
  speed?: {
    rounds: number;
    avgMs: number;
    medianMs: number;
    successRate: number;
    stabilityMs: number;
    samplesMs: number[];
    firstTokenAvgMs?: number;
    firstTokenMedianMs?: number;
    firstTokenSamplesMs?: number[];
    roundDetails?: BenchmarkRoundDetail[];
  };
};

export type BenchmarkSummary = {
  rounds: number;
  totalModels: number;
  successModels: number;
  fastestModel?: string;
  fastestMedianMs?: number;
  quickestFirstTokenModel?: string;
  quickestFirstTokenMs?: number;
  mostStableModel?: string;
  stabilityMs?: number;
  recommendedModel?: string;
  finishedAt: string;
};

export type KeyConfig = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  createdAt: string;
  lastTest?: TestResult;
  probe?: ProbeResult;
  benchmarks?: Record<string, BenchmarkResult>;
  benchmarkSummary?: BenchmarkSummary;
};

export type AppState = {
  configs: KeyConfig[];
};

export type ConfigInput = Pick<KeyConfig, "name" | "baseUrl" | "apiKey" | "model"> & {
  id?: string;
};

export type BenchmarkPayload = {
  configId: string;
  models: string[];
  rounds: number;
};

export type BenchmarkResponse = {
  state: AppState;
  results: BenchmarkResult[];
  summary: BenchmarkSummary;
  skippedModels: string[];
};
