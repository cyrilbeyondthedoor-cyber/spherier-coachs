(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SpherierCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const equal = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

  function score(codes, levels = {}, skipped = []) {
    const unique = [...new Set(codes)];
    const evaluated = unique.filter((code) => Number(levels[code]) > 0);
    const mastered = evaluated.filter((code) => Number(levels[code]) === 3);
    return { total: unique.length, evaluated: evaluated.length, mastered: mastered.length,
      skipped: unique.filter((code) => !levels[code] && skipped.includes(code)).length,
      percent: evaluated.length ? Math.round(mastered.length * 100 / evaluated.length) : null };
  }

  // Merge only independently edited fields. Overlapping changes remain explicit.
  function merge(base, local, remote) {
    const result = clone(remote);
    const conflicts = [];
    const choose = (path, before, ours, theirs) => {
      if (equal(ours, before)) return clone(theirs ?? null);
      if (!equal(theirs, before) && !equal(ours, theirs)) conflicts.push(path);
      return clone(ours ?? null);
    };
    for (const field of ['levels', 'practice']) {
      result[field] = { ...(remote[field] || {}) };
      for (const key of new Set([...Object.keys(base[field] || {}), ...Object.keys(local[field] || {})])) {
        const value = choose(`${field}.${key}`, base[field]?.[key], local[field]?.[key], remote[field]?.[key]);
        if (value === null) delete result[field][key]; else result[field][key] = value;
      }
    }
    for (const field of ['current', 'later', 'priorites']) {
      result[field] = choose(field, base[field], local[field], remote[field]);
    }
    return { state: result, conflicts };
  }

  function compare(previous, current, codes) {
    return codes.filter((code) => previous[code] > 0 && current[code] > 0)
      .map((code) => ({ code, before: previous[code], after: current[code], delta: current[code] - previous[code] }));
  }
  return { score, merge, compare, equal, clone };
});
