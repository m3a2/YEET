/* public/js/play.js — rewritten robust version */

// ---- Global-safe state (กัน error ถูกประกาศซ้ำ) ----
window.YT_PLAYER = window.YT_PLAYER ?? null;
let POOL = [];
let POOL_FULL = [];
let currentIndex = 0;
let score = 0;

// ---- Helpers ----
const $ = (id) => document.getElementById(id);
const getPlaylistId = () => new URLSearchParams(location.search).get("playlist");
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

const normalizeItem = (it) => ({
  videoId: it?.videoId || it?.id || it?.video_id || it?.video?.videoId || "",
  title:   it?.title   || it?.name || it?.snippet?.title || ""
});

// ---- UI ----
function updateUI() {
  const q = $("uiQ");
  const t = $("uiTotal");
  const scoreEl = $("scoreVal");
  if (q) q.textContent = POOL.length ? (currentIndex + 1) : 0;
  if (t) t.textContent = POOL.length || 0;
  if (scoreEl) scoreEl.textContent = score;
}

function populateDatalistRandom(items) {
  const datalist = $("titleList");
  if (!datalist) return;
  datalist.innerHTML = "";
  const shuffled = items.slice().sort(() => Math.random() - 0.5).slice(0, 100);
  for (const it of shuffled) {
    const opt = document.createElement("option");
    opt.value = it.title || "";
    datalist.appendChild(opt);
  }
}

// ---- Backend calls ----
async function fetchJSON(url) {
  const r = await fetch(url, { credentials: "same-origin" });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}

async function fetchPoolFull(playlistId) {
  try {
    const data = await fetchJSON(`/api/pool/${encodeURIComponent(playlistId)}`);
    const items = (data?.items || data || []).map(normalizeItem).filter(x => x.videoId);
    return items;
  } catch (e) {
    console.warn("fetchPoolFull failed:", e);
    return [];
  }
}

async function fetchSessionItems(playlistId, count) {
  try {
    const data = await fetchJSON(`/api/play/${encodeURIComponent(playlistId)}?count=${count}`);
    const arr = (data?.items || data || []).map(normalizeItem).filter(x => x.videoId);
    return arr;
  } catch (e) {
    console.warn("fetchSessionItems failed:", e);
    return [];
  }
}

// ---- YouTube Iframe API bootstrap ----
let ytReadyPromise;
function ensureYouTubeApi() {
  if (window.YT && window.YT.Player) return Promise.resolve();
  if (ytReadyPromise) return ytReadyPromise;

  ytReadyPromise = new Promise((resolve) => {
    // onYouTubeIframeAPIReady อาจถูกประกาศแล้วในรอบก่อน
    if (!window.onYouTubeIframeAPIReady) {
      window.onYouTubeIframeAPIReady = () => resolve();
    } else {
      // ถ้ามีอยู่แล้ว ให้ resolve เมื่อไลบรารีโหลดเสร็จ
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { try { prev(); } catch {} resolve(); };
    }

    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    document.head.appendChild(s);
  });

  return ytReadyPromise;
}

// ---- Player ----
function createOrLoadPlayer(videoId) {
  if (!videoId) return;
  // cue บน player เดิมถ้ามี
  if (window.YT_PLAYER && window.YT && window.YT.Player) {
    try {
      window.YT_PLAYER.cueVideoById(videoId);
      return;
    } catch (e) {
      console.warn("cueVideoById failed; recreating player", e);
    }
  }

  // สร้างใหม่
  window.YT_PLAYER = new YT.Player("player", {
    width: "100%",
    height: "100%",
    videoId,
    playerVars: {
      playsinline: 1,
      rel: 0,
      modestbranding: 1,
      controls: 1
    },
    events: {
      onReady: () => {},
      onStateChange: () => {}
    }
  });
}

function loadCurrent() {
  if (!POOL.length) return;
  const it = POOL[currentIndex];
  if (!it) return;
  createOrLoadPlayer(it.videoId);
  updateUI();
}

