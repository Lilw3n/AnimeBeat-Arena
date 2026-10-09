/** Dump UI Instagram + Facebook pour debug automation */
const { app, BrowserWindow, session } = require("electron");
const path = require("path");
const os = require("os");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function dump(win, label) {
  const info = await win.webContents.executeJavaScript(`(() => {
    const buttons = [...document.querySelectorAll("button, div[role='button'], a[role='button'], a")]
      .map((el) => ({
        t: (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 60),
        aria: (el.getAttribute("aria-label") || "").slice(0, 60),
        href: (el.getAttribute("href") || "").slice(0, 80),
      }))
      .filter((x) => x.t || x.aria)
      .slice(0, 40);
    const inputs = [...document.querySelectorAll("input, textarea")].map((el) => ({
      ph: el.placeholder || "",
      aria: el.getAttribute("aria-label") || "",
      type: el.type || el.tagName,
      val: (el.value || "").slice(0, 40),
    }));
    return {
      url: location.href,
      title: document.title,
      body: (document.body?.innerText || "").slice(0, 500),
      buttons,
      inputs,
    };
  })()`);
  console.log("\n========", label, "========");
  console.log(JSON.stringify(info, null, 2));
  return info;
}

async function main() {
  app.setPath("userData", path.join(os.homedir(), "AppData/Roaming/animebeat-live-hub"));
  await app.whenReady();

  const ig = new BrowserWindow({
    width: 1100,
    height: 800,
    webPreferences: {
      session: session.fromPartition("persist:instagram-live"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await ig.loadURL("https://www.instagram.com/");
  await sleep(5000);
  await dump(ig, "IG home");

  // try open create
  await ig.webContents.executeJavaScript(`(() => {
    const el = [...document.querySelectorAll("[aria-label], a, button, div[role='button']")].find((e) => {
      const a = ((e.getAttribute("aria-label")||"") + " " + (e.innerText||"")).toLowerCase();
      return /nouvelle publication|new post|créer|create/.test(a);
    });
    if (el) el.click();
    return Boolean(el);
  })()`);
  await sleep(2000);
  await dump(ig, "IG after create click");

  await ig.webContents.executeJavaScript(`(() => {
    const el = [...document.querySelectorAll("button, div[role='button'], span, a")].find((e) => {
      const t = ((e.innerText||"") + " " + (e.getAttribute("aria-label")||"")).toLowerCase();
      return /vidéo en direct|live video|live/.test(t) && t.length < 40;
    });
    if (el) el.click();
    return el ? (el.innerText||el.getAttribute("aria-label")||"").slice(0,40) : null;
  })()`);
  await sleep(3000);
  await dump(ig, "IG after live click");

  const fb = new BrowserWindow({
    width: 1200,
    height: 860,
    webPreferences: {
      session: session.fromPartition("persist:facebook-live"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await fb.loadURL("https://www.facebook.com/profile.php?id=100036165385264");
  await sleep(6000);
  await dump(fb, "FB page");

  await fb.loadURL("https://www.facebook.com/live/producer");
  await sleep(6000);
  await dump(fb, "FB live/producer");

  console.log("\nDump OK — ferme les fenêtres pour quitter.");
}

main().catch((e) => {
  console.error(e);
  app.exit(1);
});
