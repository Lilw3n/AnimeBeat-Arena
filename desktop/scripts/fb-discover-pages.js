/**
 * Liste les Pages Facebook admin (pas le profil perso).
 * Usage: electron scripts/fb-discover-pages.js
 */
const { app, BrowserWindow } = require("electron");
const path = require("path");
const os = require("os");

async function main() {
  app.setPath("userData", path.join(os.homedir(), "AppData/Roaming/animebeat-live-hub"));
  await app.whenReady();

  const { getHardenedSession } = require("../stream/persist-session");
  const ses = getHardenedSession("persist:facebook-live");
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    title: "FB discover Pages",
    webPreferences: {
      session: ses,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const urls = [
    "https://www.facebook.com/pages/?category=your_pages",
    "https://business.facebook.com/latest/settings/pages",
    "https://www.facebook.com/bookmarks/pages",
  ];

  for (const url of urls) {
    console.log("\n===", url, "===");
    try {
      await win.loadURL(url);
      await new Promise((r) => setTimeout(r, 5000));
      const info = await win.webContents.executeJavaScript(`(() => {
        const body = (document.body?.innerText || "").slice(0, 800);
        const links = [...document.querySelectorAll("a[href]")]
          .map((a) => ({
            href: a.href,
            t: (a.innerText || a.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim().slice(0, 80),
          }))
          .filter((x) =>
            /facebook\\.com\\/(pages\\/|profile\\.php\\?id=|people\\/)|business\\.facebook\\.com|page_id=|asset_id=/i.test(x.href)
            || /page|gérer|manage|passer à/i.test(x.t)
          )
          .slice(0, 40);
        const ids = [...new Set(
          links
            .map((l) => {
              const m =
                l.href.match(/[?&]id=(\\d{6,})/) ||
                l.href.match(/page_id=(\\d{6,})/) ||
                l.href.match(/asset_id=(\\d{6,})/) ||
                l.href.match(/facebook\\.com\\/(\\d{6,})\\/?/) ||
                l.href.match(/people\\/[^/]+\\/(\\d{6,})/);
              return m ? m[1] : null;
            })
            .filter(Boolean),
        )];
        return { url: location.href, title: document.title, ids, links, body };
      })()`);
      console.log(JSON.stringify(info, null, 2));
    } catch (e) {
      console.error(url, e.message);
    }
  }

  console.log("\nFerme la fenêtre ou Ctrl+C");
  setTimeout(() => app.exit(0), 15000);
}

main().catch((e) => {
  console.error(e);
  app.exit(1);
});
