const MODEL_CANDIDATES = ["gpt-4.1-mini", "gpt-4o-mini", "gpt-4.1", "gpt-4o", "gpt-5-mini", "gpt-5"];

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

function cleanOneLineText(input, maxLen = 220) {
  const singleLine = String(input || "").replace(/\s+/g, " ").trim();
  if (!singleLine) return "";
  if (singleLine.length <= maxLen) return singleLine;
  return `${singleLine.slice(0, maxLen)}...`;
}

function uniqueStrings(values) {
  return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))];
}

function normalizeBaseUrl(raw) {
  const cleaned = String(raw || "").trim().replace(/\/+$/, "");
  if (!cleaned) return "";
  if (!/^https?:\/\//i.test(cleaned)) return `https://${cleaned}`;
  return cleaned;
}

function toOpenAIBaseUrl(raw) {
  const normalized = normalizeBaseUrl(raw);
  if (!normalized) return "";

  const withoutEndpoint = normalized
    .replace(/\/chat\/completions$/i, "")
    .replace(/\/responses$/i, "")
    .replace(/\/completions$/i, "");

  if (/\/v\d+$/i.test(withoutEndpoint)) return withoutEndpoint;
  return `${withoutEndpoint}/v1`;
}

function cleanKey(raw) {
  return String(raw || "").replace(/^Bearer\s+/i, "").trim();
}

function toReadableResponseText(content) {
  if (typeof content === "string") return cleanOneLineText(content);
  if (!Array.isArray(content)) return "";

  const texts = content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!isRecord(part)) return "";
      return typeof part.text === "string" ? part.text : "";
    })
    .filter(Boolean);

  return cleanOneLineText(texts.join(" "));
}

function getErrorMessage(error) {
  if (!isRecord(error)) return "";

  const directError = error.error;
  if (typeof directError === "string" && directError.trim()) return cleanOneLineText(directError, 260);

  const directMessage = error.message;
  if (typeof directMessage === "string" && directMessage.trim()) return cleanOneLineText(directMessage, 260);

  const nestedPaths = [
    ["error", "message"],
    ["response", "error", "message"],
    ["response", "data", "error", "message"],
    ["response", "body", "error", "message"],
    ["data", "error", "message"],
    ["body", "error", "message"],
    ["cause", "message"],
  ];

  for (const path of nestedPaths) {
    let current = error;
    for (const key of path) {
      if (!isRecord(current)) {
        current = "";
        break;
      }
      current = current[key];
    }
    if (typeof current === "string" && current.trim()) return cleanOneLineText(current, 260);
  }

  return "";
}

function makeErrorDetail(error) {
  const baseError = isRecord(error) ? error : {};
  const status = typeof baseError.status === "number" ? baseError.status : undefined;
  const name = typeof baseError.name === "string" ? baseError.name : "";
  const raw = getErrorMessage(error);

  let detail = "请求异常，请检查地址、模型或接口兼容性";
  if (status === 401 || status === 403) detail = "Key 无效或权限不足";
  else if (status === 404) detail = "地址可达，但聊天接口不存在";
  else if (typeof status === "number") detail = `请求失败（HTTP ${status}）`;
  else if (name === "AbortError" || /timeout|timed out/i.test(raw)) detail = "请求超时，请检查地址或网络";
  else if (/network|fetch failed|connection|ENOTFOUND|ECONNREFUSED/i.test(raw)) detail = "请求失败，请检查网络或地址";

  if (!raw) return detail;
  if (detail.includes(raw)) return detail;
  return `${detail}；接口返回：${raw}`;
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJsonWithTimeout(url, init, timeoutMs) {
  const response = await fetchWithTimeout(url, init, timeoutMs);
  let payload = null;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw {
      status: response.status,
      message: getErrorMessage(payload) || `HTTP ${response.status}`,
    };
  }

  return payload;
}

