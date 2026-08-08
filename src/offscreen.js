let audioContext = null;
let replayTimer = null;
let activeNodes = [];

chrome.runtime.onMessage.addListener((message) => {
  if (message?.target !== "offscreen") {
    return;
  }

  if (message.type === "audio:play") {
    playLoop();
  }

  if (message.type === "audio:stop") {
    stopLoop();
  }
});

async function playLoop() {
  await ensureContext();
  stopLoop();

  const scheduleBurst = () => {
    const now = audioContext.currentTime + 0.05;
    [740, 880, 620].forEach((frequency, index) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();

      oscillator.type = index === 1 ? "square" : "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now + index * 0.22);
      gain.gain.exponentialRampToValueAtTime(0.12, now + index * 0.22 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.22 + 0.18);

      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(now + index * 0.22);
      oscillator.stop(now + index * 0.22 + 0.2);
      activeNodes.push(oscillator, gain);
    });
  };

  scheduleBurst();
  replayTimer = setTimeout(() => {
    playLoop().catch(() => undefined);
  }, 2200);
}

function stopLoop() {
  if (replayTimer) {
    clearTimeout(replayTimer);
    replayTimer = null;
  }

  activeNodes.forEach((node) => {
    try {
      if (typeof node.stop === "function") {
        node.stop();
      }
      if (typeof node.disconnect === "function") {
        node.disconnect();
      }
    } catch (error) {
      return;
    }
  });
  activeNodes = [];
}

async function ensureContext() {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }
}
