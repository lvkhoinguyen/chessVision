import { InferenceSession, Tensor, env } from "../vendor/ort.wasm.min.mjs";

const SQUARE_SIZE = 64;
const BOARD_SIZE = 512;
const PIECE_CLASSES = ["b", "k", "n", "p", "q", "r", ".", "B", "K", "N", "P", "Q", "R"];

let sessionPromise;

function getUrl(path) {
  if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
    return chrome.runtime.getURL(path);
  }
  return new URL("../" + path, import.meta.url).href;
}

function getSession() {
  if (!sessionPromise) {
    env.wasm.wasmPaths = getUrl("vendor/");
    sessionPromise = InferenceSession.create(
      getUrl("chess_piece_classifier.onnx"),
    );
  }
  return sessionPromise;
}

function dataURItoBlob(dataUrl) {
  const parts = dataUrl.split(",");
  const byteString = atob(parts[1]);
  const mimeString = parts[0].split(":")[1].split(";")[0];
  const ia = new Uint8Array(byteString.length);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ia], { type: mimeString });
}

function trimBoardMargin(ctx) {
  try {
    const { data } = ctx.getImageData(0, 0, BOARD_SIZE, BOARD_SIZE);
    const diffY = new Float32Array(BOARD_SIZE);
    const diffX = new Float32Array(BOARD_SIZE);

    for (let y = 1; y < BOARD_SIZE; y++) {
      let sum = 0;
      const r1 = y * BOARD_SIZE * 4;
      const r0 = (y - 1) * BOARD_SIZE * 4;
      for (let x = 0; x < BOARD_SIZE; x += 2) {
        const lum1 = data[r1 + (x << 2)] * 0.299 + data[r1 + (x << 2) + 1] * 0.587 + data[r1 + (x << 2) + 2] * 0.114;
        const lum0 = data[r0 + (x << 2)] * 0.299 + data[r0 + (x << 2) + 1] * 0.587 + data[r0 + (x << 2) + 2] * 0.114;
        sum += Math.abs(lum1 - lum0);
      }
      diffY[y] = sum / (BOARD_SIZE / 2);
    }

    for (let x = 1; x < BOARD_SIZE; x++) {
      let sum = 0;
      for (let y = 0; y < BOARD_SIZE; y += 2) {
        const idx1 = (y * BOARD_SIZE + x) * 4;
        const idx0 = (y * BOARD_SIZE + (x - 1)) * 4;
        const lum1 = data[idx1] * 0.299 + data[idx1 + 1] * 0.587 + data[idx1 + 2] * 0.114;
        const lum0 = data[idx0] * 0.299 + data[idx0 + 1] * 0.587 + data[idx0 + 2] * 0.114;
        sum += Math.abs(lum1 - lum0);
      }
      diffX[x] = sum / (BOARD_SIZE / 2);
    }

    const maxY = Math.max(...diffY);
    const maxX = Math.max(...diffX);
    const threshY = maxY * 0.22;
    const threshX = maxX * 0.22;

    const maxMargin = Math.round(BOARD_SIZE * 0.20);
    let y0 = 0, y1 = BOARD_SIZE - 1;
    let x0 = 0, x1 = BOARD_SIZE - 1;

    for (let y = 1; y < maxMargin; y++) {
      if (diffY[y] > threshY) { y0 = y; break; }
    }
    for (let y = BOARD_SIZE - 1; y >= BOARD_SIZE - maxMargin; y--) {
      if (diffY[y] > threshY) { y1 = y; break; }
    }
    for (let x = 1; x < maxMargin; x++) {
      if (diffX[x] > threshX) { x0 = x; break; }
    }
    for (let x = BOARD_SIZE - 1; x >= BOARD_SIZE - maxMargin; x--) {
      if (diffX[x] > threshX) { x1 = x; break; }
    }

    const bw = x1 - x0;
    const bh = y1 - y0;

    if (bw < BOARD_SIZE * 0.98 && bh < BOARD_SIZE * 0.98 && bw > BOARD_SIZE * 0.72 && bh > BOARD_SIZE * 0.72) {
      const tempCanvas = new OffscreenCanvas(bw, bh);
      const tempCtx = tempCanvas.getContext("2d");
      tempCtx.drawImage(ctx.canvas, x0, y0, bw, bh, 0, 0, bw, bh);
      ctx.clearRect(0, 0, BOARD_SIZE, BOARD_SIZE);
      ctx.drawImage(tempCanvas, 0, 0, bw, bh, 0, 0, BOARD_SIZE, BOARD_SIZE);
    }
  } catch {
    // If trimming fails, keep original drawn canvas
  }
}

export async function predictBoardSquares(dataUrl, crop) {
  const getBitmapPromise = (async () => {
    try {
      const blob = dataURItoBlob(dataUrl);
      return crop
        ? await createImageBitmap(blob, crop.x, crop.y, crop.width, crop.height)
        : await createImageBitmap(blob);
    } catch {
      const blob = await fetch(dataUrl).then((r) => r.blob());
      return crop
        ? await createImageBitmap(blob, crop.x, crop.y, crop.width, crop.height)
        : await createImageBitmap(blob);
    }
  })();

  const [session, bitmap] = await Promise.all([
    getSession().catch((err) => {
      console.error("Failed to load chess_piece_classifier.onnx. Ensure the model file exists in extension folder:", err);
      throw err;
    }),
    getBitmapPromise,
  ]);

  const canvas = new OffscreenCanvas(BOARD_SIZE, BOARD_SIZE);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, BOARD_SIZE, BOARD_SIZE);
  bitmap.close();

  trimBoardMargin(ctx);

  const { data } = ctx.getImageData(0, 0, BOARD_SIZE, BOARD_SIZE);
  const planeSize = SQUARE_SIZE * SQUARE_SIZE;
  const squareStride = 3 * planeSize;
  const batchData = new Float32Array(64 * squareStride);

  for (let y = 0, rgba = 0; y < BOARD_SIZE; y++) {
    const sqRowOffset = (y >> 6) * 8;
    const pyOffset = (y & 63) * SQUARE_SIZE;
    for (let x = 0; x < BOARD_SIZE; x++, rgba += 4) {
      const base = (sqRowOffset + (x >> 6)) * squareStride + pyOffset + (x & 63);
      batchData[base] = data[rgba] / 255;
      batchData[base + planeSize] = data[rgba + 1] / 255;
      batchData[base + 2 * planeSize] = data[rgba + 2] / 255;
    }
  }

  const inputTensor = new Tensor("float32", batchData, [64, 3, SQUARE_SIZE, SQUARE_SIZE]);
  const results = await session.run({ [session.inputNames[0]]: inputTensor });
  const probs = results[session.outputNames[0]].data;
  const numClasses = PIECE_CLASSES.length;

  const predictions = [];
  for (let i = 0; i < 64; i++) {
    const offset = i * numClasses;
    let bestIdx = 0;
    let bestProb = probs[offset];

    for (let c = 1; c < numClasses; c++) {
      const p = probs[offset + c];
      if (p > bestProb) {
        bestProb = p;
        bestIdx = c;
      }
    }

    predictions.push(PIECE_CLASSES[bestIdx]);
  }

  return predictions;
}