async function requestModelText(baseUrl, apiKey, model, prompt, maxTokens) {
  const startedAt = performance.now();

  try {
    const response = await fetchWithTimeout(
      `${baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: maxTokens,
        }),
      },
      12000,
    );

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    const elapsedMs = Math.round(performance.now() - startedAt);

    if (!response.ok) {
      return {
        ok: false,
        text: "",
        elapsedMs,
        error: getErrorMessage(payload) || `HTTP ${response.status}`,
      };
    }

    if (isRecord(payload) && "error" in payload) {
      return {
        ok: false,
        text: "",
        elapsedMs,
        error: getErrorMessage(payload) || "模型不可用，或上游渠道响应异常",
      };
    }

    const firstChoice = isRecord(payload) && Array.isArray(payload.choices) ? payload.choices[0] : undefined;
    const message = isRecord(firstChoice) ? firstChoice.message : undefined;
    const content = isRecord(message) ? message.content : undefined;
    const text = toReadableResponseText(content);

    if (text || content) {
      return { ok: true, text, elapsedMs };
    }

    return { ok: false, text: "", elapsedMs, error: "接口未返回可读消息内容" };
  } catch (error) {
    return {
      ok: false,
      text: "",
      elapsedMs: Math.round(performance.now() - startedAt),
      error: makeErrorDetail(error),
    };
  }
}

function extractStreamDeltaText(payload) {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) return "";

  const firstChoice = payload.choices[0];
  if (!isRecord(firstChoice)) return "";

  const delta = firstChoice.delta;
  if (!isRecord(delta)) return "";

  const directContent = delta.content;
  if (typeof directContent === "string") return directContent;

  if (Array.isArray(directContent)) {
    return directContent
      .map((part) => {
        if (typeof part === "string") return part;
        if (!isRecord(part)) return "";
        return typeof part.text === "string" ? part.text : "";
      })
      .join("");
  }

  const reasoningContent = delta.reasoning_content;
  if (typeof reasoningContent === "string") return reasoningContent;

  return "";
}

async function readStreamError(response) {
  try {
    const payload = await response.clone().json();
    const message = getErrorMessage(payload);
    if (message) return message;
  } catch {
  }

  try {
    const rawText = await response.text();
    const cleaned = cleanOneLineText(rawText, 260);
    if (cleaned) return cleaned;
  } catch {
  }

  return `HTTP ${response.status}`;
}

async function requestModelTextStream(baseUrl, apiKey, model, prompt, maxTokens) {
  const startedAt = performance.now();

  try {
    const response = await fetchWithTimeout(
      `${baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: maxTokens,
          stream: true,
        }),
      },
      20000,
    );

    if (!response.ok) {
      return {
        ok: false,
        text: "",
        elapsedMs: Math.round(performance.now() - startedAt),
        error: await readStreamError(response),
      };
    }

    if (!response.body) {
      return {
        ok: false,
        text: "",
        elapsedMs: Math.round(performance.now() - startedAt),
        error: "流式响应不可用",
      };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let collectedText = "";
    let firstTokenMs;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() || "";

      for (const chunk of chunks) {
        const lines = chunk
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.startsWith("data:"));

        for (const line of lines) {
          const data = line.replace(/^data:\s*/, "");
          if (!data || data === "[DONE]") continue;

          try {
            const payload = JSON.parse(data);
            const deltaText = extractStreamDeltaText(payload);
            if (!deltaText) continue;
            if (firstTokenMs === undefined) {
              firstTokenMs = Math.round(performance.now() - startedAt);
            }
            collectedText += deltaText;
          } catch {
          }
        }
      }
    }

    const elapsedMs = Math.round(performance.now() - startedAt);
    const text = cleanOneLineText(collectedText.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim(), 260);
    if (!text) {
      return { ok: false, text: "", elapsedMs, error: "流式响应未返回可读内容" };
    }

    return {
      ok: true,
      text,
      elapsedMs,
      firstTokenMs,
    };
  } catch (error) {
    return {
      ok: false,
      text: "",
      elapsedMs: Math.round(performance.now() - startedAt),
      error: makeErrorDetail(error),
    };
  }
}

function chooseRecommendedModel(currentModel, models) {
  const normalized = models.map((item) => item.trim()).filter(Boolean);
  const current = String(currentModel || "").trim();
  if (current && normalized.includes(current)) return current;

  for (const candidate of MODEL_CANDIDATES) {
    if (normalized.includes(candidate)) return candidate;
  }

  return normalized[0] || "";
}

