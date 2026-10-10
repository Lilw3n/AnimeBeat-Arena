#!/usr/bin/env node
/**
 * Builds and applies the Instagram Live chat capture patch for Social Stream Ninja.
 * Fixes broadcast_id discovery, REST recoverability, and DOM fallback.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");

const SRC_DIR = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData/Local"),
  "Programs/socialstream/resources/app.asar.unpacked/resources/social_stream_fallback/main/sources"
);
const REPO_PATCH_DIR = __dirname;

const REPLACEMENT = `function getLiveBroadcastId(){
		try {
			if (liveRestState.hookedBroadcastId){ return liveRestState.hookedBroadcastId; }

			var search = window.location.search || "";
			var hash = window.location.hash || "";
			var m = search.match(/[?&]broadcast_id=(\\d+)/i) || search.match(/[?&]broadcastId=(\\d+)/i);
			if (m){ return m[1]; }
			m = hash.match(/broadcast_id[=:](\\d+)/i) || hash.match(/broadcastId[=:](\\d+)/i);
			if (m){ return m[1]; }

			var fromPerf = extractBroadcastIdFromPerf();
			if (fromPerf){ return fromPerf; }

			var blobs = [];
			try {
				var scripts = document.querySelectorAll("script");
				for (var i = 0; i < scripts.length; i++){
					var text = scripts[i].textContent || "";
					if (text && text.length < 2500000){ blobs.push(text); }
				}
			} catch(e){}
			try {
				var html = document.documentElement && document.documentElement.innerHTML;
				if (html && html.length){ blobs.push(html.slice(0, 1500000)); }
			} catch(e){}

			for (var b = 0; b < blobs.length; b++){
				var id = extractBroadcastIdFromText(blobs[b]);
				if (id){ return id; }
			}
		} catch(e){}
		return null;
	}

	function extractBroadcastIdFromText(text){
		if (!text){ return null; }
		var patterns = [
			/"broadcast_id"\\s*:\\s*"?(\\d{10,})"?/i,
			/"broadcastId"\\s*:\\s*"?(\\d{10,})"?/i,
			/broadcast_id[=:](\\d{10,})/i,
			/\\/api\\/v1\\/live\\/(\\d{10,})\\//i,
			/"live_broadcast_id"\\s*:\\s*"?(\\d{10,})"?/i,
			/"pk"\\s*:\\s*"?(\\d{14,})"?[\\s\\S]{0,80}"broadcast_status"/i,
			/"broadcast_status"\\s*:\\s*"[^"]*"[\\s\\S]{0,120}"id"\\s*:\\s*"?(\\d{10,})"?/i
		];
		for (var i = 0; i < patterns.length; i++){
			var m = text.match(patterns[i]);
			if (m && m[1]){ return m[1]; }
		}
		return null;
	}

	function extractBroadcastIdFromPerf(){
		try {
			if (!window.performance || !performance.getEntriesByType){ return null; }
			var entries = performance.getEntriesByType("resource") || [];
			for (var i = entries.length - 1; i >= 0; i--){
				var name = (entries[i] && entries[i].name) || "";
				var m = name.match(/\\/api\\/v1\\/live\\/(\\d{10,})\\//);
				if (m){ return m[1]; }
			}
		} catch(e){}
		return null;
	}

	function rememberHookedBroadcastId(id){
		if (!id){ return; }
		id = String(id);
		if (!/^\\d{10,}$/.test(id)){ return; }
		liveRestState.hookedBroadcastId = id;
	}

	function installLiveNetworkHooks(){
		if (liveRestState.hooksInstalled){ return; }
		liveRestState.hooksInstalled = true;
		try {
			var origFetch = window.fetch;
			if (typeof origFetch === "function"){
				window.fetch = function(){
					var args = arguments;
					var input = args[0];
					try {
						var url = (typeof input === "string") ? input : (input && input.url) || "";
						var m = String(url).match(/\\/api\\/v1\\/live\\/(\\d{10,})\\//);
						if (m){ rememberHookedBroadcastId(m[1]); }
					} catch(e){}
					return origFetch.apply(this, args).then(function(resp){
						try {
							var u = resp && resp.url ? String(resp.url) : "";
							var m2 = u.match(/\\/api\\/v1\\/live\\/(\\d{10,})\\//);
							if (m2){ rememberHookedBroadcastId(m2[1]); }
						} catch(e){}
						return resp;
					});
				};
			}
		} catch(e){}
		try {
			var XO = window.XMLHttpRequest;
			if (!XO || !XO.prototype){ return; }
			var open = XO.prototype.open;
			XO.prototype.open = function(method, url){
				try {
					var m = String(url || "").match(/\\/api\\/v1\\/live\\/(\\d{10,})\\//);
					if (m){ rememberHookedBroadcastId(m[1]); }
				} catch(e){}
				return open.apply(this, arguments);
			};
		} catch(e){}
	}

	function getLivePathUsername(){
		try {
			var path = window.location.pathname || "";
			var m = path.match(/^\\/([^\\/]+)\\/live\\/?/i) || path.match(/^\\/stories\\/([^\\/]+)\\//i);
			if (!m){ return ""; }
			var user = decodeURIComponent(m[1] || "");
			if (!user || user === "accounts" || user === "reel" || user === "reels"){ return ""; }
			return user;
		} catch(e){}
		return "";
	}

	function extractBroadcastIdFromJson(json){
		if (!json || typeof json !== "object"){ return null; }
		try {
			if (json.broadcast_id){ return String(json.broadcast_id); }
			if (json.broadcastId){ return String(json.broadcastId); }
			if (json.id && String(json.id).length >= 10 && (json.broadcast_status || json.dash_playback_url || json.rtmp_playback_url)){
				return String(json.id);
			}
			if (json.broadcast && json.broadcast.id){ return String(json.broadcast.id); }
			if (json.data && json.data.broadcast_id){ return String(json.data.broadcast_id); }
			if (json.user && json.user.broadcast_id){ return String(json.user.broadcast_id); }
			var text = JSON.stringify(json);
			return extractBroadcastIdFromText(text);
		} catch(e){}
		return null;
	}

	function discoverBroadcastIdAsync(){
		if (liveRestState.discovering){ return; }
		if (liveRestState.discoverCooldownUntil && Date.now() < liveRestState.discoverCooldownUntil){ return; }
		var username = getLivePathUsername();
		if (!username){ return; }
		liveRestState.discovering = true;
		liveRestState.discoverCooldownUntil = Date.now() + 8000;

		var headers = igApiHeaders();
		delete headers["Content-Type"];

		function finish(id){
			liveRestState.discovering = false;
			if (id){
				rememberHookedBroadcastId(id);
				syncLiveRest();
			}
		}

		function tryInfoByUserId(userId){
			if (!userId){ return Promise.resolve(null); }
			var urls = [
				"/api/v1/live/" + userId + "/info_by_user_id/",
				"/api/v1/live/web_info/?target_user_id=" + encodeURIComponent(userId)
			];
			var chain = Promise.resolve(null);
			urls.forEach(function(url){
				chain = chain.then(function(found){
					if (found){ return found; }
					return fetch(url, { headers: headers, credentials: "same-origin" })
						.then(function(resp){ return resp.ok ? resp.json() : null; })
						.then(function(json){ return extractBroadcastIdFromJson(json); })
						.catch(function(){ return null; });
				});
			});
			return chain;
		}

		fetch("/api/v1/users/web_profile_info/?username=" + encodeURIComponent(username), {
			headers: headers,
			credentials: "same-origin"
		})
			.then(function(resp){ return resp.ok ? resp.json() : null; })
			.then(function(json){
				var userId = null;
				try {
					userId = json && json.data && json.data.user && (json.data.user.id || json.data.user.pk);
				} catch(e){}
				if (!userId){
					try { userId = getIgUserId(); } catch(e){}
				}
				return tryInfoByUserId(userId);
			})
			.then(function(id){ finish(id); })
			.catch(function(){ finish(null); });
	}

	function getIgCsrfToken(){
		try {
			var m = (document.cookie || "").match(/(?:^|;\\s*)csrftoken=([^;]+)/);
			return m ? decodeURIComponent(m[1]) : "";
		} catch(e){}
		return "";
	}

	function getIgUserId(){
		try {
			var m = (document.cookie || "").match(/(?:^|;\\s*)ds_user_id=(\\d+)/);
			return m ? m[1] : "";
		} catch(e){}
		return "";
	}

	function igApiHeaders(){
		return {
			"X-IG-App-ID": "936619743392459",
			"X-CSRFToken": getIgCsrfToken(),
			"X-ASBD-ID": "359341",
			"X-Requested-With": "XMLHttpRequest",
			"Content-Type": "application/x-www-form-urlencoded"
		};
	}

	function liveRestIsActive(){
		return !!(liveRestState.broadcastId && liveRestState.commentTimer && liveRestState.failures < 5);
	}

	function markLiveRestFailure(){
		liveRestState.failures++;
		if (liveRestState.failures >= 5){
			// Hard fail: drop the id so rediscovery / network hooks can recover.
			stopLiveRestPolling();
			liveRestState.broadcastId = null;
			liveRestState.hookedBroadcastId = null;
			liveRestState.failures = 0;
			liveRestState.discoverCooldownUntil = Date.now() + 5000;
		}
	}

	function stopLiveRestPolling(){
		if (liveRestState.commentTimer){ clearInterval(liveRestState.commentTimer); liveRestState.commentTimer = null; }
		if (liveRestState.viewerTimer){ clearInterval(liveRestState.viewerTimer); liveRestState.viewerTimer = null; }
	}

	function seenLiveRestComment(pk){
		if (!pk){ return true; }
		if (liveRestState.seenCommentIds[pk]){ return true; }
		liveRestState.seenCommentIds[pk] = true;
		liveRestState.seenCommentOrder.push(pk);
		while (liveRestState.seenCommentOrder.length > 300){
			var oldest = liveRestState.seenCommentOrder.shift();
			delete liveRestState.seenCommentIds[oldest];
		}
		return false;
	}

	function emitLiveRestComment(comment){
		try {
			if (!comment || !comment.user){ return; }
			var commentId = comment.pk || comment.strong_id__;
			if (seenLiveRestComment(commentId)){ return; }
			var chatname = ((comment.user.username || "") + "").trim();
			var chatmessage = ((comment.text || "") + "").trim();
			if (!chatname || !chatmessage){ return; }
			var data = {};
			data.chatname = escapeHtml(chatname);
			data.chatbadges = "";
			data.backgroundColor = "";
			data.textColor = "";
			data.chatmessage = escapeHtml(chatmessage);
			data.chatimg = comment.user.profile_pic_url || "";
			data.hasDonation = "";
			data.membership = "";
			data.contentimg = "";
			data.event = false;
			data.textonly = settings.textonlymode || false;
			data.type = "instagramlive";
			if (sendOut(data, null, null, "instagram-live-rest::" + commentId)){
				rememberLiveRestDomComment(data.chatname, data.chatmessage);
			}
		} catch(e){}
	}

	function pollLiveCommentsRest(){
		if (!isExtensionOn || !liveRestState.broadcastId){ return; }
		var url = "/api/v1/live/" + liveRestState.broadcastId + "/get_comment/?last_comment_ts=" + (liveRestState.lastCommentTs || 0) + "&num_comments_requested=50";
		fetch(url, { headers: igApiHeaders(), credentials: "same-origin" })
			.then(function(resp){
				if (!resp.ok){ throw new Error("status " + resp.status); }
				return resp.json();
			})
			.then(function(json){
				if (!json || json.status !== "ok"){ markLiveRestFailure(); return; }
				liveRestState.failures = 0;
				var comments = Array.isArray(json.comments) ? json.comments : [];
				var systems = Array.isArray(json.system_comments) ? json.system_comments : [];
				var all = comments.concat(systems);
				all.sort(function(a, b){ return ((a && a.created_at) || 0) - ((b && b.created_at) || 0); });
				all.forEach(emitLiveRestComment);
				all.forEach(function(c){
					if (c && c.created_at && c.created_at > liveRestState.lastCommentTs){
						liveRestState.lastCommentTs = c.created_at;
					}
				});
			})
			.catch(function(){ markLiveRestFailure(); });
	}

	function pollLiveViewersRest(){
		if (!isExtensionOn || !liveRestState.broadcastId){ return; }
		if (!(settings.showviewercount || settings.hypemode)){ return; }
		fetch("/api/v1/live/" + liveRestState.broadcastId + "/heartbeat_and_get_viewer_count/", {
			method: "POST",
			headers: igApiHeaders(),
			credentials: "same-origin"
		})
			.then(function(resp){
				if (!resp.ok){ throw new Error("status " + resp.status); }
				return resp.json();
			})
			.then(function(json){
				if (!json || json.status !== "ok"){ return; }
				if (typeof json.viewer_count === "number" && json.viewer_count !== liveRestState.lastViewerCount){
					liveRestState.lastViewerCount = json.viewer_count;
					pushMessage({ type: "instagramlive", event: "viewer_update", meta: json.viewer_count });
				}
				if (json.broadcast_status && json.broadcast_status !== "live" && json.broadcast_status !== "active"){
					pushMessage({ type: "instagramlive", event: "stream_offline" });
					stopLiveRestPolling();
					liveRestState.broadcastId = null;
				}
			})
			.catch(function(){});
	}

	function syncLiveRest(){
		installLiveNetworkHooks();
		if (!isLivePage()){
			if (liveRestState.broadcastId){
				stopLiveRestPolling();
				liveRestState.broadcastId = null;
			}
			return;
		}
		var id = getLiveBroadcastId();
		if (!id){
			discoverBroadcastIdAsync();
			return;
		}
		if (liveRestState.broadcastId !== id){
			stopLiveRestPolling();
			liveRestState.broadcastId = id;
			// Start slightly in the past so the first poll can catch comments that
			// arrived during the live setup handoff (clock skew / late join).
			liveRestState.lastCommentTs = Math.max(0, Math.floor(Date.now() / 1000) - 30);
			liveRestState.lastViewerCount = null;
			liveRestState.failures = 0;
			liveRestState.pendingDomCommentFingerprints = [];
			liveRestState.commentTimer = setInterval(pollLiveCommentsRest, 2000);
			liveRestState.viewerTimer = setInterval(pollLiveViewersRest, 5000);
			pushMessage({ type: "instagramlive", event: "stream_online" });
			pollLiveCommentsRest();
			pollLiveViewersRest();
		}
	}

	`;

function patchFile(filePath) {
  let t = fs.readFileSync(filePath, "utf8");
  const start = t.indexOf("function getLiveBroadcastId(){");
  const end = t.indexOf(
    "// ---------- Instagram notifications (news inbox) capture ----------"
  );
  if (start < 0 || end < 0) {
    throw new Error("bounds not found in " + filePath);
  }
  t = t.slice(0, start) + REPLACEMENT + t.slice(end);

  t = t.replace(
    /var liveRestState = \{[\s\S]*?pendingDomCommentFingerprints: \[\]\s*\};/,
    `var liveRestState = {
		broadcastId: null,
		hookedBroadcastId: null,
		hooksInstalled: false,
		discovering: false,
		discoverCooldownUntil: 0,
		lastCommentTs: 0,
		lastViewerCount: null,
		commentTimer: null,
		viewerTimer: null,
		failures: 0,
		seenCommentIds: {},
		seenCommentOrder: [],
		pendingDomCommentFingerprints: []
	};`
  );

  t = t.replace(
    `var PROFILE_IMG_SELECTOR = "img[alt*='profile picture'], img[alt*='profile photo']";`,
    `var PROFILE_IMG_SELECTOR = "img[alt*='profile picture'], img[alt*='profile photo'], img[alt*='photo de profil'], img[alt*='Photo de profil'], img[alt*='foto del perfil'], img[alt*='profilbild']";`
  );

  t = t.replace(
    `if ((alt.indexOf("profile picture") !== -1) || (alt.indexOf("profile photo") !== -1)){ return true; }
		if ((alt.indexOf("perfil") !== -1) || (alt.indexOf("profil") !== -1)){ return true; }`,
    `if ((alt.indexOf("profile picture") !== -1) || (alt.indexOf("profile photo") !== -1)){ return true; }
		if ((alt.indexOf("photo de profil") !== -1) || (alt.indexOf("foto del perfil") !== -1)){ return true; }
		if ((alt.indexOf("perfil") !== -1) || (alt.indexOf("profil") !== -1)){ return true; }`
  );

  t = t.replace(
    `function isLivePage(){
		try {
			var path = window.location.pathname || "";
			if (path.includes("/live") || path.includes("%2Flive")){ return true; }
			if (findViewerCountIcon()){ return true; }
		} catch(e){}
		return false;
	}`,
    `function isLivePage(){
		try {
			var path = window.location.pathname || "";
			var search = window.location.search || "";
			if (path.includes("/live") || path.includes("%2Flive")){ return true; }
			if (/[?&]broadcast_id=\\d+/i.test(search) || /[?&]broadcastId=\\d+/i.test(search)){ return true; }
			if (findViewerCountIcon()){ return true; }
			if (document.querySelector(LIVE_COMMENT_INPUT_SELECTOR)){ return true; }
		} catch(e){}
		return false;
	}`
  );

  t = t.replace(
    `function findLiveRows(){
		var rows = [];
		var seen = new Set();
		var imgs = document.querySelectorAll("section " + PROFILE_IMG_FALLBACK_SELECTOR);
		for (var i = 0; i < imgs.length; i++){
			var row = rowFromImage(imgs[i]);
			if (!row){ continue; }
			if (seen.has(row)){ continue; }
			seen.add(row);
			if (!looksLikeRow(row)){ continue; }
			rows.push(row);
		}
		return rows;
	}`,
    `function findLiveRows(){
		// AnimeBeat IG live patch: section-first, then whole-document fallback.
		var rows = [];
		var seen = new Set();
		var imgs = document.querySelectorAll("section " + PROFILE_IMG_FALLBACK_SELECTOR);
		if (!imgs.length){
			imgs = document.querySelectorAll(PROFILE_IMG_FALLBACK_SELECTOR);
		}
		for (var i = 0; i < imgs.length; i++){
			var row = rowFromImage(imgs[i]);
			if (!row){ continue; }
			if (seen.has(row)){ continue; }
			seen.add(row);
			if (!looksLikeRow(row)){ continue; }
			rows.push(row);
		}
		return rows;
	}`
  );

  fs.writeFileSync(filePath, t);
  return t.length;
}

function main() {
  const ig = path.join(SRC_DIR, "instagram.js");
  const igl = path.join(SRC_DIR, "instagramlive.js");
  if (!fs.existsSync(ig)) {
    console.error("SSN instagram.js introuvable:", ig);
    process.exit(1);
  }

  for (const f of [ig, igl]) {
    if (!fs.existsSync(f)) continue;
    const bak = f + ".bak-pre-animebeat";
    if (!fs.existsSync(bak)) {
      fs.copyFileSync(f, bak);
    } else {
      // Always patch from the pristine backup so re-runs are idempotent.
      fs.copyFileSync(bak, f);
    }
  }

  const len1 = patchFile(ig);
  fs.copyFileSync(ig, igl);
  const stamped = fs.readFileSync(ig, "utf8");
  fs.writeFileSync(path.join(REPO_PATCH_DIR, "ssn-instagram.js"), stamped);

  fs.writeFileSync(
    path.join(REPO_PATCH_DIR, "apply-ssn-instagram-patch.js"),
    `#!/usr/bin/env node
/**
 * Re-applique le patch Instagram Live SSN (messages live) sur l'app installée.
 * Usage: node desktop/stream/patches/apply-ssn-instagram-patch.js
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const src = path.join(__dirname, "ssn-instagram.js");
const destDir = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData/Local"),
  "Programs/socialstream/resources/app.asar.unpacked/resources/social_stream_fallback/main/sources"
);
for (const name of ["instagram.js", "instagramlive.js"]) {
  const dest = path.join(destDir, name);
  if (!fs.existsSync(path.dirname(dest))) {
    console.error("SSN introuvable:", destDir);
    process.exit(1);
  }
  const bak = dest + ".bak-pre-animebeat";
  if (fs.existsSync(dest) && !fs.existsSync(bak)) fs.copyFileSync(dest, bak);
  fs.copyFileSync(src, dest);
  console.log("Patched", dest);
}
console.log("OK — redémarre Social Stream Ninja.");
`
  );

  console.log("Patched instagram.js length", len1);
  console.log("Markers:", {
    hooked: stamped.includes("hookedBroadcastId"),
    discover: stamped.includes("discoverBroadcastIdAsync"),
    animebeat: stamped.includes("AnimeBeat IG live patch"),
    last30: stamped.includes("Date.now() / 1000) - 30"),
  });
}

main();
