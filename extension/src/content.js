(() => {
  const EXISTING_ID = "chessvision-snip-overlay";
  document.getElementById(EXISTING_ID)?.remove();

  const overlay = document.createElement("div");
  overlay.id = EXISTING_ID;
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647",
    cursor: "crosshair",
    backgroundColor: "rgba(0, 0, 0, 0.45)",
    userSelect: "none",
  });

  const hint = document.createElement("div");
  hint.textContent = "Drag loosely around chessboard • Auto-snaps to board • Esc to cancel";
  Object.assign(hint.style, {
    position: "fixed",
    top: "16px",
    left: "50%",
    transform: "translateX(-50%)",
    padding: "8px 18px",
    borderRadius: "999px",
    backgroundColor: "rgba(20, 20, 24, 0.92)",
    color: "#ffffff",
    fontFamily: "system-ui, -apple-system, sans-serif",
    fontSize: "13px",
    fontWeight: "600",
    pointerEvents: "none",
    boxShadow: "0 4px 14px rgba(0, 0, 0, 0.4)",
    letterSpacing: "0.2px",
  });

  const selectionBox = document.createElement("div");
  Object.assign(selectionBox.style, {
    position: "fixed",
    display: "none",
    border: "2px solid #35c555",
    borderRadius: "4px",
    backgroundColor: "rgba(53, 197, 85, 0.16)",
    boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.45)",
    boxSizing: "border-box",
    pointerEvents: "none",
  });

  overlay.append(hint, selectionBox);
  document.documentElement.appendChild(overlay);

  let startX = 0;
  let startY = 0;
  let isDragging = false;

  const getRect = (e) => ({
    x: Math.min(startX, e.clientX),
    y: Math.min(startY, e.clientY),
    width: Math.abs(e.clientX - startX),
    height: Math.abs(e.clientY - startY),
  });

  function findUnderlyingBoardRect(x, y, width, height) {
    overlay.style.display = "none";

    // Sample center and points near corners
    const samplePoints = [
      { px: x + width / 2, py: y + height / 2 },
      { px: x + width * 0.25, py: y + height * 0.25 },
      { px: x + width * 0.75, py: y + height * 0.75 },
    ];

    const candidateElements = new Set();
    for (const pt of samplePoints) {
      if (pt.px >= 0 && pt.py >= 0) {
        const els = document.elementsFromPoint(pt.px, pt.py) || [];
        for (const el of els) candidateElements.add(el);
      }
    }

    overlay.style.display = "";

    let bestMatch = null;
    let bestScore = 0;

    for (const el of candidateElements) {
      let curr = el;
      let depth = 0;
      while (curr && curr !== document.body && curr !== document.documentElement && depth < 6) {
        depth++;
        const rect = curr.getBoundingClientRect();
        if (rect.width >= 100 && rect.height >= 100) {
          const aspect = rect.width / rect.height;
          const isSquare = aspect >= 0.88 && aspect <= 1.14;

          const tag = curr.tagName.toLowerCase();
          const cls = (curr.className || "").toString().toLowerCase();
          const id = (curr.id || "").toLowerCase();

          const hasBoardSignature =
            tag === "cg-board" ||
            tag === "chess-board" ||
            tag === "canvas" ||
            (tag === "img" && isSquare) ||
            cls.includes("board") ||
            cls.includes("chessboard") ||
            id.includes("board");

          if (isSquare && hasBoardSignature) {
            // Calculate intersection area with user selection
            const interX1 = Math.max(x, rect.left);
            const interY1 = Math.max(y, rect.top);
            const interX2 = Math.min(x + width, rect.right);
            const interY2 = Math.min(y + height, rect.bottom);
            const interW = Math.max(0, interX2 - interX1);
            const interH = Math.max(0, interY2 - interY1);
            const interArea = interW * interH;

            const userArea = width * height;
            const boardArea = rect.width * rect.height;
            const overlap = interArea / Math.min(userArea, boardArea);

            if (overlap > 0.40 && overlap > bestScore) {
              bestScore = overlap;
              bestMatch = {
                x: rect.left,
                y: rect.top,
                width: rect.width,
                height: rect.height,
              };
            }
          }
        }
        curr = curr.parentElement;
      }
    }

    return bestMatch;
  }

  const cleanup = () => {
    window.removeEventListener("keydown", onKeyDown, true);
    overlay.remove();
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cleanup();
    }
  };

  overlay.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    overlay.style.backgroundColor = "transparent";
    Object.assign(selectionBox.style, {
      display: "block",
      left: `${startX}px`,
      top: `${startY}px`,
      width: "0px",
      height: "0px",
    });
  });

  overlay.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    const { x, y, width, height } = getRect(e);
    Object.assign(selectionBox.style, {
      left: `${x}px`,
      top: `${y}px`,
      width: `${width}px`,
      height: `${height}px`,
    });
  });

  overlay.addEventListener("mouseup", (e) => {
    if (!isDragging) return;
    isDragging = false;

    const { x, y, width, height } = getRect(e);
    cleanup();

    if (width < 32 || height < 32) return;

    // Check if user's drag overlaps an underlying chessboard element
    let finalCrop = { x, y, width, height };
    const snapped = findUnderlyingBoardRect(x, y, width, height);

    if (snapped) {
      finalCrop = snapped;
    } else {
      // If user dragged a non-square box (e.g. video or PDF), auto-square it around the center
      const maxDim = Math.max(width, height);
      const minDim = Math.min(width, height);
      if (maxDim / minDim > 1.08) {
        // Enforce square based on larger dimension (so nothing is cut out)
        const size = maxDim;
        const cx = x + width / 2;
        const cy = y + height / 2;
        finalCrop = {
          x: Math.max(0, cx - size / 2),
          y: Math.max(0, cy - size / 2),
          width: size,
          height: size,
        };
      }
    }

    const dpr = window.devicePixelRatio || 1;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        chrome.runtime.sendMessage({
          type: "CHESSVISION_SNIP_COMPLETE",
          crop: {
            x: Math.max(0, Math.round(finalCrop.x * dpr)),
            y: Math.max(0, Math.round(finalCrop.y * dpr)),
            width: Math.round(finalCrop.width * dpr),
            height: Math.round(finalCrop.height * dpr),
          },
        });
      });
    });
  });

  window.addEventListener("keydown", onKeyDown, true);
})();
