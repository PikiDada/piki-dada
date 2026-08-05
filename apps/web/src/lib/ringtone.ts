let audioCtx: AudioContext | null = null;
let intervalId: ReturnType<typeof setInterval> | null = null;

function beep() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  [880, 1108].forEach((freq, i) => {
    const osc = audioCtx!.createOscillator();
    const gain = audioCtx!.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now + i * 0.18);
    gain.gain.exponentialRampToValueAtTime(0.3, now + i * 0.18 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.16);
    osc.connect(gain).connect(audioCtx!.destination);
    osc.start(now + i * 0.18);
    osc.stop(now + i * 0.18 + 0.16);
  });
}

export function startRingtone() {
  if (intervalId) return;
  audioCtx ??= new (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
  beep();
  if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
  intervalId = setInterval(() => {
    beep();
    if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
  }, 2000);
}

export function stopRingtone() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  if (navigator.vibrate) navigator.vibrate(0);
}
