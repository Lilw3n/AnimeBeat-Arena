/**
 * Injecte des actions Streamer.bot pour titre/jeu (Execute C# Code).
 * Ferme Streamer.bot avant d'exécuter, puis relance-le.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const ACTIONS_PATH = path.join(
  os.homedir(),
  "Downloads/Streamer.bot-x64-0.2.8/data/actions.json",
);

const CSHARP_SOURCE = `using System;

public class CPHInline
{
    public bool Execute()
    {
        string title = "";
        string game = "";
        CPH.TryGetArg("title", out title);
        CPH.TryGetArg("game", out game);

        if (!string.IsNullOrWhiteSpace(title))
        {
            CPH.SetChannelTitle(title);
            CPH.LogInfo("[AnimeBeat] Title => " + title);
        }

        if (!string.IsNullOrWhiteSpace(game))
        {
            CPH.SetChannelGame(game);
            CPH.LogInfo("[AnimeBeat] Game => " + game);
        }

        return true;
    }
}
`;

const REFERENCES = [
  "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\mscorlib.dll",
  "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\System.dll",
  "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\System.Core.dll",
  ".\\Streamer.bot.Common.dll",
  ".\\Streamer.bot.Plugin.Interface.dll",
];

function guid() {
  return crypto.randomUUID();
}

function makeCsharpSubAction(index = 0) {
  return {
    name: "AnimeBeat apply title/game",
    description: "Injected by AnimeBeat Live Hub",
    references: REFERENCES,
    byteCode: Buffer.from(CSHARP_SOURCE, "utf8").toString("base64"),
    precompile: true,
    delayStart: false,
    saveResultToVariable: false,
    saveToVariable: "",
    id: guid(),
    weight: 0,
    type: 99999,
    parentId: null,
    enabled: true,
    index,
  };
}

function makeAction(name, id) {
  return {
    id,
    queue: null,
    enabled: true,
    excludeFromHistory: false,
    excludeFromPending: false,
    name,
    group: "AnimeBeat",
    alwaysRun: false,
    randomAction: false,
    concurrent: false,
    triggers: [],
    subActions: [makeCsharpSubAction(0)],
    collapsedGroups: [],
  };
}

function install() {
  if (!fs.existsSync(ACTIONS_PATH)) {
    throw new Error(`actions.json introuvable: ${ACTIONS_PATH}`);
  }

  let text = fs.readFileSync(ACTIONS_PATH, "utf8");
  const bom = text.charCodeAt(0) === 0xfeff;
  if (bom) text = text.slice(1);
  const data = JSON.parse(text);

  // Streamer.bot root shape varies; keep array of top-level actions
  const rootKey = Array.isArray(data)
    ? null
    : Array.isArray(data.actions)
      ? "actions"
      : null;

  const list = rootKey ? data.actions : Array.isArray(data) ? data : null;
  if (!list) {
    throw new Error("Format actions.json non reconnu");
  }

  const backup = ACTIONS_PATH + `.bak-animebeat-${Date.now()}`;
  fs.copyFileSync(ACTIONS_PATH, backup);

  const titleId = "8f3c2a10-5b6d-4e1a-9c2f-000000000001";
  const gameId = "8f3c2a10-5b6d-4e1a-9c2f-000000000002";
  const bothId = "8f3c2a10-5b6d-4e1a-9c2f-000000000003";

  const wanted = [
    makeAction("AnimeBeat Set Title", titleId),
    makeAction("AnimeBeat Set Game", gameId),
    makeAction("AnimeBeat Set Title Game", bothId),
  ];

  for (const action of wanted) {
    const idx = list.findIndex((a) => a && a.name === action.name);
    if (idx >= 0) list[idx] = { ...list[idx], ...action, id: list[idx].id || action.id };
    else list.push(action);
  }

  // Patch empty ChangeGameName to actually work
  const changeGame = list.find((a) => a && a.name === "ChangeGameName");
  if (changeGame && (!changeGame.subActions || changeGame.subActions.length === 0)) {
    changeGame.subActions = [makeCsharpSubAction(0)];
    changeGame.group = changeGame.group || "Stream";
  }

  const out = rootKey ? { ...data, actions: list } : list;
  const json = JSON.stringify(out, null, 2);
  fs.writeFileSync(ACTIONS_PATH, bom ? "\uFEFF" + json : json, "utf8");

  return {
    ok: true,
    backup,
    actionsPath: ACTIONS_PATH,
    installed: wanted.map((a) => a.name),
    patchedChangeGameName: Boolean(changeGame),
  };
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(install(), null, 2));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = { install, ACTIONS_PATH };
