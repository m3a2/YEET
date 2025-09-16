/* public/js/play.js
 - No syncPanes / initPaneSync included (user handles CSS)
 - datalist randomized
 - session count from ?count= or full pool
 - YT cue (no autoplay), playRandom10s, pause, skip, confirm, modal
*/

let YT_PLAYER = null;
let POOL = [];        // session items (the sequence the game will use)
let POOL_FULL = [];   // full stored pool (used for datalist)
let currentIndex = 0;
let score = 0;
let play10Timer = null;

function qParam(name) { return new URLSearchParams(location.search).get(name); }
function normalizeTitle(s) { return (s||'').trim().toLowerCase().replace(/\s+/g,' '); }
function shuffleArray(a) { const b = a.slice(); for (let i=b.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [b[i],b[j]]=[b[j],b[i]] } return b; }

/* --- API helpers --- */
async function fetchPoolFull(playlistId){
  const r = await fetch(`/api/pool/${encodeURIComponent(playlistId)}`);
  if(!r.ok){
    const txt = await r.text();
    throw new Error('pool not found: ' + txt);
  }
  const j = await r.json();
  return j.items || [];
}

async function fetchSessionItems(playlistId, count){
  const r = await fetch(`/api/play/${encodeURIComponent(playlistId)}?count=${encodeURIComponent(count)}`);
  if(!r.ok) throw new Error('failed to load session items');
  const j = await r.json();
  return j.items || [];
}

/* --- YT loader --- */
let _ytReady = false;
function ensureYouTubeApi(){
  return new Promise((resolve,reject)=>{
    if(window.YT && window.YT.Player){ _ytReady = true; return resolve(window.YT); }
    window.onYouTubeIframeAPIReady = function(){ _ytReady = true; resolve(window.YT); };
    if(!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')){
      const s = document.createElement('script'); s.src='https://www.youtube.com/iframe_api'; s.async=true; document.head.appendChild(s);
    }
    setTimeout(()=> {
      if(_ytReady) resolve(window.YT); else reject(new Error('YT API load timeout'));
    }, 9000);
  });
}

/* --- Player create / cue (do not autoplay) --- */
function createOrLoadPlayer(videoId){
  if(!window.YT || !window.YT.Player) { console.warn('YT not ready'); return; }
  if(YT_PLAYER){
    try { YT_PLAYER.cueVideoById(videoId); } catch(e){ console.warn(e); }
    return;
  }
  const origin = window.location.origin || (location.protocol + '//' + location.host);
  YT_PLAYER = new YT.Player('player', {
    height:'360', width:'100%', videoId,
    playerVars:{ rel:0, modestbranding:1, origin },
    events:{
      onReady: (e)=> { try{ e.target.cueVideoById(videoId); }catch(e){}; },
      onStateChange: onPlayerStateChange,
      onError: onPlayerError
    }
  });
}
function onPlayerStateChange(e){ if(e.data === YT.PlayerState.ENDED) setTimeout(()=>goNext(true),300); }
function onPlayerError(e){ console.warn('YT error', e.data); setTimeout(()=>goNext(true),300); }

/* --- UI / controls --- */
function updateUI(){
  const idx = Math.min(currentIndex+1, POOL.length);
  document.getElementById('uiIndex').textContent = idx;
  document.getElementById('uiTotal').textContent = POOL.length;
  document.getElementById('uiScore').textContent = score;
  const val = (document.getElementById('answerInput').value||'').trim();
  const ok = !!val && POOL_FULL.some(i => normalizeTitle(i.title) === normalizeTitle(val)); // accept only if in full list
  const confirmBtn = document.getElementById('btnConfirm');
  if (confirmBtn) confirmBtn.disabled = !ok;
}

/* populate datalist with randomized order */
function populateDatalistRandom(items){
  const dl = document.getElementById('titlesList');
  if(!dl) return;
  dl.innerHTML = '';
  const shuffled = shuffleArray(items);
  shuffled.forEach(it => {
    const o = document.createElement('option');
    o.value = it.title;
    dl.appendChild(o);
  });
}

