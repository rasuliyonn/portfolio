import { CHANNEL_COLORS, boundsOf, makeSites, plan } from "./model.js";

const COLUMNS = 88;
const ROWS = 56;
const DEFAULT_ENV = {
  frequencyMhz: 900,
  bandwidthMhz: 0.2,
  noiseFigureDb: 7,
  exponent: 3.2,
  adjacencyIsolationDb: 30,
};
const DEFAULT_MARGIN = 18;
const DEFAULT_POWER = 30;
const DEFAULT_GAIN = 10;

const COVERAGE_FILL = {
  great: "rgba(16, 185, 129, 0.62)",
  good: "rgba(110, 231, 183, 0.34)",
  fair: "rgba(251, 191, 36, 0.36)",
  outage: "rgba(248, 113, 113, 0.24)",
};

const COVERAGE_SVG = {
  great: "#0f8a63",
  good: "#4f9d80",
  fair: "#8a6a2a",
  outage: "#3a2430",
};

const dom = {
  stage: document.getElementById("stage"),
  canvas: document.getElementById("map"),
  tooltip: document.getElementById("tooltip"),
  preset: document.getElementById("preset"),
  power: document.getElementById("power"),
  gain: document.getElementById("gain"),
  exponent: document.getElementById("exponent"),
  margin: document.getElementById("margin"),
  powerOut: document.getElementById("power-out"),
  gainOut: document.getElementById("gain-out"),
  exponentOut: document.getElementById("exponent-out"),
  marginOut: document.getElementById("margin-out"),
  toggleCoverage: document.getElementById("toggle-coverage"),
  toggleGraph: document.getElementById("toggle-graph"),
  toggleLabels: document.getElementById("toggle-labels"),
  reset: document.getElementById("reset"),
  hudChannels: document.getElementById("hud-channels"),
  hudEdges: document.getElementById("hud-edges"),
  hudSinr: document.getElementById("hud-sinr"),
  hudCoverage: document.getElementById("hud-coverage"),
  mChannels: document.getElementById("m-channels"),
  mBound: document.getElementById("m-bound"),
  mEdges: document.getElementById("m-edges"),
  mDensity: document.getElementById("m-density"),
  mReuse: document.getElementById("m-reuse"),
  mCoverage: document.getElementById("m-coverage"),
  channelList: document.getElementById("channel-list"),
  share: document.getElementById("share"),
  exportSvg: document.getElementById("export-svg"),
  exportJson: document.getElementById("export-json"),
  importInput: document.getElementById("import"),
  status: document.getElementById("status"),
};

const state = {
  sites: [],
  env: { ...DEFAULT_ENV },
  margin: DEFAULT_MARGIN,
  power: DEFAULT_POWER,
  gain: DEFAULT_GAIN,
  preset: "small",
  layers: { coverage: true, graph: true, labels: true },
  selected: null,
  result: null,
  frozenBounds: null,
};

const view = { width: 0, height: 0, scale: 1, offsetX: 0, offsetY: 0 };
const context = dom.canvas.getContext("2d");
const heat = document.createElement("canvas");
heat.width = COLUMNS;
heat.height = ROWS;
const heatContext = heat.getContext("2d");
const defaultStatus = dom.status.textContent.trim();

let computeTimer = null;
let drawQueued = false;
let dragging = null;
let hovered = null;
let statusTimer = null;

/* ---------- computation ---------- */

function compute() {
  state.result = plan(
    state.sites,
    state.env,
    state.margin,
    state.frozenBounds,
    COLUMNS,
    ROWS,
  );
  renderHeat();
  updateReadouts();
  queueDraw();
}

function scheduleCompute() {
  if (computeTimer) return;
  computeTimer = setTimeout(() => {
    computeTimer = null;
    compute();
  }, 45);
}