function extractModelsFromResponse(input) {
  if (!isRecord(input) || !Array.isArray(input.data)) return [];

  const out = [];
  const seen = new Set();

  for (const item of input.data) {
    if (!isRecord(item)) continue;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }

  return out;
}

function inferModelTags(model) {
  const normalized = String(model || "").trim().toLowerCase();
  const rules = [
    { tag: "image", patterns: [/\bimage\b/i, /\bvision\b/i, /\bvl\b/i, /\bflux\b/i, /\bsd(?:xl)?\b/i, /stable[- ]?diffusion/i] },
    { tag: "embedding", patterns: [/embedding/i, /\bembed\b/i, /text-embedding/i, /\bbge\b/i, /\bmxbai\b/i, /\be5\b/i] },
    { tag: "thinking", patterns: [/thinking/i, /\breason/i, /\bthink\b/i, /\bo1\b/i, /\bo3\b/i, /\bo4\b/i, /\br1\b/i] },
    { tag: "coding", patterns: [/\bcoder\b/i, /\bcoding\b/i, /\bcode\b/i, /devstral/i] },
    { tag: "audio", patterns: [/\baudio\b/i, /\bspeech\b/i, /\btts\b/i, /whisper/i, /transcri/i] },
    { tag: "rerank", patterns: [/rerank/i, /reranker/i] },
    { tag: "moderation", patterns: [/moderation/i] },
  ];

  const tags = [];
  for (const rule of rules) {
    if (rule.patterns.some((pattern) => pattern.test(normalized))) {
      tags.push(rule.tag);
    }
  }
  return tags;
}

function isLikelyChatBenchmarkable(model, tags = inferModelTags(model)) {
  if (tags.includes("embedding") || tags.includes("rerank") || tags.includes("moderation")) return false;
  return !/(whisper|transcri|text-embedding|embedding-|rerank|stable-diffusion|sdxl|flux|moderation)/i.test(String(model || ""));
}

function averageOf(values) {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function medianOf(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
  }
  return sorted[middle];
}

function computeStability(values) {
  if (values.length <= 1) return 0;
  const avg = averageOf(values);
  return Math.round(Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length));
}

async function runOpenAITest(input) {
  const baseUrl = toOpenAIBaseUrl(input.baseUrl);
  const apiKey = cleanKey(input.apiKey);
  const testedAt = new Date().toISOString();

  if (!baseUrl || !apiKey) {
    return {
      ok: false,
      result: {
        status: "error",
        message: "测试失败",
        detail: "地址或 Key 为空",
        testedAt,
      },
    };
  }

  const response = await requestModelText(baseUrl, apiKey, input.model?.trim() || "gpt-4o-mini", "你好，请回复：ok", 16);

  if (response.ok) {
    return {
      ok: true,
      result: {
        status: "success",
        message: "测试通过",
        detail: response.text ? `接口返回：${response.text}` : "返回消息正常",
        testedAt,
      },
    };
  }

  return {
    ok: false,
    result: {
      status: "error",
      message: "测试失败",
      detail: response.error || "接口未返回可读内容",
      testedAt,
    },
  };
}

async function runOpenAIProbe(input) {
  const baseUrl = toOpenAIBaseUrl(input.baseUrl);
  const apiKey = cleanKey(input.apiKey);
  const currentModel = input.currentModel?.trim() || "";
  const testedAt = new Date().toISOString();

  if (!baseUrl || !apiKey) {
    return {
      ok: false,
      result: {
        status: "error",
        supportedModels: [],
        detail: "地址或 Key 为空，无法探测模型",
        testedAt,
      },
    };
  }

  let modelsError = "";

  try {
    const payload = await fetchJsonWithTimeout(
      `${baseUrl}/models`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      },
      10000,
    );
    const supportedModels = extractModelsFromResponse(payload);
    if (supportedModels.length > 0) {
      return {
        ok: true,
        result: {
          status: "success",
          supportedModels,
          recommendedModel: chooseRecommendedModel(currentModel, supportedModels) || undefined,
          detail: `读取 /models 成功，共识别 ${supportedModels.length} 个模型`,
          testedAt,
        },
      };
    }
    modelsError = "/models 可达，但未返回可识别模型";
  } catch (error) {
    modelsError = makeErrorDetail(error);
  }

  const supportedModels = [];
  let fallbackError = "";

  for (const candidate of MODEL_CANDIDATES) {
    const response = await requestModelText(baseUrl, apiKey, candidate, "你好，请回复：ok", 12);
    if (response.ok) {
      supportedModels.push(candidate);
      continue;
    }
    if (!fallbackError && response.error) fallbackError = response.error;
  }

  if (supportedModels.length > 0) {
    return {
      ok: true,
      result: {
        status: "success",
        supportedModels,
        recommendedModel: chooseRecommendedModel(currentModel, supportedModels) || undefined,
        detail: `已通过候选模型试探识别 ${supportedModels.length} 个模型${modelsError ? `；/models：${modelsError}` : ""}`,
        testedAt,
      },
    };
  }

  return {
    ok: false,
    result: {
      status: "error",
      supportedModels: [],
      detail: modelsError ? `${modelsError}${fallbackError ? `；候选试探：${fallbackError}` : ""}` : fallbackError || "未探测到可用模型",
      testedAt,
    },
  };
}

