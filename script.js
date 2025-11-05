const countdownEl = document.getElementById('countdown');
const targetAttribute = countdownEl?.dataset.target;
const targetDate = targetAttribute ? new Date(targetAttribute) : null;

function setValues(days, hours, minutes, seconds) {
  const daysEl = document.getElementById('days');
  const hoursEl = document.getElementById('hours');
  const minutesEl = document.getElementById('minutes');
  const secondsEl = document.getElementById('seconds');

  daysEl.textContent = days.toString().padStart(2, '0');
  hoursEl.textContent = hours.toString().padStart(2, '0');
  minutesEl.textContent = minutes.toString().padStart(2, '0');
  secondsEl.textContent = seconds.toString().padStart(2, '0');
}

function updateCountdown() {
  if (!countdownEl) {
    return;
  }
  if (!targetDate || Number.isNaN(targetDate.getTime())) {
    setValues(0, 0, 0, 0);
    const finishedEl = document.getElementById('finished');
    if (finishedEl) {
      finishedEl.textContent = 'Tanggal tidak valid.';
      finishedEl.style.display = 'block';
    }
    countdownEl.style.display = 'none';
    return;
  }

  const now = new Date();
  const distance = targetDate.getTime() - now.getTime();
  const finishedEl = document.getElementById('finished');

  if (distance <= 0) {
    setValues(0, 0, 0, 0);
    countdownEl.style.display = 'none';
    if (finishedEl) {
      finishedEl.textContent = 'Waktu telah tiba!';
      finishedEl.style.display = 'block';
    }
    return;
  }

  const secondsTotal = Math.floor(distance / 1000);
  const days = Math.floor(secondsTotal / (60 * 60 * 24));
  const hours = Math.floor((secondsTotal / (60 * 60)) % 24);
  const minutes = Math.floor((secondsTotal / 60) % 60);
  const seconds = Math.floor(secondsTotal % 60);

  setValues(days, hours, minutes, seconds);

  if (finishedEl) {
    finishedEl.style.display = 'none';
  }
  countdownEl.style.display = 'grid';
}

updateCountdown();
setInterval(updateCountdown, 1000);
