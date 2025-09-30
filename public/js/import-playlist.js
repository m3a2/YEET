// import-playlist.js
// Handles Start button: POST /api/import-playlist and redirect to play page

document.addEventListener('DOMContentLoaded', () => {
  const importBtn = document.getElementById('importBtn');
  const input = document.getElementById('playlistUrl');
  const status = document.getElementById('importStatus');

  importBtn.addEventListener('click', async () => {
    const url = input.value.trim();
    if (!url) {
      status.textContent = 'Please Playlist URL';
      return;
    }
    importBtn.disabled = true;
    status.style.color = '#FF7071';
    status.textContent = 'Importing playlist…';

    try {
      const resp = await fetch('/api/import-playlist?force=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      const data = await resp.json();
      if (!resp.ok) {
        status.textContent = 'Import failed: ' + (data.error || resp.statusText);
        importBtn.disabled = false;
        return;
      }
      status.textContent = `Imported ${data.count} videos — Starting game...`;
      // redirect to play page with playlist id
      setTimeout(() => {
        location.href = `tubeten-play.html?playlist=${encodeURIComponent(data.playlistId)}`;
      }, 700);
    } catch (err) {
      console.error(err);
      status.textContent = 'Network error';
      importBtn.disabled = false;
    }
  });
});