async function runOpenAIBenchmarkRound(input) {
  const baseUrl = toOpenAIBaseUrl(input.baseUrl);
  const apiKey = cleanKey(input.apiKey);
  const model = String(input.model || "").trim();

  if (!baseUrl || !apiKey) {
    return {
      ok: false,
      error: "地址或 Key 为空，无法执行模型测速",
    };
  }

  if (!model) {
    return {
      ok: false,
      error: "模型为空，无法执行模型测速",
    };
  }

  const streamedResponse = await requestModelTextStream(
    baseUrl,
    apiKey,
    model,
    "Reply with exactly OK. Do not add anything else.",
    8,
  );

  if (streamedResponse.ok) {
    return {
      ok: true,
      sample: {
        elapsedMs: streamedResponse.elapsedMs,
        firstTokenMs: streamedResponse.firstTokenMs,
      },
    };
  }

  const fallbackResponse = await requestModelText(
    baseUrl,
    apiKey,
    model,
    "Reply with exactly OK. Do not add anything else.",
    8,
  );

  if (fallbackResponse.ok) {
    return {
      ok: true,
      sample: {
        elapsedMs: fallbackResponse.elapsedMs,
      },
    };
  }

  return {
    ok: false,
    error: uniqueStrings([fallbackResponse.error || "", streamedResponse.error || ""])[0] || "测速失败，模型未返回可读内容",
  };
}

function buildBenchmarkResult(model, tags, rounds, roundDetails, samples, firstTokenSamples, errors) {
  const testedAt = new Date().toISOString();

  if (samples.length === 0) {
    return {
      status: "error",
      model,
      tags,
      speed: {
        rounds,
        avgMs: 0,
        medianMs: 0,
        successRate: 0,
        stabilityMs: 0,
        samplesMs: [],
        roundDetails,
      },
      detail: uniqueStrings(errors)[0] || "测速失败",
      testedAt,
    };
  }

  const successRate = Math.round((samples.length / rounds) * 100);
  const medianMs = medianOf(samples);
  const avgMs = averageOf(samples);
  const stabilityMs = computeStability(samples);
  const firstTokenMedianMs = firstTokenSamples.length > 0 ? medianOf(firstTokenSamples) : undefined;
  const firstTokenAvgMs = firstTokenSamples.length > 0 ? averageOf(firstTokenSamples) : undefined;
  const detailParts = [
    `成功 ${samples.length}/${rounds}`,
    `中位耗时 ${medianMs} ms`,
    firstTokenMedianMs ? `首字中位 ${firstTokenMedianMs} ms` : "",
    `波动 ${stabilityMs} ms`,
    errors.length > 0 ? `异常：${uniqueStrings(errors)[0]}` : "",
  ].filter(Boolean);

  return {
    status: "success",
    model,
    tags,
    speed: {
      rounds,
      avgMs,
      medianMs,
      successRate,
      stabilityMs,
      samplesMs: samples,
      firstTokenAvgMs,
      firstTokenMedianMs,
      firstTokenSamplesMs: firstTokenSamples.length > 0 ? firstTokenSamples : undefined,
      roundDetails,
    },
    detail: detailParts.join("；"),
    testedAt,
  };
}

