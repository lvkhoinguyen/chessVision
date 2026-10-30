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
