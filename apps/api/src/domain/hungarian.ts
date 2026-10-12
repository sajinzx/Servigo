/**
 * Minimum-cost assignment (Hungarian algorithm, O(n^2 m) shortest augmenting
 * path variant). `cost` is rows x cols; rows are requests, cols are workshop
 * slots. Rows > cols is allowed: unassigned rows get -1.
 *
 * Use Infinity for pairs that are not allowed.
 */
export function assign(cost: number[][]): { assignment: number[]; total: number } {
  const n = cost.length;
  if (n === 0) return { assignment: [], total: 0 };
  const m = cost[0].length;
  if (m === 0) return { assignment: Array(n).fill(-1), total: 0 };

  // pad to a square matrix with a large finite cost; padded/forbidden picks are dropped afterwards
  const size = Math.max(n, m);
  const BIG = 1e9;
  const a: number[][] = Array.from({ length: size + 1 }, () => Array(size + 1).fill(0));
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const v = i < n && j < m ? cost[i][j] : BIG;
      a[i + 1][j + 1] = Number.isFinite(v) ? v : BIG;
    }
  }

  const u = Array(size + 1).fill(0);
  const v = Array(size + 1).fill(0);
  const p = Array(size + 1).fill(0); // p[j] = row matched to column j
  const way = Array(size + 1).fill(0);

  for (let i = 1; i <= size; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = Array(size + 1).fill(Infinity);
    const used = Array(size + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= size; j++) {
        if (used[j]) continue;
        const cur = a[i0][j] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= size; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  const assignment: number[] = Array(n).fill(-1);
  let total = 0;
  for (let j = 1; j <= size; j++) {
    const i = p[j] - 1;
    const col = j - 1;
    if (i >= 0 && i < n && col < m && Number.isFinite(cost[i][col])) {
      assignment[i] = col;
      total += cost[i][col];
    }
  }
  return { assignment, total };
}
