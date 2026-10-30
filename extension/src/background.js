let creatingOffscreenPromise = null;

async function ensureOffscreenDocument() {
  if (!chrome.offscreen) {
    return false;
  }

  const existingContexts = await chrome.runtime.getContexts?.({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });

  if (existingContexts && existingContexts.length > 0) {
    return true;
  }

  if (chrome.offscreen.hasDocument && (await chrome.offscreen.hasDocument())) {
    return true;
  }

  if (creatingOffscreenPromise) {
    await creatingOffscreenPromise;
    return true;
  }

  creatingOffscreenPromise = chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["BLOBS", "WORKERS"],
    justification: "Run ONNX model for chess board recognition",
  });

  await creatingOffscreenPromise;
  creatingOffscreenPromise = null;
  return true;
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== "CHESSVISION_SNIP_COMPLETE" || !sender.tab?.windowId) {
    return;
  }

  (async () => {
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, {
        format: "png",
      });

      const pendingCapture = {
        dataUrl,
        crop: message.crop,
      };

      await chrome.storage.session.set({ pendingCapture });

      const settings = await chrome.storage.sync.get({
        autoOpen: true,
        openMode: "editor",
        preferredSite: "chesscom",
      });

      const hasOffscreen = await ensureOffscreenDocument();
      if (hasOffscreen) {
        const response = await chrome.runtime.sendMessage({
          type: "PREDICT_BOARD_OFFSCREEN",
          dataUrl,
          crop: message.crop,
        });

        if (response?.success && response.result) {
          const result = response.result;
          await chrome.storage.session.set({ lastPrediction: result });
          await chrome.storage.local.set({ lastPrediction: result });
          await chrome.storage.session.remove("pendingCapture");

          if (settings.autoOpen) {
            let targetUrl = result.lichessEditorUrl;
            if (settings.openMode === "analysis") {
              targetUrl =
                settings.preferredSite === "lichess"
                  ? result.lichessAnalysisUrl
                  : result.chesscomUrl;
            }
            await chrome.tabs.create({ url: targetUrl });
            return;
          }
        }
      }

      // If autoOpen is disabled or offscreen is not available, try to open popup
      try {
        await chrome.action.openPopup();
      } catch {
        // Ignored if user gesture requirement blocks opening popup
      }
    } catch (err) {
      console.error("Failed to capture and process selected board:", err);
    }
  })();
});