function renderHeat() {
  const image = heatContext.createImageData(COLUMNS, ROWS);
  const colors = {
    great: [16, 185, 129, 160],
    good: [110, 231, 183, 92],
    fair: [251, 191, 36, 96],
    outage: [248, 113, 113, 64],
  };
  for (let row = 0; row < ROWS; row += 1) {
    const gridRow = ROWS - 1 - row; // canvas row 0 is north; the model starts south
    for (let column = 0; column < COLUMNS; column += 1) {
      const quality = state.result.grid.cells[gridRow * COLUMNS + column];
      const color = colors[quality];
      const offset = (row * COLUMNS + column) * 4;
      image.data[offset] = color[0];
      image.data[offset + 1] = color[1];
      image.data[offset + 2] = color[2];
      image.data[offset + 3] = color[3];
    }
  }
  heatContext.putImageData(image, 0, 0);
}

function updateReadouts() {
  const result = state.result;
  if (!result) return;
  const summary = result.grid.summary;
  dom.hudChannels.textContent = String(result.channelCount);
  dom.hudEdges.textContent = String(result.edges);
  dom.hudSinr.textContent = `${summary.meanSinr.toFixed(1)} dB`;
  dom.hudCoverage.textContent = `${summary.coverage.great.toFixed(1)}%`;

  const gap = result.channelCount - result.lowerBound;
  dom.mChannels.innerHTML = `${result.channelCount} <small>${
    result.optimal ? "optimal" : `gap ${gap}`
  }</small>`;
  dom.mBound.textContent = String(result.lowerBound);
  dom.mEdges.textContent = String(result.edges);
  dom.mDensity.textContent = `${(result.density * 100).toFixed(0)}%`;
  dom.mReuse.textContent = result.closestReuse
    ? `${Math.round(result.closestReuse.distance)} m`
    : "—";
  dom.mCoverage.textContent = `${summary.coverage.great.toFixed(1)}%`;

  const byChannel = new Map();
  for (const site of state.sites) {
    const channel = result.channelOf.get(site.id);
    byChannel.set(channel, (byChannel.get(channel) || 0) + 1);
  }
  dom.channelList.innerHTML = [...byChannel.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(
      ([channel, count]) =>
        `<li class="channel-chip"><i style="background:${CHANNEL_COLORS[channel % CHANNEL_COLORS.length]}"></i>CH <b>${channel}</b> · ${count} site${count === 1 ? "" : "s"}</li>`,
    )
    .join("");

  dom.canvas.setAttribute(
    "aria-label",
    `Radio planning map: ${state.sites.length} sites, ${result.channelCount} channels, ${result.edges} interference edges, ${summary.coverage.great.toFixed(0)} percent of the field above 20 dB SINR.`,
  );
}

/* ---------- view transform ---------- */

function activeBounds() {
  return state.frozenBounds || state.result?.bounds || boundsOf(state.sites);
}

function updateTransform() {
  const bounds = activeBounds();
  const padding = 26;
  const scale = Math.min(
    (view.width - padding * 2) / bounds.width,
    (view.height - padding * 2) / bounds.height,
  );
  view.scale = scale;
  view.offsetX = (view.width - bounds.width * scale) / 2;
  view.offsetY = (view.height - bounds.height * scale) / 2;
}

function toScreen(x, y) {
  const bounds = activeBounds();
  return {
    x: view.offsetX + (x - bounds.minX) * view.scale,
    y: view.height - view.offsetY - (y - bounds.minY) * view.scale,
  };
}

function toWorld(x, y) {
  const bounds = activeBounds();
  return {
    x: (x - view.offsetX) / view.scale + bounds.minX,
    y: (view.height - y - view.offsetY) / view.scale + bounds.minY,
  };
}

/* ---------- drawing ---------- */

function queueDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => {
    drawQueued = false;
    draw();
  });
}

function draw() {
  if (!view.width || !state.result) return;
  updateTransform();
  const { width, height } = view;
  const bounds = activeBounds();
  const result = state.result;

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#04080f";
  context.fillRect(0, 0, width, height);

  drawGrid(bounds);

  if (state.layers.coverage) {
    context.save();
    context.imageSmoothingEnabled = true;
    context.globalAlpha = 0.92;
    context.drawImage(
      heat,
      view.offsetX,
      height - view.offsetY - bounds.height * view.scale,
      bounds.width * view.scale,
      bounds.height * view.scale,
    );
    context.restore();
  }

  if (state.layers.graph) drawGraph(result);

  drawSites(result);
  drawScaleBar(bounds);
}

