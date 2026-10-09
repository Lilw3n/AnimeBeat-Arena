/**
 * Parcours IG: home → Créer → Live → dump + tente titre/clé
 */
const { app, BrowserWindow, session } = require("electron");
const path = require("path");
const os = require("os");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function js(win, code) {
  return win.webContents.executeJavaScript(code, true);
}

async function dump(win, label) {
  const info = await js(
    win,
    `(() => ({
    url: location.href,
    loggedIn: !/se connecter à instagram/i.test(document.body?.innerText||"") && !location.href.includes("/accounts/login"),
    bodyHead: (document.body?.innerText||"").slice(0,400),
    createLike: [...document.querySelectorAll("a,button,div[role='button'],span")]
      .map(el => (el.innerText||el.getAttribute("aria-label")||"").replace(/\\s+/g," ").trim())
      .filter(t => t && t.length < 60)
      .filter((t,i,a)=>a.indexOf(t)===i)
      .filter(t => /créer|create|publication|live|direct|story|reel|vidéo|rtmp|logiciel|stream|diffusion/i.test(t))
      .slice(0,50),
    inputs: [...document.querySelectorAll("input,textarea")].map(el=>({
      ph: el.placeholder||"", aria: el.getAttribute("aria-label")||"", v:(el.value||"").slice(0,48)
    })),
  }))()`,
  );
  console.log("\n##", label);
  console.log(JSON.stringify(info, null, 2));
  return info;
}

async function main() {
  app.setPath("userData", path.join(os.homedir(), "AppData/Roaming/animebeat-live-hub"));
  await app.whenReady();

  const win = new BrowserWindow({
    width: 1200,
    height: 860,
    title: "IG Live flow",
    webPreferences: {
      session: session.fromPartition("persist:instagram-live"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await win.loadURL("https://www.instagram.com/");
  await sleep(5000);
  let d = await dump(win, "home");

  if (!d.loggedIn) {
    console.log("LOGIN_REQUIRED — connecte-toi, j'attends jusqu'à 3 min…");
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      await sleep(3000);
      d = await dump(win, "wait-login");
      if (d.loggedIn) break;
    }
    if (!d.loggedIn) {
      console.log("FAIL login");
      return;
    }
  }

  // Click Créer / Nouvelle publication
  const created = await js(
    win,
    `(() => {
    const nodes = [...document.querySelectorAll("a,button,div[role='button'],span")];
    for (const el of nodes) {
      const c = (el.innerText||"").replace(/\\s+/g,"").toLowerCase();
      if (c.includes("nouvellepublication") || c.includes("newpost")) { el.click(); return "nouvellepublication"; }
    }
    for (const el of nodes) {
      const t = (el.innerText||"").replace(/\\s+/g," ").trim().toLowerCase();
      if (t === "créer" || t === "create") { el.click(); return t; }
    }
    for (const el of nodes) {
      const t = (el.innerText||el.getAttribute("aria-label")||"").toLowerCase();
      if (t.includes("nouvelle publication") || t.includes("new post") || t.includes("créer")) { el.click(); return t.slice(0,40); }
    }
    return null;
  })()`,
  );
  console.log("click create:", created);
  await sleep(2000);
  await dump(win, "after-create");

  // Click Live option (exact first)
  const live = await js(
    win,
    `(() => {
    const nodes = [...document.querySelectorAll("button,div[role='button'],span,div,a")];
    const want = ["vidéo en direct","live video","diffusion en direct","live","en direct"];
    for (const w of want) {
      for (const el of nodes) {
        const t = (el.innerText||"").replace(/\\s+/g," ").trim().toLowerCase();
        if (t === w) { el.click(); return t; }
      }
    }
    for (const el of nodes) {
      const t = (el.innerText||"").replace(/\\s+/g," ").trim().toLowerCase();
      if (t.includes("vidéo en direct") || t.includes("live video")) { el.click(); return t; }
    }
    return null;
  })()`,
  );
  console.log("click live:", live);
  await sleep(3000);
  await dump(win, "after-live");

  // software / rtmp choice
  await js(
    win,
    `(() => {
    const nodes = [...document.querySelectorAll("button,div[role='button'],span,div")];
    for (const el of nodes) {
      const t = (el.innerText||"").toLowerCase();
      if (/logiciel de streaming|streaming software|broadcast|rtmp|obs|utiliser un logiciel/.test(t)) {
        el.click(); return t.slice(0,50);
      }
    }
    return null;
  })()`,
  );
  await sleep(2000);
  const final = await dump(win, "after-software");

  // If title input exists, fill + next via producer module path
  if (final.inputs?.some((i) => /titre|title/i.test(i.ph + i.aria))) {
    console.log("TITLE_FIELD_FOUND — calling prepareLive");
    const instagram = require("../stream/platforms/instagram");
    // reuse same window? prepareLive opens its own — instead fill here
    await js(
      win,
      `(async () => {
      const title = "Test Live AnimeBeat IG";
      const inputs = [...document.querySelectorAll("input,textarea")];
      const titleEl = inputs.find(el => /titre|title/i.test((el.placeholder||"")+" "+(el.getAttribute("aria-label")||"")));
      if (!titleEl) return {ok:false};
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set
        || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")?.set;
      if (setter) setter.call(titleEl, title); else titleEl.value = title;
      titleEl.dispatchEvent(new Event("input",{bubbles:true}));
      const btn = [...document.querySelectorAll("button,div[role='button']")].find(el => {
        const t=(el.innerText||"").trim().toLowerCase();
        return t==="suivant"||t==="next";
      });
      if (btn) btn.click();
      return {ok:true};
    })()`,
    );
    await sleep(3000);
    await dump(win, "after-title-next");
  }

  console.log("FLOW_DONE — fenêtre gardée ouverte");
}

main().catch((e) => {
  console.error(e);
  app.exit(1);
});