/* play random 10s snippet */
function playRandom10s(){
  if(!YT_PLAYER){ createModal('Player is Loading','Please try again in a moment','OK'); return; }
  try{
    const dur = YT_PLAYER.getDuration() || 0;
    let start = 0;
    if(dur > 30){ const min=10, max=Math.max(min, dur-20); start = Math.random()*(max-min)+min; }
    YT_PLAYER.seekTo(start, true);
    YT_PLAYER.playVideo();
    if(play10Timer) clearTimeout(play10Timer);
    play10Timer = setTimeout(()=>{ try{ YT_PLAYER.pauseVideo(); }catch(e){} }, 10000);
  }catch(e){ console.warn(e); }
}
function pauseToggle(){ if(!YT_PLAYER) return; const s = YT_PLAYER.getPlayerState(); if(s===YT.PlayerState.PLAYING) YT_PLAYER.pauseVideo(); else YT_PLAYER.playVideo(); }
function handleConfirm(){
  const val = (document.getElementById('answerInput').value||'').trim();
  const correct = normalizeTitle(POOL[currentIndex].title);
  if(!val || normalizeTitle(val) !== correct) {
    createModal('Wrong', `The answer is: "${POOL[currentIndex].title}"`, 'OK', ()=>{ document.getElementById('answerInput').value=''; goNext(false); });
  } else {
    score++; createModal('Correct! 🎉', `"${POOL[currentIndex].title}"`, 'OK', ()=>{ document.getElementById('answerInput').value=''; goNext(false); });
  }
}
function handleSkip(){ goNext(false); }
function goNext(auto=false){
  if(play10Timer){ clearTimeout(play10Timer); play10Timer = null; }
  if(currentIndex < POOL.length - 1){ currentIndex++; document.getElementById('answerInput').value=''; loadCurrent(); }
  else {
    const params = new URLSearchParams({ score:String(score), total:String(POOL.length) });
    const playlist = qParam('playlist'); if(playlist) params.set('playlist', playlist);
    location.href = `tubeten-result.html?${params.toString()}`;
  }
}
function loadCurrent(){ updateUI(); const it = POOL[currentIndex]; if(!it) return; createOrLoadPlayer(it.videoId); }

/* modal helper */
function createModal(title,message,cbText='OK',cb){ const root=document.getElementById('ttModalRoot'); root.innerHTML=''; const bg=document.createElement('div'); bg.className='tt-modal-backdrop'; const m=document.createElement('div'); m.className='tt-modal'; m.innerHTML=`<h3>${title}</h3><p>${message}</p>`; const b=document.createElement('button'); b.className='ok'; b.textContent=cbText; b.addEventListener('click',()=>{ root.style.display='none'; root.innerHTML=''; if(cb) cb(); }); m.appendChild(b); bg.appendChild(m); root.appendChild(bg); root.style.display='block'; }

/* --- UI wiring --- */
function wireUI(){
  const btnPlay10 = document.getElementById('btnPlay10');
  if(btnPlay10) btnPlay10.addEventListener('click', playRandom10s);
  const pause = document.getElementById('btnPauseSmall');
  if(pause) pause.addEventListener('click', pauseToggle);
  const btnSkip = document.getElementById('btnSkip');
  if(btnSkip) btnSkip.addEventListener('click', handleSkip);
  const btnConfirm = document.getElementById('btnConfirm');
  if(btnConfirm) btnConfirm.addEventListener('click', handleConfirm);
  const input = document.getElementById('answerInput');
  if(input) input.addEventListener('input', updateUI);
}

/* --- BOOTSTRAP: fetch full pool, determine session count, fetch session items --- */
window.addEventListener('DOMContentLoaded', async () => {
  wireUI();
  const playlist = qParam('playlist');
  if(!playlist) { alert('No playlist detected, return to homescreen'); location.href='tubeten.html'; return; }
  try {
    // 1) fetch full stored pool so we know available items for datalist + total count
    try {
      POOL_FULL = await fetchPoolFull(playlist);
    } catch(e) {
      console.warn('fetchPoolFull failed, will try session fallback:', e);
      POOL_FULL = [];
    }

    // 2) determine desired session play count
    const reqCount = parseInt(qParam('count') || '', 10);
    let sessionCount;
    if (POOL_FULL && POOL_FULL.length > 0) {
      sessionCount = Number.isFinite(reqCount) && reqCount > 0 ? Math.min(reqCount, POOL_FULL.length) : POOL_FULL.length;
    } else {
      sessionCount = Number.isFinite(reqCount) && reqCount > 0 ? reqCount : 10;
    }

    // 3) fetch session items from server (server will randomize)
    POOL = await fetchSessionItems(playlist, sessionCount);

    // 4) for dropdown we want randomized order of full pool (if available), otherwise randomized session pool
    const datalistSource = (POOL_FULL && POOL_FULL.length>0) ? POOL_FULL : POOL;
    populateDatalistRandom(datalistSource);

    // 5) init player & ui
    await ensureYouTubeApi().catch(e => console.warn('YT API load issue', e));
    currentIndex = 0; score = 0;
    loadCurrent();
    updateUI();
  } catch(err){
    console.error(err);
    createModal('Oops..','Something seems wrong, Please try again in a moment','OK', ()=>location.href='tubeten.html');
  }
});