function drawGrid(bounds) {
  const step = bounds.width > 16000 ? 4000 : bounds.width > 8000 ? 2000 : 1000;
  context.save();
  context.strokeStyle = "rgba(148, 163, 184, 0.08)";
  context.lineWidth = 1;
  const startX = Math.ceil(bounds.minX / step) * step;
  const startY = Math.ceil(bounds.minY / step) * step;
  for (let x = startX; x <= bounds.maxX; x += step) {
    const point = toScreen(x, bounds.minY);
    context.beginPath();
    context.moveTo(point.x, view.offsetY);
    context.lineTo(point.x, view.height - view.offsetY);
    context.stroke();
  }
  for (let y = startY; y <= bounds.maxY; y += step) {
    const point = toScreen(bounds.minX, y);
    context.beginPath();
    context.moveTo(view.offsetX, point.y);
    context.lineTo(view.width - view.offsetX, point.y);
    context.stroke();
  }
  context.restore();
}

function drawGraph(result) {
  const positions = new Map(state.sites.map((site) => [site.id, site]));
  context.save();
  context.strokeStyle = "rgba(148, 163, 184, 0.26)";
  context.lineWidth = 1;
  for (const [id, neighbours] of result.graph) {
    for (const neighbour of neighbours) {
      if (id >= neighbour) continue;
      const a = toScreen(positions.get(id).x, positions.get(id).y);
      const b = toScreen(positions.get(neighbour).x, positions.get(neighbour).y);
      context.beginPath();
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
      context.stroke();
    }
  }
  context.restore();
}

function drawSites(result) {
  context.save();
  context.font = "600 10px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";
  for (const site of state.sites) {
    const channel = result.channelOf.get(site.id) ?? 0;
    const color = CHANNEL_COLORS[channel % CHANNEL_COLORS.length];
    const point = toScreen(site.x, site.y);
    const selected = state.selected === site.id;

    if (selected) {
      context.beginPath();
      context.arc(point.x, point.y, 15, 0, Math.PI * 2);
      context.strokeStyle = "rgba(233, 239, 249, 0.85)";
      context.lineWidth = 1.5;
      context.stroke();
    }

    context.beginPath();
    context.arc(point.x, point.y, 9, 0, Math.PI * 2);
    context.fillStyle = color;
    context.fill();
    context.strokeStyle = "rgba(4, 8, 15, 0.95)";
    context.lineWidth = 2.5;
    context.stroke();

    context.fillStyle = "#04120c";
    context.fillText(String(channel), point.x, point.y + 0.5);

    if (state.layers.labels) {
      context.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      context.fillStyle = "rgba(233, 239, 249, 0.82)";
      context.fillText(site.id, point.x, point.y + 21);
      context.font = "600 10px ui-monospace, SFMono-Regular, Menlo, monospace";
    }
  }
  context.restore();
}

function drawScaleBar(bounds) {
  const metres = bounds.width > 12000 ? 2000 : 1000;
  const pixels = metres * view.scale;
  const x = view.width - view.offsetX - pixels;
  const y = view.height - view.offsetY - 18;
  context.save();
  context.strokeStyle = "rgba(233, 239, 249, 0.5)";
  context.fillStyle = "rgba(233, 239, 249, 0.55)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(x + pixels, y);
  context.moveTo(x, y - 3);
  context.lineTo(x, y + 3);
  context.moveTo(x + pixels, y - 3);
  context.lineTo(x + pixels, y + 3);
  context.stroke();
  context.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.textAlign = "center";
  context.fillText(`${metres / 1000} km`, x + pixels / 2, y - 8);
  context.restore();
}

/* ---------- interaction ---------- */

function siteAt(screenX, screenY) {
  let closest = null;
  let best = 18;
  for (const site of state.sites) {
    const point = toScreen(site.x, site.y);
    const distance = Math.hypot(point.x - screenX, point.y - screenY);
    if (distance < best) {
      best = distance;
      closest = site;
    }
  }
  return closest;
}

