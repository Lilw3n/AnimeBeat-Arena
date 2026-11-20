/**
 * Lancement sélectif des sorties Aitum Stream Suite (cases à cocher dans le hub).
 * « Start All » d'Aitum lance TOUT ; ici on démarre seulement les sorties cochées,
 * une par une (attente de connexion) pour éviter le crash du double démarrage.
 * WebSocket vendor "aitum-stream-suite" : get_outputs / start_output / stop_output.
 */
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

function getSelected(config) {
  return Array.isArray(config?.aitumLaunch?.selected) ? config.aitumLaunch.selected : [];
}

async function listOutputs() {
  const config = loadConfig();
  const selected = new Set(getSelected(config));
  try {
    const res = await vendor(config.obs, "get_outputs");
    const outputs = (res.outputs || []).map((o) => ({
      name: o.name,
      type: o.type || "",
      active: Boolean(o.active),
      reconnecting: Boolean(o.reconnecting),
      dropped: o.dropped_frames ?? 0,
      selected: selected.has(o.name),
    }));
    return { ok: true, outputs, selected: [...selected] };
  } catch (err) {
    return {
      ok: false,
      reason: `OBS / Aitum injoignable : ${err.message}`,
      outputs: [...selected].map((name) => ({ name, type: "", active: false, selected: true })),
      selected: [...selected],
    };
  }
}

function setSelected(names = []) {
  const config = loadConfig();
  config.aitumLaunch = { ...(config.aitumLaunch || {}), selected: [...new Set(names.map(String))] };
  saveConfig(config);
  return { ok: true, selected: config.aitumLaunch.selected };
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

async function startSelected() {
  const config = loadConfig();
  const names = getSelected(config);
  if (!names.length) return { ok: false, reason: "Aucune sortie cochée" };
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
  notify("Sorties Aitum", `${okCount}/${results.length} lancées`, okCount === results.length ? "info" : "warn");
  return { ok: okCount === results.length, results, ...(await listOutputs()) };
}

async function stopSelected() {
  const config = loadConfig();
  const names = getSelected(config);
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
  notify("Sorties Aitum", `Arrêt demandé: ${names.join(", ") || "aucune"}`, "info");
  await sleep(1000);
  return { ok: true, results, ...(await listOutputs()) };
}

async function toggleOne(name, start) {
  const config = loadConfig();
  try {
    await vendor(config.obs, start ? "start_output" : "stop_output", { output: name });
    if (start) await waitActive(config.obs, name, 10000);
    return { ok: true, ...(await listOutputs()) };
  } catch (err) {
    return { ok: false, reason: err.message, ...(await listOutputs()) };
  }
}

module.exports = { listOutputs, setSelected, startSelected, stopSelected, toggleOne };
