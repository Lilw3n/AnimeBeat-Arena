/**
 * Lancement sélectif des sorties Aitum Stream Suite (cases à cocher + groupes dans le hub).
 * « Start All » d'Aitum lance TOUT ; ici on démarre seulement les sorties cochées
 * ou un groupe entier, une par une (attente de connexion) pour éviter le crash
 * du double démarrage. WebSocket vendor "aitum-stream-suite".
 *
 * Groupes = catégories libres (ex. « Horizontal », « Vertical », « Twitter ») qui
 * rangent les sorties ; ordre et contenu modifiables par glisser-déposer, sauvegardés
 * dans la config du hub (config.aitumLaunch.groups) — aitum.json n'est pas touché.
 */
const fs = require("fs");
const obsBridge = require("./obs-bridge");
const { loadConfig, saveConfig } = require("./config");
const { notify } = require("./notify");

const VENDOR = "aitum-stream-suite";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function vendor(obsConfig, requestType, requestData = {}) {
  const res = await obsBridge.callVendor(obsConfig, VENDOR, requestType, requestData);
  if (res?.success === false) throw new Error(res.error || `${requestType} refusé`);
  return res;
}

function launchCfg(config) {
  const l = config?.aitumLaunch || {};
  return {
    selected: Array.isArray(l.selected) ? l.selected : [],
    groups: Array.isArray(l.groups) ? l.groups : null,
  };
}

/** Canvas de chaque sortie, lu dans aitum.json (sans secrets). */
function outputCanvasMap() {
  const map = {};
  try {
    const { getAitumPath } = require("./aitum-config");
    const d = JSON.parse(fs.readFileSync(getAitumPath(), "utf8"));
    for (const o of d.outputs || []) {
      const v = (o.video_encoders || [])[0] || {};
      map[o.name] = v.canvas || o.canvas || "Main";
    }
  } catch {
    /* aitum.json illisible → pas de canvas */
  }
  return map;
}

/** Groupes normalisés : chaque sortie connue apparaît une seule fois. */
function normalizeGroups(groups, outputs) {
  const names = outputs.map((o) => o.name);
  const seen = new Set();
  let list;
  if (!groups || !groups.length) {
    // premier passage : un groupe par canvas
    const byCanvas = new Map();
    for (const o of outputs) {
      const key = o.canvas || "Autres";
      if (!byCanvas.has(key)) byCanvas.set(key, []);
      byCanvas.get(key).push(o.name);
    }
    list = [...byCanvas.entries()].map(([name, items]) => ({ name, items, collapsed: false }));
  } else {
    list = groups.map((g) => ({
      name: String(g.name || "Groupe"),
      collapsed: Boolean(g.collapsed),
      items: (g.items || []).map(String),
    }));
  }
  for (const g of list) {
    g.items = g.items.filter((n) => {
      if (seen.has(n)) return false;
      // garder les sorties absentes d'OBS seulement si OBS est injoignable (names vide)
      if (names.length && !names.includes(n)) return false;
      seen.add(n);
      return true;
    });
  }
  const orphans = names.filter((n) => !seen.has(n));
  if (orphans.length) {
    let other = list.find((g) => g.name === "Sans groupe");
    if (!other) {
      other = { name: "Sans groupe", items: [], collapsed: false };
      list.push(other);
    }
    other.items.push(...orphans);
  }
  return list;
}

async function listOutputs() {
  const config = loadConfig();
  const lc = launchCfg(config);
  const selected = new Set(lc.selected);
  const canvasOf = outputCanvasMap();
  try {
    const res = await vendor(config.obs, "get_outputs");
    const outputs = (res.outputs || []).map((o) => ({
      name: o.name,
      type: o.type || "",
      canvas: canvasOf[o.name] || "",
      active: Boolean(o.active),
      reconnecting: Boolean(o.reconnecting),
      dropped: o.dropped_frames ?? 0,
      selected: selected.has(o.name),
    }));
    return { ok: true, outputs, selected: [...selected], groups: normalizeGroups(lc.groups, outputs) };
  } catch (err) {
    const known = new Set([...(lc.groups || []).flatMap((g) => g.items || []), ...selected]);
    const outputs = [...known].map((name) => ({
      name,
      type: "",
      canvas: canvasOf[name] || "",
      active: false,
      selected: selected.has(name),
    }));
    return {
      ok: false,
      reason: `OBS / Aitum injoignable : ${err.message}`,
      outputs,
      selected: [...selected],
      groups: normalizeGroups(lc.groups, []),
    };
  }
}