function pointerPosition(event) {
  const rect = dom.canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function showTooltip(site, screenX, screenY) {
  const channel = state.result.channelOf.get(site.id) ?? 0;
  const degree = state.result.graph.get(site.id)?.size ?? 0;
  dom.tooltip.innerHTML = `
    <strong>${site.id} · channel ${channel}</strong>
    <dl>
      <dt>power</dt><dd>${site.power.toFixed(1)} dBm</dd>
      <dt>gain</dt><dd>${site.gain.toFixed(1)} dBi</dd>
      <dt>interferers</dt><dd>${degree}</dd>
      <dt>position</dt><dd>${Math.round(site.x / 100) / 10}, ${Math.round(site.y / 100) / 10} km</dd>
    </dl>`;
  dom.tooltip.hidden = false;
  const bounds = dom.stage.getBoundingClientRect();
  const tooltipWidth = dom.tooltip.offsetWidth;
  const left = Math.min(Math.max(screenX + 16, 8), bounds.width - tooltipWidth - 8);
  const top = Math.max(screenY - 12, 8);
  dom.tooltip.style.left = `${left}px`;
  dom.tooltip.style.top = `${top}px`;
}

function hideTooltip() {
  dom.tooltip.hidden = true;
  hovered = null;
}

dom.canvas.addEventListener("pointerdown", (event) => {
  const point = pointerPosition(event);
  const site = siteAt(point.x, point.y);
  if (!site) {
    state.selected = null;
    queueDraw();
    return;
  }
  state.selected = site.id;
  dragging = { site, pointerId: event.pointerId };
  state.frozenBounds = state.result?.bounds || boundsOf(state.sites);
  dom.canvas.setPointerCapture(event.pointerId);
  dom.canvas.classList.add("is-dragging");
  hideTooltip();
  dom.canvas.focus();
  queueDraw();
});

dom.canvas.addEventListener("pointermove", (event) => {
  const point = pointerPosition(event);
  if (dragging) {
    const world = toWorld(point.x, point.y);
    const bounds = state.frozenBounds;
    dragging.site.x = Math.min(Math.max(world.x, bounds.minX), bounds.maxX);
    dragging.site.y = Math.min(Math.max(world.y, bounds.minY), bounds.maxY);
    scheduleCompute();
    return;
  }
  const site = siteAt(point.x, point.y);
  if (site) {
    showTooltip(site, point.x, point.y);
    dom.canvas.style.cursor = "grab";
  } else {
    hideTooltip();
    dom.canvas.style.cursor = "crosshair";
  }
});

function endDrag() {
  if (!dragging) return;
  dragging = null;
  state.frozenBounds = null;
  dom.canvas.classList.remove("is-dragging");
  scheduleCompute();
  queueDraw();
}

dom.canvas.addEventListener("pointerup", endDrag);
dom.canvas.addEventListener("pointercancel", endDrag);
dom.canvas.addEventListener("pointerleave", () => {
  hideTooltip();
});

dom.canvas.addEventListener("keydown", (event) => {
  if (!state.selected) return;
  const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
  const move = moves[event.key];
  if (!move) return;
  event.preventDefault();
  const site = state.sites.find((item) => item.id === state.selected);
  if (!site) return;
  const step = event.shiftKey ? 500 : 100;
  const bounds = activeBounds();
  site.x = Math.min(Math.max(site.x + move[0] * step, bounds.minX), bounds.maxX);
  site.y = Math.min(Math.max(site.y + move[1] * step, bounds.minY), bounds.maxY);
  scheduleCompute();
});

/* ---------- controls ---------- */

function applyPreset(preset, power = state.power, gain = state.gain) {
  state.preset = preset;
  state.sites = makeSites(preset, state.env).map((site) => ({
    ...site,
    power,
    gain,
  }));
  state.selected = null;
  compute();
}

function setStatus(text, kind = "") {
  dom.status.textContent = text;
  dom.status.className = `status${kind ? ` is-${kind}` : ""}`;
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    dom.status.textContent = defaultStatus;
    dom.status.className = "status";
  }, 4200);
}

dom.preset.addEventListener("change", () => {
  applyPreset(dom.preset.value);
});

