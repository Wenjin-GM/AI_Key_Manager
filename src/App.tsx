import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { AppState, BenchmarkResult, BenchmarkSummary, ConfigInput, KeyConfig } from "./types";

type AppMeta = {
  version: string;
  userDataPath: string;
};

const emptyForm: ConfigInput = {
  name: "",
  baseUrl: "",
  apiKey: "",
  model: "",
};

function formatDateTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatMs(value?: number) {
  if (typeof value !== "number") return "-";
  return `${value} ms`;
}

function maskKey(value: string) {
  const trimmed = value.trim();
  if (trimmed.length <= 10) return "******";
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
}

function statusLabel(status?: "success" | "error") {
  if (status === "success") return "成功";
  if (status === "error") return "失败";
  return "未执行";
}

function statusClass(status?: "success" | "error") {
  if (status === "success") return "status-pill success";
  if (status === "error") return "status-pill error";
  return "status-pill idle";
}

function compactBaseUrl(value: string) {
  try {
    const parsed = new URL(value);
    return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return value;
  }
}

function inferModelTags(model: string) {
  const normalized = model.trim().toLowerCase();
  const rules = [
    { tag: "image", patterns: [/\bimage\b/i, /\bvision\b/i, /\bvl\b/i, /\bflux\b/i, /\bsd(?:xl)?\b/i, /stable[- ]?diffusion/i] },
    { tag: "embedding", patterns: [/embedding/i, /\bembed\b/i, /text-embedding/i, /\bbge\b/i, /\bmxbai\b/i, /\be5\b/i] },
    { tag: "thinking", patterns: [/thinking/i, /\breason/i, /\bthink\b/i, /\bo1\b/i, /\bo3\b/i, /\bo4\b/i, /\br1\b/i] },
    { tag: "coding", patterns: [/\bcoder\b/i, /\bcoding\b/i, /\bcode\b/i, /devstral/i] },
    { tag: "audio", patterns: [/\baudio\b/i, /\bspeech\b/i, /\btts\b/i, /whisper/i, /transcri/i] },
    { tag: "rerank", patterns: [/rerank/i, /reranker/i] },
    { tag: "moderation", patterns: [/moderation/i] },
  ];

  return rules.filter((rule) => rule.patterns.some((pattern) => pattern.test(normalized))).map((rule) => rule.tag);
}

function isLikelyChatBenchmarkable(model: string) {
  const tags = inferModelTags(model);
  if (tags.includes("embedding") || tags.includes("rerank") || tags.includes("moderation")) return false;
  return !/(whisper|transcri|text-embedding|embedding-|rerank|stable-diffusion|sdxl|flux|moderation)/i.test(model);
}

function sortBenchmarks(benchmarks?: Record<string, BenchmarkResult>) {
  return Object.values(benchmarks || {}).sort((left, right) => {
    if (left.status !== right.status) return left.status === "success" ? -1 : 1;
    return (left.speed?.medianMs || Number.MAX_SAFE_INTEGER) - (right.speed?.medianMs || Number.MAX_SAFE_INTEGER);
  });
}

const modelNameCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

function benchmarkStatusRank(result?: BenchmarkResult) {
  if (result?.status === "success") return 0;
  if (result?.status === "error") return 2;
  return 1;
}

function sortModelsForDisplay(models: string[], benchmarkByModel: Record<string, BenchmarkResult>) {
  return [...models].sort((left, right) => {
    const leftResult = benchmarkByModel[left];
    const rightResult = benchmarkByModel[right];

    const statusDelta = benchmarkStatusRank(leftResult) - benchmarkStatusRank(rightResult);
    if (statusDelta !== 0) return statusDelta;

    const nameDelta = modelNameCollator.compare(right, left);
    if (nameDelta !== 0) return nameDelta;

    return 0;
  });
}

function clampRounds(input: string) {
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) return 2;
  return Math.min(5, Math.max(1, Math.round(parsed)));
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "执行失败，请重试";
}

