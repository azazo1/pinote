export const SNAP_THRESHOLD = 10;

export function snapBounds(bounds, targets, workArea, threshold = SNAP_THRESHOLD) {
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  const xCandidates = [workArea.x, workArea.x + workArea.width - bounds.width];
  const yCandidates = [workArea.y, workArea.y + workArea.height - bounds.height];

  for (const target of targets) {
    const targetRight = target.x + target.width;
    const targetBottom = target.y + target.height;
    if (rangesNear(bounds.y, bottom, target.y, targetBottom, threshold)) {
      xCandidates.push(
        target.x,
        targetRight - bounds.width,
        targetRight,
        target.x - bounds.width,
      );
    }
    if (rangesNear(bounds.x, right, target.x, targetRight, threshold)) {
      yCandidates.push(
        target.y,
        targetBottom - bounds.height,
        targetBottom,
        target.y - bounds.height,
      );
    }
  }

  const x = closestCandidate(bounds.x, xCandidates, threshold);
  const y = closestCandidate(bounds.y, yCandidates, threshold);
  return {
    x,
    y,
    width: bounds.width,
    height: bounds.height,
  };
}

function rangesNear(start, end, targetStart, targetEnd, threshold) {
  return start <= targetEnd + threshold && targetStart <= end + threshold;
}

function closestCandidate(current, candidates, threshold) {
  let result = current;
  let shortestDistance = threshold + 1;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate - current);
    if (distance <= threshold && distance < shortestDistance) {
      result = candidate;
      shortestDistance = distance;
    }
  }
  return result;
}