dom.power.addEventListener("input", () => {
  state.power = Number(dom.power.value);
  dom.powerOut.textContent = `${state.power} dBm`;
  for (const site of state.sites) site.power = state.power;
  scheduleCompute();
});

dom.gain.addEventListener("input", () => {
  state.gain = Number(dom.gain.value);
  dom.gainOut.textContent = `${state.gain} dBi`;
  for (const site of state.sites) site.gain = state.gain;
  scheduleCompute();
});

dom.exponent.addEventListener("input", () => {
  state.env.exponent = Number(dom.exponent.value);
  dom.exponentOut.textContent = state.env.exponent.toFixed(1);
  scheduleCompute();
});

dom.margin.addEventListener("input", () => {
  state.margin = Number(dom.margin.value);
  dom.marginOut.textContent = `${state.margin} dB`;
  scheduleCompute();
});

dom.toggleCoverage.addEventListener("change", () => {
  state.layers.coverage = dom.toggleCoverage.checked;
  queueDraw();
});
dom.toggleGraph.addEventListener("change", () => {
  state.layers.graph = dom.toggleGraph.checked;
  queueDraw();
});
dom.toggleLabels.addEventListener("change", () => {
  state.layers.labels = dom.toggleLabels.checked;
  queueDraw();
});

dom.reset.addEventListener("click", () => {
  state.env = { ...DEFAULT_ENV };
  state.margin = DEFAULT_MARGIN;
  state.power = DEFAULT_POWER;
  state.gain = DEFAULT_GAIN;
  dom.preset.value = "small";
  dom.power.value = String(DEFAULT_POWER);
  dom.gain.value = String(DEFAULT_GAIN);
  dom.exponent.value = String(DEFAULT_ENV.exponent);
  dom.margin.value = String(DEFAULT_MARGIN);
  dom.powerOut.textContent = `${DEFAULT_POWER} dBm`;
  dom.gainOut.textContent = `${DEFAULT_GAIN} dBi`;
  dom.exponentOut.textContent = DEFAULT_ENV.exponent.toFixed(1);
  dom.marginOut.textContent = `${DEFAULT_MARGIN} dB`;
  history.replaceState(null, "", location.pathname);
  applyPreset("small", DEFAULT_POWER, DEFAULT_GAIN);
  setStatus("Field reset.", "ok");
});

/* ---------- exports ---------- */

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function buildSvg() {
  const bounds = state.result.bounds;
  const width = 1200;
  const height = Math.round((width * bounds.height) / bounds.width);
  const pad = 40;
  const scale = Math.min(
    (width - pad * 2) / bounds.width,
    (height - pad * 2) / bounds.height,
  );
  const offsetX = (width - bounds.width * scale) / 2;
  const offsetY = (height - bounds.height * scale) / 2;
  const x2 = (x) => offsetX + (x - bounds.minX) * scale;
  const y2 = (y) => height - offsetY - (y - bounds.minY) * scale;
  const cellWidth = (bounds.width * scale) / COLUMNS;
  const cellHeight = (bounds.height * scale) / ROWS;
  const parts = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="ui-monospace,Menlo,monospace">`,
    `<rect width="100%" height="100%" fill="#0b1120"/>`,
    `<text x="${pad}" y="26" fill="#f8fafc" font-size="16">Atlas Studio — ${state.result.channelCount} channels · ${state.sites.length} sites</text>`,
    `<text x="${pad}" y="44" fill="#94a3b8" font-size="11">${state.result.edges} interference edges · mean SINR ${state.result.grid.summary.meanSinr.toFixed(1)} dB · ${state.result.grid.summary.coverage.great.toFixed(1)}% ≥ 20 dB</text>`,
  ];
  for (let row = 0; row < ROWS; row += 1) {
    const gridRow = ROWS - 1 - row;
    for (let column = 0; column < COLUMNS; column += 1) {
      const quality = state.result.grid.cells[gridRow * COLUMNS + column];
      const x = offsetX + column * cellWidth;
      const y = offsetY + row * cellHeight;
      parts.push(
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(cellWidth + 0.6).toFixed(1)}" height="${(cellHeight + 0.6).toFixed(1)}" fill="${COVERAGE_SVG[quality]}"/>`,
      );
    }
  }
  const positions = new Map(state.sites.map((site) => [site.id, site]));
  for (const [id, neighbours] of state.result.graph) {
    for (const neighbour of neighbours) {
      if (id >= neighbour) continue;
      const a = positions.get(id);
      const b = positions.get(neighbour);
      parts.push(
        `<line x1="${x2(a.x).toFixed(1)}" y1="${y2(a.y).toFixed(1)}" x2="${x2(b.x).toFixed(1)}" y2="${y2(b.y).toFixed(1)}" stroke="#94a3b8" stroke-opacity="0.3"/>`,
      );
    }
  }
  for (const site of state.sites) {
    const channel = state.result.channelOf.get(site.id);
    parts.push(
      `<circle cx="${x2(site.x).toFixed(1)}" cy="${y2(site.y).toFixed(1)}" r="11" fill="${CHANNEL_COLORS[channel % CHANNEL_COLORS.length]}" stroke="#0b1120" stroke-width="3"/>`,
      `<text x="${x2(site.x).toFixed(1)}" y="${(y2(site.y) + 3.5).toFixed(1)}" fill="#04120c" font-size="10" font-weight="700" text-anchor="middle">${channel}</text>`,
      `<text x="${x2(site.x).toFixed(1)}" y="${(y2(site.y) + 25).toFixed(1)}" fill="#e2e8f0" font-size="9" text-anchor="middle">${site.id}</text>`,
    );
  }
  parts.push("</svg>");
  return parts.join("\n");
}