function setSelected(names = []) {
  const config = loadConfig();
  config.aitumLaunch = { ...(config.aitumLaunch || {}), selected: [...new Set(names.map(String))] };
  saveConfig(config);
  return { ok: true, selected: config.aitumLaunch.selected };
}

function setGroups(groups = []) {
  const config = loadConfig();
  const clean = (Array.isArray(groups) ? groups : [])
    .map((g) => ({
      name: String(g?.name || "").trim().slice(0, 60) || "Groupe",
      collapsed: Boolean(g?.collapsed),
      items: [...new Set((g?.items || []).map(String))],
    }))
    .slice(0, 50);
  config.aitumLaunch = { ...(config.aitumLaunch || {}), groups: clean };
  saveConfig(config);
  return { ok: true, groups: clean };
}

async function waitActive(obsConfig, name, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    await sleep(700);
    try {
      const res = await vendor(obsConfig, "get_outputs");
      const o = (res.outputs || []).find((x) => x.name === name);
      if (o?.active) return true;
    } catch {
      /* on réessaie */
    }
  }
  return false;
}

/** Démarre une liste de sorties une par une. */
async function startNames(names, label) {
  const config = loadConfig();
  if (!names.length) return { ok: false, reason: "Aucune sortie à lancer" };
  const state = await listOutputs();
  if (!state.ok) return state;
  const results = [];
  for (const name of names) {
    const o = state.outputs.find((x) => x.name === name);
    if (!o) {
      results.push({ name, ok: false, reason: "sortie introuvable dans Aitum" });
      continue;
    }
    if (o.active) {
      results.push({ name, ok: true, already: true });
      continue;
    }
    try {
      await vendor(config.obs, "start_output", { output: name });
      // stream : laisser le temps de se connecter avant la suivante (évite le crash Aitum)
      const isStream = !o.type || o.type === "stream";
      const active = await waitActive(config.obs, name, isStream ? 10000 : 4000);
      results.push({ name, ok: active, reason: active ? "" : "pas encore active (voir OBS)" });
    } catch (err) {
      results.push({ name, ok: false, reason: err.message });
    }
  }
  const okCount = results.filter((r) => r.ok).length;
  notify("Sorties Aitum", `${label}: ${okCount}/${results.length} lancées`, okCount === results.length ? "info" : "warn");
  return { ...(await listOutputs()), ok: okCount === results.length, results };
}

async function stopNames(names, label) {
  const config = loadConfig();
  const results = [];
  for (const name of names) {
    try {
      await vendor(config.obs, "stop_output", { output: name });
      results.push({ name, ok: true });
    } catch (err) {
      results.push({ name, ok: false, reason: err.message });
    }
    await sleep(300);
  }
  notify("Sorties Aitum", `${label}: arrêt demandé (${names.join(", ") || "aucune"})`, "info");
  await sleep(1000);
  return { ...(await listOutputs()), ok: true, results };
}

function groupItems(name) {
  const config = loadConfig();
  const g = (launchCfg(config).groups || []).find((x) => x.name === name);
  return g ? g.items : null;
}

async function startSelected() {
  return startNames(launchCfg(loadConfig()).selected, "Sélection");
}

async function stopSelected() {
  return stopNames(launchCfg(loadConfig()).selected, "Sélection");
}

async function startGroup(name) {
  let items = groupItems(name);
  if (!items) {
    // groupe auto (pas encore enregistré) : le recalculer
    const st = await listOutputs();
    items = st.groups.find((g) => g.name === name)?.items || [];
  }
  return startNames(items, `Groupe ${name}`);
}

async function stopGroup(name) {
  let items = groupItems(name);
  if (!items) {
    const st = await listOutputs();
    items = st.groups.find((g) => g.name === name)?.items || [];
  }
  return stopNames(items, `Groupe ${name}`);
}

async function toggleOne(name, start) {
  const config = loadConfig();
  try {
    await vendor(config.obs, start ? "start_output" : "stop_output", { output: name });
    if (start) await waitActive(config.obs, name, 10000);
    return { ...(await listOutputs()), ok: true };
  } catch (err) {
    return { ...(await listOutputs()), ok: false, reason: err.message };
  }
}

module.exports = {
  listOutputs,
  setSelected,
  setGroups,
  startSelected,
  stopSelected,
  startGroup,
  stopGroup,
  toggleOne,
};
