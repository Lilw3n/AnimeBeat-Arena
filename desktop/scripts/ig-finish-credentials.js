const { app, BrowserWindow, session } = require("electron");
const path = require("path");
const os = require("os");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function js(win, code) {
  return win.webContents.executeJavaScript(code, true);
}

async function main() {
  app.setPath("userData", path.join(os.homedir(), "AppData/Roaming/animebeat-live-hub"));
  await app.whenReady();
  const { loadConfig, saveConfig } = require("../stream/config");

  const win = new BrowserWindow({
    width: 1200,
    height: 860,
    webPreferences: {
      session: session.fromPartition("persist:instagram-live"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await win.loadURL("https://www.instagram.com/");
  await sleep(4000);

  // Full nav again
  await js(win, `(() => {
    const nodes=[...document.querySelectorAll("a,button,div[role='button'],span")];
    const creer=nodes.find(el => (el.innerText||"").replace(/\\s+/g," ").trim().toLowerCase()==="créer");
    if (creer) creer.click();
  })()`);
  await sleep(1500);
  await js(win, `(() => {
    const nodes=[...document.querySelectorAll("button,div[role='button'],span,div")];
    const live=nodes.find(el => (el.innerText||"").replace(/\\s+/g," ").trim().toLowerCase()==="vidéo en direct");
    if (live) live.click();
  })()`);
  await sleep(2500);

  const title = "Test Live AnimeBeat IG";
  const filled = await js(
    win,
    `(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const title = ${JSON.stringify(title)};
    const inputs = [...document.querySelectorAll("input,textarea")];
    let titleEl = inputs.find(el => /titre|title|ajoutez un titre/i.test((el.placeholder||"")+" "+(el.getAttribute("aria-label")||"")));
    if (!titleEl) return { ok:false, reason:"no title input", inputs: inputs.map(i=>i.placeholder) };
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set
      || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")?.set;
    titleEl.focus();
    if (setter) setter.call(titleEl, title); else titleEl.value = title;
    titleEl.dispatchEvent(new Event("input",{bubbles:true}));
    titleEl.dispatchEvent(new Event("change",{bubbles:true}));
    await sleep(400);

    // Audience Public
    const aud = [...document.querySelectorAll("button,div[role='button'],span,div")].find(el => {
      const t=(el.innerText||"").replace(/\\s+/g," ").trim().toLowerCase();
      return t==="public" || t.includes("public");
    });
    if (aud) aud.click();
    await sleep(500);

    // Suivant — plusieurs stratégies
    let clicked = null;
    for (const el of document.querySelectorAll("button, div[role='button']")) {
      const t=(el.innerText||"").replace(/\\s+/g," ").trim().toLowerCase();
      if (t==="suivant" || t==="next" || t==="continuer") {
        el.click();
        clicked = t;
        break;
      }
    }
    if (!clicked) {
      // bouton primaire bleu souvent sans texte clair: dernier button enabled dans dialog
      const dialog = document.querySelector("[role='dialog']") || document.body;
      const buttons = [...dialog.querySelectorAll("button, div[role='button']")].filter(el => {
        const dis = el.getAttribute("aria-disabled")==="true" || el.disabled;
        return !dis && el.offsetParent !== null;
      });
      const primary = buttons.reverse().find(el => {
        const t=(el.innerText||"").trim().toLowerCase();
        return /suivant|next|continuer|continue/.test(t) || t.length===0;
      }) || buttons[buttons.length-1];
      if (primary) { primary.click(); clicked = (primary.innerText||"primary").slice(0,30); }
    }
    await sleep(2500);
    return { ok:true, clicked, titleVal: titleEl.value };
  })()`,
  );
  console.log("fill", filled);

  // Poll credentials
  let creds = null;
  for (let i = 0; i < 30; i++) {
    await sleep(800);
    creds = await js(
      win,
      `(() => {
      const inputs=[...document.querySelectorAll("input,textarea")];
      let rtmpUrl="", streamKey="";
      for (const el of inputs) {
        const v=(el.value||"").trim();
        if (/^rtmps?:\\/\\//i.test(v)) rtmpUrl=v.replace(/\\/$/,"");
        else if (v.length>40 && !/^https?:/i.test(v) && !/\\s/.test(v)) streamKey=v;
      }
      const body=document.body?.innerText||"";
      if (!rtmpUrl) { const m=body.match(/rtmps?:\\/\\/[^\\s]+/i); if(m) rtmpUrl=m[0]; }
      const ph = inputs.map(el => el.placeholder||"");
      return { rtmpUrl, streamKey, ph, bodyHasKey: /clé de stream|stream key|url du stream/i.test(body), body: body.slice(0,300) };
    })()`,
    );
    console.log("poll", i, { hasUrl: !!creds.rtmpUrl, hasKey: !!creds.streamKey, ph: creds.ph, bodyHasKey: creds.bodyHasKey });
    if (creds.rtmpUrl && creds.streamKey) break;
  }

  if (creds?.rtmpUrl && creds?.streamKey) {
    const c = loadConfig();
    c.platforms.instagram = {
      ...(c.platforms.instagram || {}),
      enabled: true,
      rtmpUrl: creds.rtmpUrl,
      streamKey: creds.streamKey,
      lastPreparedAt: Date.now(),
      lastTitle: title,
    };
    saveConfig(c);
    console.log("SUCCESS", { rtmpUrl: creds.rtmpUrl, streamKey: creds.streamKey.slice(0, 24) + "…" });
  } else {
    console.log("FAIL_CREDS", creds);
  }
  console.log("DONE");
}

main().catch((e) => {
  console.error(e);
  app.exit(1);
});