// ---- Controls (optional wiring, ปลอดภัยถ้า element ไม่มี) ----
function bindControls() {
  const pauseBtn = $("pauseBtn");
  if (pauseBtn) {
    pauseBtn.addEventListener("click", () => {
      const P = window.YT_PLAYER;
      if (!P || !P.pauseVideo || !P.playVideo || !P.getPlayerState) return;
      // 1 = PLAYING, 2 = PAUSED
      const st = P.getPlayerState();
      if (st === 1) P.pauseVideo();
      else P.playVideo();
    });
  }

  const play10Btn = $("play10Btn");
  if (play10Btn) {
    play10Btn.addEventListener("click", () => {
      const P = window.YT_PLAYER;
      if (!P || !P.seekTo || !P.getDuration || !P.playVideo) return;
      const dur = Math.max(0, P.getDuration() || 0);
      const start = Math.floor(Math.random() * Math.max(1, dur - 10));
      try { P.seekTo(start, true); } catch {}
      try { P.playVideo(); } catch {}
      // ไม่ stop อัตโนมัติ 10 วิ เพราะบางธีมอยากให้ผู้ใช้กดเอง
    });
  }

  const nextBtn = $("nextBtn");
  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      if (!POOL.length) return;
      currentIndex = clamp(currentIndex + 1, 0, POOL.length - 1);
      loadCurrent();
    });
  }

  const prevBtn = $("prevBtn");
  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      if (!POOL.length) return;
      currentIndex = clamp(currentIndex - 1, 0, POOL.length - 1);
      loadCurrent();
    });
  }
}

// ---- Bootstrap ----
document.addEventListener("DOMContentLoaded", async () => {
  // ถ้าไฟล์นี้ถูก include เฉพาะในหน้าเล่น จะไม่ต้อง guard; แต่กันไว้ให้
  const isPlayPage = /\/tubeten-play(?:\.html)?$/.test(location.pathname) || $("player");
  if (!isPlayPage) return;

  const playlist = getPlaylistId();
  if (!playlist) {
    // ไม่มีพารามิเตอร์ playlist ให้กลับหน้าแรก
    location.href = "tubeten.html";
    return;
  }

  // จำนวนข้อที่อยากเล่นใน session นี้ (ดึงจาก input ถ้ามี, ไม่งั้นใช้ 50)
  const wantInput = $("questionCount");
  const want = wantInput ? parseInt((wantInput.value || "50"), 10) : 50;
  const sessionCount = clamp(isNaN(want) ? 50 : want, 1, 100);

  try {
    // 1) ดึงรายการเต็ม (เพื่อ datalist + ตัวเลขรวม)
    POOL_FULL = await fetchPoolFull(playlist);

    // 2) ดึงชุดที่จะเล่น (สุ่มจากฝั่ง server ตาม sessionCount)
    let raw = await fetchSessionItems(playlist, sessionCount);

    // 3) normalize + fallback กรณีฝั่ง server ส่งว่าง
    POOL = (Array.isArray(raw) ? raw : []).map(normalizeItem).filter(x => x.videoId);

    if (POOL.length === 0 && POOL_FULL.length > 0) {
      POOL = POOL_FULL.slice(0, sessionCount).map(normalizeItem).filter(x => x.videoId);
    }

    // 4) ไม่มีวิดีโอให้เล่นจริง ๆ
    if (POOL.length === 0) {
      console.warn("[TT] session empty", { raw, POOL_FULL });
      alert("No playable videos in this playlist right now.");
      location.href = "tubeten.html";
      return;
    }

    // 5) เติม datalist สำหรับ auto-complete (ถ้ามี)
    populateDatalistRandom(POOL_FULL.length ? POOL_FULL : POOL);

    // 6) โหลด YouTube API แล้วเริ่มเล่นคลิปแรก
    await ensureYouTubeApi();
    bindControls();
    currentIndex = 0;
    score = 0;
    console.log("[TT] playlist=", playlist, "POOL_FULL=", POOL_FULL.length, "SESSION=", POOL.length);
    loadCurrent();
  } catch (e) {
    console.error("Boot failed:", e);
    alert("Failed to start game. Please try again.");
  }
});
