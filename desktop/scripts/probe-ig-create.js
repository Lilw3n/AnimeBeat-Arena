const { app, BrowserWindow, session } = require("electron");
const path = require("path");
const os = require("os");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function dump(win, label) {
  const info = await win.webContents.executeJavaScript(`(() => ({
    url: location.href,
    body: (document.body?.innerText||"").slice(0,800),
    menu: [...document.querySelectorAll("button, div[role='button'], span, a, div[role='dialog'] *")]
      .map(el => (el.innerText||el.getAttribute("aria-label")||"").replace(/\\s+/g," ").trim())
      .filter(t => t && t.length < 50)
      .filter((t,i,a) => a.indexOf(t)===i)
      .filter(t => /live|direct|créer|create|publication|story|reel|rtmp|logiciel|stream|vidéo/i.test(t))
      .slice(0,40),
    inputs: [...document.querySelectorAll("input,textarea")].map(el => ({
      ph: el.placeholder, aria: el.getAttribute("aria-label"), v:(el.value||"").slice(0,30)
    }))
  }))()`);
  console.log("\n##", label);
  console.log(JSON.stringify(info, null, 2));
}

async function main() {
  app.setPath("userData", path.join(os.homedir(), "AppData/Roaming/animebeat-live-hub"));
  await app.whenReady();
  const win = new BrowserWindow({
    width: 1100,
    height: 820,
    webPreferences: {
      session: session.fromPartition("persist:instagram-live"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await win.loadURL("https://www.instagram.com/");
  await sleep(4000);
  await dump(win, "home");

  await win.webContents.executeJavaScript(`(() => {
    const el = [...document.querySelectorAll("a,button,div[role='button'],span")].find(e => {
      const c = (e.innerText||"").replace(/\\s+/g,"").toLowerCase();
      return c.includes("nouvellepublication") || c.includes("newpost");
    });
    if (el) el.click();
    return !!el;
  })()`);
  await sleep(2000);
  await dump(win, "after-create");

  // click each live-like option
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const opts = [...document.querySelectorAll("button, div[role='button'], span, div")];
    for (const el of opts) {
      const t = (el.innerText||"").replace(/\\s+/g," ").trim().toLowerCase();
      if (t === "vidéo en direct" || t === "live video" || t === "live" || t === "en direct") {
        el.click();
        return t;
      }
    }
    for (const el of opts) {
      const t = (el.innerText||"").replace(/\\s+/g," ").trim().toLowerCase();
      if (t.includes("vidéo en direct") || t.includes("live video")) {
        el.click();
        return t;
      }
    }
    return null;
  })()`);
  console.log("clicked live option:", clicked);
  await sleep(3000);
  await dump(win, "after-live");

  // try professional dashboard
  await win.webContents.executeJavaScript(`(() => {
    const el = [...document.querySelectorAll("a,button,div[role='button'],span")].find(e => {
      const t = ((e.innerText||"")+(e.getAttribute("aria-label")||"")).toLowerCase();
      return t.includes("tableau de bord professionnel") || t.includes("professional dashboard");
    });
    if (el) el.click();
    return !!el;
  })()`);
  await sleep(3000);
  await dump(win, "pro-dashboard");

  console.log("DONE");
}

main().catch((e) => {
  console.error(e);
  app.exit(1);
});