function pickFastestBenchmark(benchmarks) {
  return [...benchmarks]
    .filter((item) => item.speed?.medianMs)
    .sort((left, right) => left.speed.medianMs - right.speed.medianMs)[0];
}

function pickQuickestFirstTokenBenchmark(benchmarks) {
  return [...benchmarks]
    .filter((item) => item.speed?.firstTokenMedianMs)
    .sort((left, right) => left.speed.firstTokenMedianMs - right.speed.firstTokenMedianMs)[0];
}

function pickMostStableBenchmark(benchmarks) {
  return [...benchmarks]
    .filter((item) => item.speed?.stabilityMs !== undefined)
    .sort((left, right) => left.speed.stabilityMs - right.speed.stabilityMs)[0];
}

function pickRecommendedBenchmark(benchmarks) {
  return [...benchmarks].sort((left, right) => {
    const successDelta = (right.speed?.successRate || 0) - (left.speed?.successRate || 0);
    if (successDelta !== 0) return successDelta;
    const medianDelta = (left.speed?.medianMs || Number.MAX_SAFE_INTEGER) - (right.speed?.medianMs || Number.MAX_SAFE_INTEGER);
    if (medianDelta !== 0) return medianDelta;
    return (left.speed?.stabilityMs || Number.MAX_SAFE_INTEGER) - (right.speed?.stabilityMs || Number.MAX_SAFE_INTEGER);
  })[0];
}

async function runBenchmarkBatch(input) {
  const baseUrl = toOpenAIBaseUrl(input.baseUrl);
  const apiKey = cleanKey(input.apiKey);
  const rounds = Math.max(1, Math.min(5, Number(input.rounds) || 2));
  const uniqueModels = uniqueStrings(Array.isArray(input.models) ? input.models : []);
  const benchmarkableModels = uniqueModels.filter((model) => isLikelyChatBenchmarkable(model));
  const results = [];

  for (const model of benchmarkableModels) {
    const samples = [];
    const firstTokenSamples = [];
    const errors = [];
    const roundDetails = [];
    const tags = inferModelTags(model);

    for (let round = 0; round < rounds; round += 1) {
      const response = await runOpenAIBenchmarkRound({ baseUrl, apiKey, model });
      if (response.ok && response.sample) {
        samples.push(response.sample.elapsedMs);
        if (typeof response.sample.firstTokenMs === "number") {
          firstTokenSamples.push(response.sample.firstTokenMs);
        }
        roundDetails.push({
          round: round + 1,
          ok: true,
          elapsedMs: response.sample.elapsedMs,
          firstTokenMs: response.sample.firstTokenMs,
        });
      } else {
        const errorDetail = response.error || "测速失败";
        errors.push(errorDetail);
        roundDetails.push({
          round: round + 1,
          ok: false,
          error: errorDetail,
        });
      }
    }

    results.push(buildBenchmarkResult(model, tags, rounds, roundDetails, samples, firstTokenSamples, errors));
  }

  const successful = results.filter((item) => item.status === "success");
  const fastest = pickFastestBenchmark(successful);
  const quickestFirstToken = pickQuickestFirstTokenBenchmark(successful);
  const mostStable = pickMostStableBenchmark(successful);
  const recommended = pickRecommendedBenchmark(successful);

  return {
    results,
    summary: {
      rounds,
      totalModels: benchmarkableModels.length,
      successModels: successful.length,
      fastestModel: fastest?.model,
      fastestMedianMs: fastest?.speed?.medianMs,
      quickestFirstTokenModel: quickestFirstToken?.model,
      quickestFirstTokenMs: quickestFirstToken?.speed?.firstTokenMedianMs,
      mostStableModel: mostStable?.model,
      stabilityMs: mostStable?.speed?.stabilityMs,
      recommendedModel: recommended?.model,
      finishedAt: new Date().toISOString(),
    },
    skippedModels: uniqueModels.filter((model) => !benchmarkableModels.includes(model)),
  };
}

module.exports = {
  cleanKey,
  inferModelTags,
  isLikelyChatBenchmarkable,
  normalizeBaseUrl,
  runBenchmarkBatch,
  runOpenAIBenchmarkRound,
  runOpenAIProbe,
  runOpenAITest,
  toOpenAIBaseUrl,
  uniqueStrings,
};