function planJson() {
  return {
    version: 1,
    environment: {
      frequency_mhz: state.env.frequencyMhz,
      channel_width_mhz: state.env.bandwidthMhz,
      noise_figure_db: state.env.noiseFigureDb,
      exponent: state.env.exponent,
      adjacency_isolation_db: state.env.adjacencyIsolationDb,
    },
    margin_db: state.margin,
    width_m: Math.round(state.result.bounds.width),
    height_m: Math.round(state.result.bounds.height),
    transmitters: state.sites.map((site) => ({
      name: site.id,
      x: Math.round(site.x),
      y: Math.round(site.y),
      power_dbm: site.power,
      gain_dbi: site.gain,
      channel: state.result.channelOf.get(site.id),
    })),
  };
}

dom.exportSvg.addEventListener("click", () => {
  download("atlas-studio-plan.svg", buildSvg(), "image/svg+xml");
  setStatus("SVG exported.", "ok");
});

dom.exportJson.addEventListener("click", () => {
  download("atlas-studio-plan.json", JSON.stringify(planJson(), null, 2), "application/json");
  setStatus("Plan JSON exported.", "ok");
});

dom.importInput.addEventListener("change", async () => {
  const file = dom.importInput.files?.[0];
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    if (!Array.isArray(payload.transmitters) || payload.transmitters.length === 0) {
      throw new Error("no transmitters in file");
    }
    const env = payload.environment || {};
    state.env = {
      frequencyMhz: Number(env.frequency_mhz) || 900,
      bandwidthMhz: Number(env.channel_width_mhz) || 0.2,
      noiseFigureDb: Number(env.noise_figure_db) || 7,
      exponent: Number(env.exponent) || 3.2,
      adjacencyIsolationDb: Number(env.adjacency_isolation_db) || 30,
    };
    state.margin = Number(payload.margin_db) || DEFAULT_MARGIN;
    state.sites = payload.transmitters.map((item, index) => ({
      id: item.name || `S${String(index + 1).padStart(2, "0")}`,
      x: Number(item.x) || 0,
      y: Number(item.y) || 0,
      power: Number(item.power_dbm) || DEFAULT_POWER,
      gain: Number(item.gain_dbi) || DEFAULT_GAIN,
    }));
    state.power = state.sites[0].power;
    state.gain = state.sites[0].gain;
    state.selected = null;
    dom.exponent.value = String(state.env.exponent);
    dom.margin.value = String(state.margin);
    dom.power.value = String(state.power);
    dom.gain.value = String(state.gain);
    dom.exponentOut.textContent = state.env.exponent.toFixed(1);
    dom.marginOut.textContent = `${state.margin} dB`;
    dom.powerOut.textContent = `${state.power} dBm`;
    dom.gainOut.textContent = `${state.gain} dBi`;
    compute();
    setStatus(`Loaded ${state.sites.length} sites from ${file.name}.`, "ok");
  } catch (error) {
    setStatus(`Could not load plan: ${error.message}`, "error");
  } finally {
    dom.importInput.value = "";
  }
});

