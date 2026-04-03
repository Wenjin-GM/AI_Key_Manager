const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const { runBenchmarkBatch, runOpenAIProbe, runOpenAITest } = require("./openai.cjs");

const STORE_FILE = "state.json";

function emptyState() {
  return {
    configs: [],
  };
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeConfig(input) {
  const id = normalizeString(input?.id) || randomUUID();
  const createdAt = normalizeString(input?.createdAt) || new Date().toISOString();

  return {
    id,
    name: normalizeString(input?.name),
    baseUrl: normalizeString(input?.baseUrl),
    apiKey: normalizeString(input?.apiKey),
    model: normalizeString(input?.model),
    createdAt,
    lastTest: input?.lastTest,
    probe: input?.probe,
    benchmarks: input?.benchmarks || {},
    benchmarkSummary: input?.benchmarkSummary,
  };
}

function shouldResetDerivedResults(previous, next) {
  return previous.baseUrl !== next.baseUrl || previous.apiKey !== next.apiKey;
}

function toStorePath(app) {
  return path.join(app.getPath("userData"), STORE_FILE);
}

async function readState(app) {
  const filePath = toStorePath(app);

  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    const configs = Array.isArray(parsed?.configs) ? parsed.configs.map(normalizeConfig) : [];
    return { configs };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return emptyState();
    }
    throw error;
  }
}

async function writeState(app, state) {
  const filePath = toStorePath(app);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(state, null, 2), "utf8");
  return state;
}

async function getState(app) {
  return readState(app);
}

async function createConfig(app, input) {
  const state = await readState(app);
  const config = normalizeConfig({
    name: input?.name,
    baseUrl: input?.baseUrl,
    apiKey: input?.apiKey,
    model: input?.model,
  });
  state.configs.unshift(config);
  return writeState(app, state);
}

async function saveConfig(app, input) {
  const state = await readState(app);
  const targetId = normalizeString(input?.id);
  const target = state.configs.find((item) => item.id === targetId);

  if (!targetId || !target) {
    throw new Error("未找到要编辑的配置，请重新选择后再保存。");
  }

  state.configs = state.configs.map((item) =>
    item.id === targetId
      ? (() => {
          const next = normalizeConfig({
            ...item,
            name: input?.name,
            baseUrl: input?.baseUrl,
            apiKey: input?.apiKey,
            model: input?.model,
          });

          if (!shouldResetDerivedResults(item, next)) {
            return next;
          }

          return {
            ...next,
            lastTest: undefined,
            probe: undefined,
            benchmarks: {},
            benchmarkSummary: undefined,
          };
        })()
      : item,
  );

  return writeState(app, state);
}

async function deleteConfig(app, configId) {
  const state = await readState(app);
  state.configs = state.configs.filter((item) => item.id !== configId);
  return writeState(app, state);
}

async function moveConfig(app, payload) {
  const state = await readState(app);
  const sourceId = normalizeString(payload?.sourceId);
  const targetId = normalizeString(payload?.targetId);
  const sourceIndex = state.configs.findIndex((item) => item.id === sourceId);
  const targetIndex = state.configs.findIndex((item) => item.id === targetId);

  if (!sourceId || !targetId || sourceIndex === -1 || targetIndex === -1) {
    throw new Error("Config not found.");
  }

  if (sourceIndex === targetIndex) {
    return state;
  }

  const [moved] = state.configs.splice(sourceIndex, 1);
  const insertIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
  state.configs.splice(insertIndex, 0, moved);
  return writeState(app, state);
}

async function pinConfig(app, configId) {
  const state = await readState(app);
  const targetId = normalizeString(configId);
  const targetIndex = state.configs.findIndex((item) => item.id === targetId);

  if (!targetId || targetIndex === -1) {
    throw new Error("Config not found.");
  }

  if (targetIndex === 0) {
    return state;
  }

  const [config] = state.configs.splice(targetIndex, 1);
  state.configs.unshift(config);
  return writeState(app, state);
}

async function setCurrentModel(app, payload) {
  const state = await readState(app);
  state.configs = state.configs.map((item) =>
    item.id === payload?.configId ? { ...item, model: normalizeString(payload?.model) } : item,
  );
  return writeState(app, state);
}

function requireConfig(state, configId) {
  const config = state.configs.find((item) => item.id === configId);
  if (!config) {
    throw new Error("Config not found.");
  }
  return config;
}

async function runTestForConfig(app, configId) {
  const state = await readState(app);
  const config = requireConfig(state, configId);
  const response = await runOpenAITest(config);

  state.configs = state.configs.map((item) =>
    item.id === configId
      ? {
          ...item,
          lastTest: response.result,
        }
      : item,
  );

  await writeState(app, state);
  return {
    state,
    result: response.result,
  };
}

async function runProbeForConfig(app, configId) {
  const state = await readState(app);
  const config = requireConfig(state, configId);
  const response = await runOpenAIProbe({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    currentModel: config.model,
  });

  state.configs = state.configs.map((item) =>
    item.id === configId
      ? {
          ...item,
          probe: response.result,
          model: item.model || response.result.recommendedModel || "",
        }
      : item,
  );

  await writeState(app, state);
  return {
    state,
    result: response.result,
  };
}

async function runBenchmarkBatchForConfig(app, payload) {
  const state = await readState(app);
  const config = requireConfig(state, payload?.configId);
  const benchmarkResponse = await runBenchmarkBatch({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    models: payload?.models || [],
    rounds: payload?.rounds,
  });

  state.configs = state.configs.map((item) =>
    item.id === config.id
      ? {
          ...item,
          benchmarks: {
            ...(item.benchmarks || {}),
            ...Object.fromEntries(benchmarkResponse.results.map((result) => [result.model, result])),
          },
          benchmarkSummary: benchmarkResponse.summary,
        }
      : item,
  );

  await writeState(app, state);
  return {
    state,
    ...benchmarkResponse,
  };
}

module.exports = {
  createConfig,
  deleteConfig,
  getState,
  moveConfig,
  pinConfig,
  runBenchmarkBatch: runBenchmarkBatchForConfig,
  runProbeForConfig,
  runTestForConfig,
  saveConfig,
  setCurrentModel,
};
