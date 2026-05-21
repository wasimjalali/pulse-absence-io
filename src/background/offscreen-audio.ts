// Hidden offscreen document. MV3 service workers have no DOM and no Web Audio
// API, so audio playback for the break-reminder chime lives here.
//
// Two distinct chimes:
//   first  → soft sustained "meditation bowl" (C5 + E5 + G5 chord) — calm reminder
//   final  → urgent triple-beep pattern at A5 — clearly different, "act now"
//
// Sine + sawtooth blend per note gives more presence at the same peak gain
// than pure sine — sines feel quiet to ears even at full amplitude because
// the spectrum is so narrow.

let ctx: AudioContext | null = null;

function audio(): AudioContext {
  if (ctx === null) ctx = new AudioContext();
  return ctx;
}

interface ToneOpts {
  freq: number;
  offset: number;          // seconds from chime start
  duration: number;        // seconds
  gain?: number;           // peak gain (0..1). Sine peaks around 0.5 safely.
  attack?: number;         // seconds — short = punchier
  release?: number;        // seconds — long = mellow tail
  detune?: number;         // cents of detune for the secondary oscillator
}

function tone(opts: ToneOpts): void {
  const ac = audio();
  const start = ac.currentTime + 0.02;
  const begin = start + opts.offset;
  const peak = opts.gain ?? 0.42;
  const attack = opts.attack ?? 0.012;
  const release = opts.release ?? Math.max(0.06, opts.duration * 0.6);
  const sustain = Math.max(0, opts.duration - attack - release);

  // Sine for the fundamental (clean, warm) + slightly detuned sawtooth at
  // lower gain for body/brightness. Through a low-pass to tame harshness.
  const lowpass = ac.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = opts.freq * 6;
  lowpass.Q.value = 0.8;

  const sumGain = ac.createGain();
  sumGain.gain.setValueAtTime(0, begin);
  sumGain.gain.linearRampToValueAtTime(peak, begin + attack);
  sumGain.gain.setValueAtTime(peak, begin + attack + sustain);
  sumGain.gain.exponentialRampToValueAtTime(0.0001, begin + attack + sustain + release);

  const sine = ac.createOscillator();
  sine.type = 'sine';
  sine.frequency.value = opts.freq;

  const saw = ac.createOscillator();
  saw.type = 'sawtooth';
  saw.frequency.value = opts.freq;
  saw.detune.value = opts.detune ?? 6;
  const sawGain = ac.createGain();
  sawGain.gain.value = 0.18;  // saw is just for harmonic flavour

  sine.connect(sumGain);
  saw.connect(sawGain).connect(sumGain);
  sumGain.connect(lowpass).connect(ac.destination);

  const tEnd = begin + attack + sustain + release + 0.05;
  sine.start(begin);
  sine.stop(tEnd);
  saw.start(begin);
  saw.stop(tEnd);
}

function playFirst(): void {
  // Mellow C-major chord (C5 + E5 + G5) sustained as one warm "bowl strike".
  // Slow attack, long tail. Reads as a calm prompt, not a warning.
  tone({ freq: 523.25, offset: 0.00, duration: 1.20, gain: 0.34, attack: 0.04, release: 0.80 });
  tone({ freq: 659.25, offset: 0.00, duration: 1.20, gain: 0.28, attack: 0.05, release: 0.80 });
  tone({ freq: 783.99, offset: 0.00, duration: 1.20, gain: 0.24, attack: 0.06, release: 0.80 });
}

function playFinal(): void {
  // Three crisp urgent beeps at A5 (880 Hz). Sharp attack, short. Pattern:
  // beep — pause — beep — pause — beep. Universally reads as "alarm".
  const beep = (offset: number) => tone({
    freq: 880,
    offset,
    duration: 0.16,
    gain: 0.46,
    attack: 0.004,
    release: 0.05,
  });
  // Add a low octave underneath each beep for body.
  const body = (offset: number) => tone({
    freq: 440,
    offset,
    duration: 0.16,
    gain: 0.22,
    attack: 0.004,
    release: 0.05,
  });
  beep(0.00); body(0.00);
  beep(0.22); body(0.22);
  beep(0.44); body(0.44);
}

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (typeof message !== 'object' || message === null) return;
  const m = message as { type?: string; stage?: string };
  if (m.type !== 'PLAY_BREAK_SOUND') return;
  try {
    const ac = audio();
    // AudioContext can land in 'suspended' state when the offscreen doc is
    // freshly created. Resume before playing so the chime is audible.
    if (ac.state === 'suspended') void ac.resume();
    if (m.stage === 'final') playFinal();
    else playFirst();
  } catch {
    // Web Audio can refuse if the document is suspended — never throw.
  }
});