/* ---------- share links ---------- */

function encodeState() {
  const payload = {
    p: state.preset,
    e: state.env,
    m: state.margin,
    s: state.sites.map((site) => [
      site.id,
      Math.round(site.x),
      Math.round(site.y),
      Number(site.power.toFixed(1)),
      Number(site.gain.toFixed(1)),
    ]),
  };
  const base64 = btoa(JSON.stringify(payload))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  return `${location.origin}${location.pathname}#p=${base64}`;
}

function decodeState(encoded) {
  const base64 = encoded.replaceAll("-", "+").replaceAll("_", "/");
  const payload = JSON.parse(atob(base64));
  if (!Array.isArray(payload.s) || payload.s.length === 0) throw new Error("empty state");
  return {
    preset: payload.p || "custom",
    env: {
      frequencyMhz: Number(payload.e?.frequencyMhz) || 900,
      bandwidthMhz: Number(payload.e?.bandwidthMhz) || 0.2,
      noiseFigureDb: Number(payload.e?.noiseFigureDb) || 7,
      exponent: Number(payload.e?.exponent) || 3.2,
      adjacencyIsolationDb: Number(payload.e?.adjacencyIsolationDb) || 30,
    },
    margin: Number(payload.m) || DEFAULT_MARGIN,
    sites: payload.s.map(([id, x, y, power, gain]) => ({
      id: String(id),
      x: Number(x),
      y: Number(y),
      power: Number(power),
      gain: Number(gain),
    })),
  };
}

dom.share.addEventListener("click", async () => {
  const link = encodeState();
  history.replaceState(null, "", link.slice(link.indexOf("#")));
  try {
    await navigator.clipboard.writeText(link);
    setStatus("Share link copied to clipboard.", "ok");
  } catch {
    setStatus("Link is in the address bar — copy it from there.", "ok");
  }
});

/* ---------- boot ---------- */

function restoreFromHash() {
  if (!location.hash.startsWith("#p=")) return false;
  try {
    const restored = decodeState(location.hash.slice(3));
    state.preset = restored.preset;
    state.env = restored.env;
    state.margin = restored.margin;
    state.sites = restored.sites;
    state.power = restored.sites[0].power;
    state.gain = restored.sites[0].gain;
    dom.preset.value = ["small", "macro", "dense", "random"].includes(state.preset)
      ? state.preset
      : "small";
    dom.power.value = String(state.power);
    dom.gain.value = String(state.gain);
    dom.exponent.value = String(state.env.exponent);
    dom.margin.value = String(state.margin);
    dom.powerOut.textContent = `${state.power} dBm`;
    dom.gainOut.textContent = `${state.gain} dBi`;
    dom.exponentOut.textContent = state.env.exponent.toFixed(1);
    dom.marginOut.textContent = `${state.margin} dB`;
    return true;
  } catch {
    return false;
  }
}

function resize() {
  const rect = dom.stage.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  dom.canvas.width = Math.round(rect.width * dpr);
  dom.canvas.height = Math.round(rect.height * dpr);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  view.width = rect.width;
  view.height = rect.height;
  queueDraw();
}

function boot() {
  const restored = restoreFromHash();
  if (!restored) {
    state.sites = makeSites("small", state.env).map((site) => ({
      ...site,
      power: DEFAULT_POWER,
      gain: DEFAULT_GAIN,
    }));
  }
  resize();
  new ResizeObserver(resize).observe(dom.stage);
  compute();
  window.addEventListener("hashchange", () => {
    if (restoreFromHash()) compute();
  });
  dom.canvas.focus({ preventScroll: true });
}

boot();
