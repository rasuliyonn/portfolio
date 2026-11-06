/**
 * Browser port of the Interference Atlas model: path loss, interference graph,
 * DSATUR colouring, clique lower bound and SINR coverage.
 * All powers in dBm, distances in metres, frequencies in MHz.
 */

export const CHANNEL_COLORS = [
  "#6ee7b7",
  "#7dd3fc",
  "#fbbf24",
  "#f472b6",
  "#a78bfa",
  "#34d399",
  "#fb923c",
  "#38bdf8",
  "#e879f9",
  "#facc15",
  "#4ade80",
  "#93c5fd",
];

export const QUALITY = ["outage", "fair", "good", "great"];

export function noiseFloorDbm(bandwidthMhz, noiseFigureDb) {
  return -174 + 10 * Math.log10(bandwidthMhz * 1e6) + noiseFigureDb;
}

export function pathLossDb(distanceM, frequencyMhz, exponent) {
  const d = Math.max(distanceM, 1);
  const reference = 32.44 + 20 * Math.log10(25 / 1000) + 20 * Math.log10(frequencyMhz);
  return reference + 10 * exponent * Math.log10(Math.max(d, 25) / 25);
}

export function rxPowerDbm(site, x, y, env) {
  const distance = Math.hypot(site.x - x, site.y - y);
  return site.power + site.gain - pathLossDb(distance, env.frequencyMhz, env.exponent);
}

export function potentialInterferenceDb(a, b, env) {
  const atB = rxPowerDbm(a, b.x, b.y, env);
  const atA = rxPowerDbm(b, a.x, a.y, env);
  return Math.max(atA, atB) - noiseFloorDbm(env.bandwidthMhz, env.noiseFigureDb);
}

export function buildGraph(sites, env, marginDb) {
  const graph = new Map(sites.map((site) => [site.id, new Set()]));
  for (let i = 0; i < sites.length; i += 1) {
    for (let j = i + 1; j < sites.length; j += 1) {
      if (potentialInterferenceDb(sites[i], sites[j], env) >= marginDb) {
        graph.get(sites[i].id).add(sites[j].id);
        graph.get(sites[j].id).add(sites[i].id);
      }
    }
  }
  return graph;
}

export function dsatur(graph) {
  const names = [...graph.keys()].sort();
  const colors = new Map();
  const saturation = new Map(names.map((name) => [name, new Set()]));
  while (colors.size < names.length) {
    let best = null;
    for (const name of names) {
      if (colors.has(name)) continue;
      if (best === null) {
        best = name;
        continue;
      }
      const score = [saturation.get(name).size, graph.get(name).size];
      const bestScore = [saturation.get(best).size, graph.get(best).size];
      if (score[0] > bestScore[0] || (score[0] === bestScore[0] && score[1] > bestScore[1])) {
        best = name;
      }
    }
    const used = saturation.get(best);
    let channel = 0;
    while (used.has(channel)) channel += 1;
    colors.set(best, channel);
    for (const neighbour of graph.get(best)) {
      if (!colors.has(neighbour)) saturation.get(neighbour).add(channel);
    }
  }
  return colors;
}

export function maxClique(graph) {
  let best = [];
  function expand(current, candidates, excluded) {
    if (candidates.size === 0 && excluded.size === 0) {
      if (current.length > best.length) best = [...current];
      return;
    }
    let pivot = null;
    let pivotScore = -1;
    for (const vertex of [...candidates, ...excluded]) {
      let score = 0;
      for (const neighbour of graph.get(vertex)) if (candidates.has(neighbour)) score += 1;
      if (score > pivotScore) {
        pivotScore = score;
        pivot = vertex;
      }
    }
    const blocked = pivot === null ? new Set() : graph.get(pivot);
    for (const vertex of [...candidates].filter((item) => !blocked.has(item))) {
      expand(
        [...current, vertex],
        new Set([...candidates].filter((item) => graph.get(vertex).has(item))),
        new Set([...excluded].filter((item) => graph.get(vertex).has(item))),
      );
      candidates.delete(vertex);
      excluded.add(vertex);
    }
  }
  expand([], new Set(graph.keys()), new Set());
  return best;
}

export function evaluateLink(sites, channelOf, x, y, env) {
  const byId = new Map(sites.map((site) => [site.id, site]));
  let serving = null;
  let servingPower = -Infinity;
  const powers = new Map();
  for (const site of sites) {
    const power = rxPowerDbm(site, x, y, env);
    powers.set(site.id, power);
    if (power > servingPower) {
      servingPower = power;
      serving = site;
    }
  }
  const servingChannel = channelOf.get(serving.id);
  let interference = 0;
  for (const [id, power] of powers) {
    if (id === serving.id) continue;
    const separation = Math.abs(channelOf.get(id) - servingChannel);
    const isolation =
      separation === 0 ? 0 : separation === 1 ? env.adjacencyIsolationDb : 70;
    interference += 10 ** ((power - isolation) / 10);
  }
  const noise = 10 ** (noiseFloorDbm(env.bandwidthMhz, env.noiseFigureDb) / 10);
  const sinr = servingPower - 10 * Math.log10(noise + interference);
  return { serving: byId.get(serving.id), sinr, quality: qualityOf(sinr) };
}

