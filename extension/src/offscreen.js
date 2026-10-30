import { predictBoard } from "./board.js";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "PREDICT_BOARD_OFFSCREEN") {
    predictBoard(message.dataUrl, message.crop)
      .then((result) => {
        sendResponse({ success: true, result });
      })
      .catch((error) => {
        console.error("Offscreen prediction failed:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep message port open for async response
  }
});