function App() {
  const [meta, setMeta] = useState<AppMeta>({ version: "0.1.0", userDataPath: "" });
  const [state, setState] = useState<AppState>({ configs: [] });
  const [selectedId, setSelectedId] = useState("");
  const [configQuery, setConfigQuery] = useState("");
  const [form, setForm] = useState<ConfigInput>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [benchmarkRounds, setBenchmarkRounds] = useState("2");
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [selectedBenchmarkModel, setSelectedBenchmarkModel] = useState("");
  const [draggingConfigId, setDraggingConfigId] = useState("");
  const [dragOverConfigId, setDragOverConfigId] = useState("");
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [nextMeta, nextState] = await Promise.all([window.desktopApi.getMeta(), window.desktopApi.getState()]);
        setMeta(nextMeta);
        setState(nextState);
        if (nextState.configs[0]) {
          setSelectedId(nextState.configs[0].id);
        }
      } catch (error) {
        setNotice(`初始化失败：${errorMessage(error)}`);
      }
    })();
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const configs = state.configs;
  const canDragSort = configQuery.trim() === "";
  const filteredConfigs = useMemo(() => {
    const query = configQuery.trim().toLowerCase();
    if (!query) return configs;
    return configs.filter((item) => [item.name, item.baseUrl, item.model].some((value) => value.toLowerCase().includes(query)));
  }, [configQuery, configs]);

  const activeConfig = useMemo(
    () => configs.find((item) => item.id === selectedId) || configs[0] || null,
    [configs, selectedId],
  );
  const supportedModels = activeConfig?.probe?.supportedModels || [];
  const benchmarkableModels = supportedModels.filter((model) => isLikelyChatBenchmarkable(model));
  const benchmarkRows = useMemo(() => sortBenchmarks(activeConfig?.benchmarks), [activeConfig?.benchmarks]);
  const benchmarkByModel = activeConfig?.benchmarks || {};
  const sortedSupportedModels = useMemo(
    () => sortModelsForDisplay(supportedModels, benchmarkByModel),
    [benchmarkByModel, supportedModels],
  );
  const activeSummary: BenchmarkSummary | undefined = activeConfig?.benchmarkSummary;
  const activeBenchmarkResult = benchmarkRows.find((item) => item.model === selectedBenchmarkModel) || benchmarkRows[0] || null;

  useEffect(() => {
    if (configs.length === 0) {
      if (selectedId) setSelectedId("");
      return;
    }
    if (!configs.some((item) => item.id === selectedId)) {
      setSelectedId(configs[0].id);
    }
  }, [configs, selectedId]);

  useEffect(() => {
    if (!activeConfig) {
      setSelectedModels([]);
      return;
    }
    const currentModel = activeConfig.model.trim();
    if (currentModel && supportedModels.includes(currentModel) && isLikelyChatBenchmarkable(currentModel)) {
      setSelectedModels([currentModel]);
      return;
    }
    setSelectedModels([]);
  }, [activeConfig?.id, activeConfig?.model, supportedModels.join("|")]);

  useEffect(() => {
    if (benchmarkRows.length === 0) {
      setSelectedBenchmarkModel("");
      return;
    }
    if (activeConfig?.model && benchmarkRows.some((item) => item.model === activeConfig.model)) {
      setSelectedBenchmarkModel(activeConfig.model);
      return;
    }
    if (!benchmarkRows.some((item) => item.model === selectedBenchmarkModel)) {
      setSelectedBenchmarkModel(benchmarkRows[0].model);
    }
  }, [activeConfig?.model, benchmarkRows, selectedBenchmarkModel]);

  useEffect(() => {
    if (!editingId) return;
    nameInputRef.current?.focus();
    nameInputRef.current?.select();
  }, [editingId]);

  function patchForm<K extends keyof ConfigInput>(key: K, value: ConfigInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function resetForm() {
    setForm(emptyForm);
    setEditingId(null);
  }

  async function refreshState(nextState: AppState, nextNotice?: string, preferredId?: string) {
    setState(nextState);
    const nextSelectedId =
      (preferredId && nextState.configs.some((item) => item.id === preferredId) ? preferredId : "") ||
      (selectedId && nextState.configs.some((item) => item.id === selectedId) ? selectedId : "") ||
      nextState.configs[0]?.id ||
      "";
    setSelectedId(nextSelectedId);
    if (nextNotice) setNotice(nextNotice);
  }

  async function runWithHandling(actionKey: string, work: () => Promise<void>) {
    setLoadingAction(actionKey);
    try {
      await work();
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setLoadingAction(null);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.name.trim() || !form.baseUrl.trim() || !form.apiKey.trim()) {
      setNotice("名称、Base URL、API Key 不能为空");
      return;
    }

    await runWithHandling("save", async () => {
      const nextState = editingId
        ? await window.desktopApi.saveConfig({ ...form, id: editingId })
        : await window.desktopApi.createConfig(form);
      const preferredId = editingId || nextState.configs[0]?.id;
      await refreshState(nextState, editingId ? "配置已更新" : "配置已创建", preferredId);
      resetForm();
    });
  }

  async function handleDelete(configId: string, configName: string) {
    const confirmed = window.confirm(`确认删除配置“${configName}”吗？此操作不会自动备份。`);
    if (!confirmed) return;

    await runWithHandling(`delete:${configId}`, async () => {
      const nextState = await window.desktopApi.deleteConfig(configId);
      await refreshState(nextState, "配置已删除");
      if (editingId === configId) {
        resetForm();
      }
    });
  }

  function startEdit(item: KeyConfig) {
    setSelectedId(item.id);
    setEditingId(item.id);
    setForm({
      name: item.name,
      baseUrl: item.baseUrl,
      apiKey: item.apiKey,
      model: item.model,
    });
    setNotice(`正在编辑 ${item.name}`);
  }

  async function moveConfig(sourceId: string, targetId: string) {
    if (!sourceId || !targetId || sourceId === targetId) return;

    await runWithHandling(`move:${sourceId}`, async () => {
      const nextState = await window.desktopApi.moveConfig({ sourceId, targetId });
      await refreshState(nextState, "配置顺序已更新", sourceId);
    });
  }

  async function pinConfig(configId: string) {
    const config = configs.find((item) => item.id === configId);
    if (!config) return;

    await runWithHandling(`pin:${configId}`, async () => {
      const nextState = await window.desktopApi.pinConfig(configId);
      await refreshState(nextState, `${config.name} 已置顶`, configId);
    });
  }

  async function runTest(configId = activeConfig?.id) {
    if (!configId) return;
    const config = configs.find((item) => item.id === configId);
    if (!config) return;

    await runWithHandling(`test:${configId}`, async () => {
      const response = await window.desktopApi.runTest(configId);
      await refreshState(response.state, `${config.name} 连通性测试已完成`, configId);
    });
  }

  async function runProbe(configId = activeConfig?.id) {
    if (!configId) return;
    const config = configs.find((item) => item.id === configId);
    if (!config) return;

    await runWithHandling(`probe:${configId}`, async () => {
      const response = await window.desktopApi.runProbe(configId);
      await refreshState(response.state, `${config.name} 模型识别已完成`, configId);
    });
  }

  async function applyModel(model: string) {
    if (!activeConfig) return;

    await runWithHandling(`apply:${activeConfig.id}`, async () => {
      const nextState = await window.desktopApi.setCurrentModel({ configId: activeConfig.id, model });
      await refreshState(nextState, `当前模型已切换为 ${model}`, activeConfig.id);
    });
  }

  async function runBenchmark() {
    if (!activeConfig) return;
    const models = selectedModels.length > 0 ? selectedModels : benchmarkableModels;
    if (models.length === 0) {
      setNotice("没有可测速模型，请先识别模型，或检查模型是否属于非对话类型");
      return;
    }

    await runWithHandling(`benchmark:${activeConfig.id}`, async () => {
      const response = await window.desktopApi.runBenchmark({
        configId: activeConfig.id,
        models,
        rounds: clampRounds(benchmarkRounds),
      });
      const extra = response.skippedModels.length > 0 ? `，跳过 ${response.skippedModels.length} 个非对话模型` : "";
      await refreshState(response.state, `模型测速已完成${extra}`, activeConfig.id);
    });
  }

  function toggleModel(model: string) {
    setSelectedModels((prev) => (prev.includes(model) ? prev.filter((item) => item !== model) : [...prev, model]));
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div>
            <p className="eyebrow">Desktop</p>
            <h1>AI Key Vault</h1>
          </div>
          <p className="muted">本地管理 OpenAI 兼容 Key，只保留连通性测试、模型识别、模型测速。</p>
          <p className="meta-line">版本 {meta.version}</p>
        </div>

        <form className="panel form-panel" onSubmit={handleSubmit}>
          <div className="panel-header">
            <h2>{editingId ? "编辑配置" : "新增配置"}</h2>
            {editingId ? (
              <button type="button" className="ghost-button" onClick={resetForm}>
                取消
              </button>
            ) : null}
          </div>

          {editingId ? (
            <div className="editing-banner">
              <span className="status-pill success">编辑模式</span>
              <strong>{configs.find((item) => item.id === editingId)?.name || "当前配置"}</strong>
            </div>
          ) : null}

          <label>
            <span>名称</span>
            <input
              ref={nameInputRef}
              value={form.name}
              onChange={(event) => patchForm("name", event.target.value)}
              placeholder="例如：OpenAI 主账号"
            />
          </label>
          <label>
            <span>Base URL</span>
            <input value={form.baseUrl} onChange={(event) => patchForm("baseUrl", event.target.value)} placeholder="https://api.openai.com/v1" />
          </label>
          <label>
            <span>API Key</span>
            <input value={form.apiKey} onChange={(event) => patchForm("apiKey", event.target.value)} placeholder="sk-..." />
          </label>
          <label>
            <span>默认模型</span>
            <input value={form.model} onChange={(event) => patchForm("model", event.target.value)} placeholder="gpt-4o-mini" />
          </label>

          <button type="submit" className="primary-button" disabled={loadingAction === "save"}>
            {loadingAction === "save" ? "保存中..." : editingId ? "保存修改" : "创建配置"}
          </button>
        </form>

        <div className="panel list-panel">
          <div className="panel-header">
            <h2>配置列表</h2>
            <span className="count">{configs.length}</span>
          </div>

          <input
            className="search-input"
            value={configQuery}
            onChange={(event) => setConfigQuery(event.target.value)}
            placeholder="搜索名称、地址或模型"
          />

          <div className="config-list">
            {filteredConfigs.length === 0 ? <div className="empty">没有匹配的配置。</div> : null}
            {filteredConfigs.map((item) => {
              const active = item.id === activeConfig?.id;
              const draggable = canDragSort && filteredConfigs.length > 1;
              return (
                <article
                  key={item.id}
                  className={`config-row ${active ? "active" : ""} ${draggable ? "draggable" : ""} ${draggingConfigId === item.id ? "dragging" : ""} ${dragOverConfigId === item.id ? "drag-over" : ""}`}
                  draggable={draggable}
                  onDragStart={(event) => {
                    if (!draggable) return;
                    setDraggingConfigId(item.id);
                    setDragOverConfigId("");
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", item.id);
                  }}
                  onDragOver={(event) => {
                    if (!draggable || draggingConfigId === item.id) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    if (dragOverConfigId !== item.id) {
                      setDragOverConfigId(item.id);
                    }
                  }}
                  onDrop={(event) => {
                    if (!draggable) return;
                    event.preventDefault();
                    const sourceId = event.dataTransfer.getData("text/plain") || draggingConfigId;
                    setDraggingConfigId("");
                    setDragOverConfigId("");
                    void moveConfig(sourceId, item.id);
                  }}
                  onDragEnd={() => {
                    setDraggingConfigId("");
                    setDragOverConfigId("");
                  }}
                >
                  <button type="button" className="config-row-main" onClick={() => setSelectedId(item.id)}>
                    <span className="drag-handle" aria-hidden="true">::</span>
                    <strong className="config-name">{item.name}</strong>
                    <span className="config-meta">{compactBaseUrl(item.baseUrl)}</span>
                    <span className="config-meta">{item.model || "未设模型"}</span>
                    <span className={statusClass(item.lastTest?.status)}>{statusLabel(item.lastTest?.status)}</span>
                    <span className={statusClass(item.probe?.status)}>{item.probe ? `识别${statusLabel(item.probe.status)}` : "未识别"}</span>
                  </button>
                  <button
                    type="button"
                    className="ghost-button small"
                    onClick={() => void pinConfig(item.id)}
                    disabled={configs[0]?.id === item.id}
                  >
                    置顶
                  </button>
                  <button type="button" className="ghost-button small" onClick={() => startEdit(item)}>
                    编辑
                  </button>
                </article>
              );
            })}
          </div>
        </div>
      </aside>

      <main className="content">
        {activeConfig ? (
          <>
            <section className="panel overview-panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Current Config</p>
                  <h2>{activeConfig.name}</h2>
                </div>
                <div className="hero-actions">
                  <button type="button" className="ghost-button" onClick={() => startEdit(activeConfig)}>
                    编辑
                  </button>
                  <button
                    type="button"
                    className="danger-button"
                    onClick={() => handleDelete(activeConfig.id, activeConfig.name)}
                    disabled={loadingAction === `delete:${activeConfig.id}`}
                  >
                    {loadingAction === `delete:${activeConfig.id}` ? "删除中..." : "删除"}
                  </button>
                </div>
              </div>

              <div className="overview-inline">
                <span><strong>地址</strong>{activeConfig.baseUrl}</span>
                <span><strong>Key</strong>{maskKey(activeConfig.apiKey)}</span>
                <span><strong>当前模型</strong>{activeConfig.model || "-"}</span>
                <span><strong>创建时间</strong>{formatDateTime(activeConfig.createdAt)}</span>
              </div>

              <div className="compact-sections">
                <div className="compact-block">
                  <div className="compact-header">
                    <h3>连通性测试</h3>
                    <button type="button" className="primary-button" onClick={() => runTest()} disabled={loadingAction === `test:${activeConfig.id}`}>
                      {loadingAction === `test:${activeConfig.id}` ? "测试中..." : "开始测试"}
                    </button>
                  </div>
                  <div className="inline-metrics two-up">
                    <div className="inline-metric">
                      <span>状态</span>
                      <strong>{statusLabel(activeConfig.lastTest?.status)}</strong>
                    </div>
                    <div className="inline-metric">
                      <span>最近测试</span>
                      <strong>{formatDateTime(activeConfig.lastTest?.testedAt)}</strong>
                    </div>
                  </div>
                </div>

                <div className="compact-block">
                  <div className="compact-header">
                    <h3>模型识别</h3>
                    <button type="button" className="primary-button" onClick={() => runProbe()} disabled={loadingAction === `probe:${activeConfig.id}`}>
                      {loadingAction === `probe:${activeConfig.id}` ? "识别中..." : "识别模型"}
                    </button>
                  </div>
                  <div className="inline-metrics four-up">
                    <div className="inline-metric">
                      <span>状态</span>
                      <strong>{statusLabel(activeConfig.probe?.status)}</strong>
                    </div>
                    <div className="inline-metric">
                      <span>推荐模型</span>
                      <strong>{activeConfig.probe?.recommendedModel || "-"}</strong>
                    </div>
                    <div className="inline-metric">
                      <span>模型数量</span>
                      <strong>{supportedModels.length}</strong>
                    </div>
                    <div className="inline-metric">
                      <span>最近识别</span>
                      <strong>{formatDateTime(activeConfig.probe?.testedAt)}</strong>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="panel">
              <div className="panel-header benchmark-header">
                <div>
                  <h2>模型测速</h2>
                  <p className="muted">默认测速已勾选模型；如果未勾选，则测速全部可测速模型。</p>
                </div>
                <div className="benchmark-actions">
                  <label className="round-input slim">
                    <span>轮数</span>
                    <input value={benchmarkRounds} onChange={(event) => setBenchmarkRounds(event.target.value)} />
                  </label>
                  <button type="button" className="ghost-button" onClick={() => setSelectedModels(benchmarkableModels)}>
                    全选可测速
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => setSelectedModels(activeConfig.model && isLikelyChatBenchmarkable(activeConfig.model) ? [activeConfig.model] : [])}
                  >
                    只测当前模型
                  </button>
                  <button type="button" className="ghost-button" onClick={() => setSelectedModels([])}>
                    清空选择
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={runBenchmark}
                    disabled={loadingAction === `benchmark:${activeConfig.id}`}
                  >
                    {loadingAction === `benchmark:${activeConfig.id}` ? "测速中..." : `开始测速 ${selectedModels.length || benchmarkableModels.length || 0}`}
                  </button>
                </div>
              </div>

              <div className="selection-summary">
                <span>已识别模型：{supportedModels.length}</span>
                <span>可测速模型：{benchmarkableModels.length}</span>
                <span>本次目标：{selectedModels.length || benchmarkableModels.length || 0}</span>
                <span>测速轮数：{clampRounds(benchmarkRounds)}</span>
              </div>

              <div className="model-picker compact-model-picker">
                {supportedModels.length === 0 ? <div className="empty">暂无模型列表，请先执行模型识别。</div> : null}
                {sortedSupportedModels.map((model) => {
                  const benchmarkable = isLikelyChatBenchmarkable(model);
                  const selected = selectedModels.includes(model);
                  const current = activeConfig.model === model;
                  const recommended = activeConfig.probe?.recommendedModel === model;
                  const tags = inferModelTags(model);
                  const benchmarkResult = benchmarkByModel[model];
                  const failedResult = benchmarkResult?.status === "error";
                  const testedResult = Boolean(benchmarkResult);

                  return (
                    <article
                      key={model}
                      className={`model-line ${benchmarkable ? "" : "disabled"} ${selected ? "selected" : ""} ${failedResult ? "failed-result" : ""} ${activeBenchmarkResult?.model === model ? "focused-line" : ""}`}
                      onClick={() => testedResult && setSelectedBenchmarkModel(model)}
                    >
                      <div className="model-line-content">
                        <label className="model-line-main">
                          <input type="checkbox" checked={selected} disabled={!benchmarkable} onChange={() => toggleModel(model)} />
                          <span className="model-name">{model}</span>
                          {current ? <em>当前</em> : null}
                          {recommended ? <em>推荐</em> : null}
                          {tags.map((tag) => (
                            <small key={`${model}-${tag}`}>{tag}</small>
                          ))}
                        </label>
                        <div className="model-result-row">
                          <span className={statusClass(benchmarkResult?.status)}>{testedResult ? statusLabel(benchmarkResult?.status) : "未测试"}</span>
                          <span>平均 {formatMs(benchmarkResult?.speed?.avgMs)}</span>
                          <span>中位 {formatMs(benchmarkResult?.speed?.medianMs)}</span>
                          <span>首字 {formatMs(benchmarkResult?.speed?.firstTokenMedianMs)}</span>
                          <span>成功率 {typeof benchmarkResult?.speed?.successRate === "number" ? `${benchmarkResult.speed.successRate}%` : "-"}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="inline-action tiny"
                        onClick={(event) => {
                          event.stopPropagation();
                          void applyModel(model);
                        }}
                      >
                        设为当前
                      </button>
                    </article>
                  );
                })}
              </div>

              <div className="metric-grid summary-grid compact-summary-grid">
                <div className="metric-card accent">
                  <span>推荐默认模型</span>
                  <strong>{activeSummary?.recommendedModel || "-"}</strong>
                  <small>优先看成功率</small>
                </div>
                <div className="metric-card">
                  <span>最快模型</span>
                  <strong>{activeSummary?.fastestModel || "-"}</strong>
                  <small>{formatMs(activeSummary?.fastestMedianMs)}</small>
                </div>
                <div className="metric-card">
                  <span>首字最快</span>
                  <strong>{activeSummary?.quickestFirstTokenModel || "-"}</strong>
                  <small>{formatMs(activeSummary?.quickestFirstTokenMs)}</small>
                </div>
                <div className="metric-card">
                  <span>最稳定</span>
                  <strong>{activeSummary?.mostStableModel || "-"}</strong>
                  <small>{formatMs(activeSummary?.stabilityMs)}</small>
                </div>
              </div>

              {activeBenchmarkResult ? (
                <div className="panel round-panel">
                  <div className="panel-header">
                    <h2>轮次明细</h2>
                    <span className="count">{activeBenchmarkResult.model}</span>
                  </div>
                  <div className="metric-grid detail-summary compact-summary-grid">
                    <div className="metric-card">
                      <span>状态</span>
                      <strong>{statusLabel(activeBenchmarkResult.status)}</strong>
                    </div>
                    <div className="metric-card">
                      <span>平均耗时</span>
                      <strong>{formatMs(activeBenchmarkResult.speed?.avgMs)}</strong>
                    </div>
                    <div className="metric-card">
                      <span>中位耗时</span>
                      <strong>{formatMs(activeBenchmarkResult.speed?.medianMs)}</strong>
                    </div>
                    <div className="metric-card">
                      <span>首字中位</span>
                      <strong>{formatMs(activeBenchmarkResult.speed?.firstTokenMedianMs)}</strong>
                    </div>
                  </div>

                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>轮次</th>
                          <th>状态</th>
                          <th>总耗时</th>
                          <th>首字时间</th>
                          <th>错误信息</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(activeBenchmarkResult.speed?.roundDetails || []).length === 0 ? (
                          <tr>
                            <td colSpan={5} className="table-empty">
                              当前结果没有轮次明细。
                            </td>
                          </tr>
                        ) : null}
                        {(activeBenchmarkResult.speed?.roundDetails || []).map((detail) => (
                          <tr key={`${activeBenchmarkResult.model}-${detail.round}`}>
                            <td>第 {detail.round} 轮</td>
                            <td>{detail.ok ? "成功" : "失败"}</td>
                            <td>{detail.ok ? formatMs(detail.elapsedMs) : "-"}</td>
                            <td>{detail.ok ? formatMs(detail.firstTokenMs) : "-"}</td>
                            <td>{detail.error || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </section>
          </>
        ) : (
          <section className="panel empty-state">
            <h2>先创建一个配置</h2>
            <p className="muted">填写 Base URL、API Key 和默认模型后，就可以直接做连通性测试、模型识别和模型测速。</p>
          </section>
        )}
      </main>

      <div className={`toast ${notice ? "show" : ""}`}>{notice || "placeholder"}</div>
    </div>
  );
}

export default App;
