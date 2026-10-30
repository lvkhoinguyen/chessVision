import { predictBoard } from "./board.js";

const selectBtn = document.getElementById("select-btn");
const statusMessage = document.getElementById("status-message");
const resultControls = document.getElementById("result-controls");
const openEditorBtn = document.getElementById("open-editor-btn");
const openChesscomBtn = document.getElementById("open-chesscom-btn");
const openLichessBtn = document.getElementById("open-lichess-btn");
const fenDisplay = document.getElementById("fen-display");
const orientationIndicator = document.getElementById("orientation-indicator");
const copyFenBtn = document.getElementById("copy-fen-btn");
const previewToggleBtn = document.getElementById("preview-toggle-btn");
const lichessFrame = document.getElementById("lichess-frame");
const autoOpenToggle = document.getElementById("auto-open-toggle");
const openModeSelect = document.getElementById("open-mode-select");
const preferredSiteSelect = document.getElementById("preferred-site");

let currentPrediction = null;

function setStatus(text, isError = false) {
  statusMessage.textContent = text;
  if (isError) {
    statusMessage.classList.add("error");
  } else {
    statusMessage.classList.remove("error");
  }
}

function renderResult(prediction) {
  if (!prediction) return;
  currentPrediction = prediction;

  resultControls.style.display = "flex";
  fenDisplay.value = prediction.fen || "";

  const orientationText = prediction.orientation
    ? `${prediction.orientation.charAt(0).toUpperCase() + prediction.orientation.slice(1)} perspective`
    : "";
  orientationIndicator.textContent = orientationText;

  if (prediction.lichessAnalysisUrl || prediction.lichessUrl) {
    lichessFrame.src = prediction.lichessAnalysisUrl || prediction.lichessUrl;
  }

  setStatus("Board recognized! Edit pieces or open analysis below.");
}

// 1. Setup Select Board button
selectBtn.addEventListener("click", async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      setStatus("No active tab found.", true);
      return;
    }
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["src/content.js"],
    });
    window.close();
  } catch (err) {
    setStatus("Cannot select board on this page.", true);
  }
});

// 2. Open Board Editor Action (Lichess)
openEditorBtn.addEventListener("click", () => {
  if (currentPrediction?.lichessEditorUrl) {
    chrome.tabs.create({ url: currentPrediction.lichessEditorUrl });
  }
});

// 3. Open Analysis Actions
openChesscomBtn.addEventListener("click", () => {
  if (currentPrediction?.chesscomUrl) {
    chrome.tabs.create({ url: currentPrediction.chesscomUrl });
  }
});

openLichessBtn.addEventListener("click", () => {
  const url = currentPrediction?.lichessAnalysisUrl || currentPrediction?.lichessUrl;
  if (url) {
    chrome.tabs.create({ url });
  }
});

// 4. Copy FEN Action
copyFenBtn.addEventListener("click", async () => {
  if (!fenDisplay.value) return;
  try {
    await navigator.clipboard.writeText(fenDisplay.value);
    const originalText = copyFenBtn.textContent;
    copyFenBtn.textContent = "✓ Copied!";
    setTimeout(() => {
      copyFenBtn.textContent = originalText;
    }, 2000);
  } catch {
    fenDisplay.select();
    document.execCommand("copy");
    copyFenBtn.textContent = "✓ Copied!";
  }
});

// 5. Toggle Preview Frame
previewToggleBtn.addEventListener("click", () => {
  const isShown = lichessFrame.classList.toggle("show");
  previewToggleBtn.textContent = isShown
    ? "Hide Mini Board Preview"
    : "Show Mini Board Preview";
});

// 6. Settings Initialization & Change Handlers
async function initSettings() {
  const {
    autoOpen = true,
    openMode = "editor",
    preferredSite = "chesscom",
  } = await chrome.storage.sync.get(["autoOpen", "openMode", "preferredSite"]);

  autoOpenToggle.checked = autoOpen;
  openModeSelect.value = openMode;
  preferredSiteSelect.value = preferredSite;

  autoOpenToggle.addEventListener("change", () => {
    chrome.storage.sync.set({ autoOpen: autoOpenToggle.checked });
  });

  openModeSelect.addEventListener("change", () => {
    chrome.storage.sync.set({ openMode: openModeSelect.value });
  });

  preferredSiteSelect.addEventListener("change", () => {
    chrome.storage.sync.set({ preferredSite: preferredSiteSelect.value });
  });
}

// 7. Handle Pending Capture or Load Last Prediction
async function init() {
  await initSettings();

  const { pendingCapture, lastPrediction: sessionPrediction } =
    await chrome.storage.session.get(["pendingCapture", "lastPrediction"]);

  if (pendingCapture) {
    await chrome.storage.session.remove("pendingCapture");
    setStatus("Recognizing board position...");

    try {
      const result = await predictBoard(pendingCapture.dataUrl, pendingCapture.crop);
      await chrome.storage.session.set({ lastPrediction: result });
      await chrome.storage.local.set({ lastPrediction: result });
      renderResult(result);

      const {
        autoOpen = true,
        openMode = "editor",
        preferredSite = "chesscom",
      } = await chrome.storage.sync.get(["autoOpen", "openMode", "preferredSite"]);

      if (autoOpen) {
        let targetUrl = result.lichessEditorUrl;
        if (openMode === "analysis") {
          targetUrl =
            preferredSite === "lichess"
              ? result.lichessAnalysisUrl
              : result.chesscomUrl;
        }
        chrome.tabs.create({ url: targetUrl });
      }
    } catch (err) {
      setStatus(`Recognition failed: ${err.message}`, true);
    }
  } else if (sessionPrediction) {
    renderResult(sessionPrediction);
  } else {
    const { lastPrediction: localPrediction } = await chrome.storage.local.get([
      "lastPrediction",
    ]);
    if (localPrediction) {
      renderResult(localPrediction);
    }
  }
}

init();
