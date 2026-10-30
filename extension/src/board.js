import { predictBoardSquares } from "./classifier.js";
import { makeBoardFen, inferCastling, inferTurn } from "./utils.js";

export async function predictBoard(dataUrl, crop) {
  const predictions = await predictBoardSquares(dataUrl, crop);
  const orientation = inferOrientation(predictions);

  const pieces = new Array(64);
  const xorVal = orientation === "white" ? 56 : 7;
  for (let s = 0; s < 64; s++) {
    pieces[s] = predictions[s ^ xorVal];
  }

  const turn = inferTurn(pieces, orientation);
  const castling = inferCastling(pieces);
  const boardFen = makeBoardFen(pieces);
  const fen = `${boardFen} ${turn[0]} ${castling} - 0 1`;
  const fenSlug = `${boardFen}_${turn[0]}_${castling}_-_0_1`;

  const lichessAnalysisUrl = `https://lichess.org/analysis/${fenSlug}?color=${orientation}`;
  const lichessEditorUrl = `https://lichess.org/editor/${fenSlug}?color=${orientation}`;
  const fenEncoded = fen.replace(/\//g, "%2F").replace(/ /g, "+");
  const flip = orientation === "black" ? "&flip=true" : "";
  const chesscomUrl = `https://www.chess.com/analysis?fen=${fenEncoded}${flip}`;

  return {
    fen,
    orientation,
    turn,
    castling,
    lichessUrl: lichessAnalysisUrl,
    lichessAnalysisUrl,
    lichessEditorUrl,
    chesscomUrl,
  };
}

function inferOrientation(predictions) {
  let whiteSum = 0;
  let whiteCount = 0;
  let blackSum = 0;
  let blackCount = 0;

  for (let i = 0; i < 64; i++) {
    const ch = predictions[i];
    if (ch >= "A" && ch <= "Z") {
      whiteSum += i >> 3;
      whiteCount++;
    } else if (ch >= "a" && ch <= "z") {
      blackSum += i >> 3;
      blackCount++;
    }
  }

  if (!whiteCount || !blackCount) return "white";
  return whiteSum / whiteCount > blackSum / blackCount ? "white" : "black";
}
