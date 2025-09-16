// result.js - read ?score=&total=&playlist= and populate UI
(function() {
  function q(name) { return new URLSearchParams(location.search).get(name); }
  const score = q('score') || '0';
  const total = q('total') || '0';
  const playlist = q('playlist') || '';

  document.addEventListener('DOMContentLoaded', () => {
    const scoreEl = document.getElementById('scoreValue');
    if (scoreEl) scoreEl.textContent = score;
    const totalEl = document.querySelector('.score-total');
    if (totalEl) totalEl.textContent = '/' + total;

    // Play again: go back to start page; optionally keep playlist in query so users can replay same pool
    const playAgain = document.getElementById('playAgain');
    if (playAgain) playAgain.href = 'tubeten.html';


  });
})();