export function qualityOf(sinr) {
  if (sinr >= 20) return "great";
  if (sinr >= 10) return "good";
  if (sinr >= 0) return "fair";
  return "outage";
}

export function boundsOf(sites, padding = 0.18) {
  if (sites.length === 0) return { minX: 0, minY: 0, maxX: 4000, maxY: 3000, width: 4000, height: 3000 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const site of sites) {
    minX = Math.min(minX, site.x);
    minY = Math.min(minY, site.y);
    maxX = Math.max(maxX, site.x);
    maxY = Math.max(maxY, site.y);
  }
  const width = Math.max(maxX - minX, 1200);
  const height = Math.max(maxY - minY, 1200);
  const padX = width * padding;
  const padY = height * padding;
  return {
    minX: minX - padX,
    minY: minY - padY,
    maxX: maxX + padX,
    maxY: maxY + padY,
    width: width + padX * 2,
    height: height + padY * 2,
  };
}

export function coverageGrid(sites, channelOf, env, bounds, columns = 96, rows = 64) {
  const cells = new Array(columns * rows);
  const counts = { great: 0, good: 0, fair: 0, outage: 0 };
  let sinrTotal = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = bounds.minX + ((column + 0.5) / columns) * bounds.width;
      const y = bounds.minY + ((row + 0.5) / rows) * bounds.height;
      const link = evaluateLink(sites, channelOf, x, y, env);
      cells[row * columns + column] = link.quality;
      counts[link.quality] += 1;
      sinrTotal += link.sinr;
    }
  }
  const total = columns * rows;
  return {
    columns,
    rows,
    cells,
    summary: {
      counts,
      coverage: {
        great: (counts.great / total) * 100,
        good: (counts.good / total) * 100,
        fair: (counts.fair / total) * 100,
        outage: (counts.outage / total) * 100,
      },
      meanSinr: sinrTotal / total,
      total,
    },
  };
}

export function plan(sites, env, marginDb, bounds = null, columns = 96, rows = 64) {
  const graph = buildGraph(sites, env, marginDb);
  const channelOf = dsatur(graph);
  const clique = maxClique(graph);
  const area = bounds || boundsOf(sites);
  const grid = coverageGrid(sites, channelOf, env, area, columns, rows);
  let edges = 0;
  for (const neighbours of graph.values()) edges += neighbours.size;
  edges /= 2;

  let density = 0;
  if (sites.length > 1) density = (edges * 2) / (sites.length * (sites.length - 1));

  const channelCount = new Set(channelOf.values()).size;
  const lowerBound = Math.max(1, clique.length);

  const reuse = [];
  const list = [...sites].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      if (channelOf.get(list[i].id) !== channelOf.get(list[j].id)) continue;
      reuse.push({
        a: list[i].id,
        b: list[j].id,
        distance: Math.hypot(list[i].x - list[j].x, list[i].y - list[j].y),
      });
    }
  }
  reuse.sort((a, b) => a.distance - b.distance);

  return {
    graph,
    channelOf,
    channelCount,
    lowerBound,
    clique,
    edges,
    density,
    grid,
    bounds: area,
    optimal: channelCount === lowerBound,
    closestReuse: reuse[0] || null,
  };
}

export function makeSites(preset, env) {
  const layouts = {
    small: { columns: 5, rows: 4, spacing: 2500 },
    macro: { columns: 4, rows: 3, spacing: 3800 },
    dense: { columns: 6, rows: 5, spacing: 1800 },
  };
  if (preset === "random") {
    let seed = 20261106;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    return Array.from({ length: 14 }, (_, index) => ({
      id: `S${String(index + 1).padStart(2, "0")}`,
      x: 1500 + random() * 9000,
      y: 1500 + random() * 7000,
      power: 27 + random() * 6,
      gain: 8 + random() * 4,
    }));
  }
  const layout = layouts[preset] || layouts.small;
  const margin = layout.spacing * 0.7;
  const sites = [];
  for (let row = 0; row < layout.rows; row += 1) {
    for (let column = 0; column < layout.columns; column += 1) {
      sites.push({
        id: `S${String(row * layout.columns + column + 1).padStart(2, "0")}`,
        x: margin + column * layout.spacing,
        y: margin + row * layout.spacing,
        power: 30,
        gain: 10,
      });
    }
  }
  return sites;
}
