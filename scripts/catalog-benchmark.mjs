import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const corpusBytes = readFileSync(new URL("./catalog-benchmark-corpus.json", import.meta.url));
const { entities, queries } = JSON.parse(corpusBytes);
const corpusSha256 = createHash("sha256").update(corpusBytes).digest("hex");
const mbid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const queryKey = ({ kind, q }) => JSON.stringify([kind, q]);
const concurrency = 5;
const passes = 3;
const baselineSpacingMs = 1100;
const maxBaselineWaitMs = 60_000;
const requestTimeoutMs = 15_000;
const latencyLimitMs = 500;

function validateCorpus() {
  if (queries.length < 40 || new Set(queries.map(queryKey)).size !== queries.length) {
    throw new Error("The corpus needs at least 40 distinct kind/query pairs.");
  }
  for (const { kind, q, label, expected } of queries) {
    if (!["album", "artist"].includes(kind) || q !== q.trim() || q.length < 2 || q.length > 200 ||
        !label || (label === "empty") !== (expected.length === 0) ||
        expected.some(key => entities[key]?.kind !== kind || !mbid.test(entities[key].id))) {
      throw new Error("Invalid query label or entity in the corpus.");
    }
  }
}

function searchEndpoint() {
  const value = process.env.CATALOG_BENCHMARK_ORIGIN;
  const cookie = process.env.CATALOG_BENCHMARK_COOKIE;
  if (!value || !cookie || !/^[\x20-\x7e]+$/.test(cookie)) {
    throw new Error("Set CATALOG_BENCHMARK_ORIGIN and CATALOG_BENCHMARK_COOKIE for an isolated test deployment.");
  }
  let origin;
  try {
    origin = new URL(value);
  } catch {
    throw new Error("Invalid test origin.");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (!(origin.protocol === "https:" || (loopback && origin.protocol === "http:")) ||
      origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") {
    throw new Error("Use an HTTPS test origin or loopback HTTP.");
  }
  return { url: new URL("/api/catalog/search", origin), cookie };
}

function retryDelayMs(value) {
  if (!value) return 0;
  return /^\d+$/.test(value) ? Number(value) * 1000 : Math.max(0, Date.parse(value) - Date.now()) || 0;
}

async function request({ url, cookie }, { kind, q }, pass, freshUntil) {
  const target = new URL(url);
  target.search = new URLSearchParams({ kind, q });
  const start = performance.now();
  let httpStatus;
  let retryAfterMs = 0;
  const result = (outcome, details) => ({
    kind, q, pass, outcome, httpStatus, retryAfterMs,
    elapsedMs: Math.round((performance.now() - start) * 1000) / 1000,
    ...details,
  });
  let response;
  const signal = AbortSignal.timeout(requestTimeoutMs);
  try {
    response = await fetch(target, {
      headers: { cookie, accept: "application/json" },
      redirect: "manual",
      signal,
    });
    httpStatus = response.status;
    retryAfterMs = retryDelayMs(response.headers.get("retry-after"));
    if ([429, 503].includes(httpStatus)) retryAfterMs = Math.max(retryAfterMs, 5000);
    if (httpStatus !== 200) {
      await response.body?.cancel();
      return result("http-error");
    }

    let body;
    try {
      body = await response.json();
    } catch (error) {
      if (error instanceof SyntaxError) return result("invalid-response");
      throw error;
    }
    if (typeof body?.error === "string") {
      if (Number.isFinite(body.retryAfter) && body.retryAfter > 0) {
        retryAfterMs = Math.max(retryAfterMs, body.retryAfter * 1000);
        return result("throttled");
      }
      return result("application-error");
    }
    if (!Array.isArray(body?.matches) || body.matches.length > 20 ||
        body.matches.some(match => typeof match?.id !== "string" || !mbid.test(match.id))) {
      return result("invalid-response");
    }

    const age = Number(response.headers.get("age"));
    const warning = response.headers.get("warning") ?? "";
    if (age > 0 || /(?:^|,)\s*110\s/.test(warning)) {
      return result("stale", { staleReason: "cached-response" });
    }
    if (Date.now() >= freshUntil) return result("stale", { staleReason: "snapshot-age" });

    const matches = body.matches.map(({ id, title }) => ({
      id: id.toLowerCase(),
      ...(typeof title === "string" ? { title } : {}),
    }));
    return result(matches.length ? "matches" : "empty", { matches });
  } catch {
    return result(signal.aborted ? "timeout" : "network-error");
  }
}

function completed(sample) {
  return ["matches", "empty"].includes(sample?.outcome);
}

function p95(samples) {
  const elapsed = samples.filter(completed).map(sample => sample.elapsedMs).sort((a, b) => a - b);
  return elapsed[Math.ceil(elapsed.length * 0.95) - 1] ?? null;
}

async function baseline(endpoint) {
  const samples = [];
  let stop = false;
  for (const query of queries) {
    const { kind, q } = query;
    if (stop) {
      samples.push({ kind, q, pass: 1, outcome: "not-attempted" });
      continue;
    }
    const sample = await request(endpoint, query, 1, Infinity);
    samples.push(sample);
    stop = [401, 403].includes(sample.httpStatus) ||
      (sample.httpStatus >= 300 && sample.httpStatus < 400) ||
      sample.retryAfterMs > maxBaselineWaitMs;
    if (!stop && samples.length < queries.length) {
      await sleep(Math.max(baselineSpacingMs, sample.retryAfterMs));
    }
  }
  return { concurrency: 1, samples };
}

async function warmCandidate(endpoint, freshUntil) {
  const albums = queries.filter(query => query.kind === "album");
  const artists = queries.filter(query => query.kind === "artist");
  const warmupQueries = [albums[0], artists[0], albums[1], artists[1], albums[2]];
  const warmup = await Promise.all(warmupQueries.map(query => request(endpoint, query, 0, freshUntil)));
  const samples = [];
  const jobs = Array.from({ length: passes }, (_, i) => queries.map(query => ({ query, pass: i + 1 }))).flat();
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < jobs.length) {
      const index = next++;
      const { query, pass } = jobs[index];
      samples[index] = await request(endpoint, query, pass, freshUntil);
    }
  }));
  const p95Ms = p95(samples);
  const latencyGate = [...warmup, ...samples].every(completed)
    ? (p95Ms <= latencyLimitMs ? "pass" : "fail")
    : "inconclusive";
  return { concurrency, warmup, samples, p95Ms, latencyLimitMs, latencyGate };
}

function score(query, sample) {
  const expectedIds = query.expected.map(key => entities[key].id);
  const rank = sample.matches.findIndex(match => expectedIds.includes(match.id)) + 1;
  return {
    rank: rank || null,
    correct: expectedIds.length ? rank > 0 && rank <= 5 : sample.matches.length === 0,
  };
}

function loadReport(path, mode) {
  const report = JSON.parse(readFileSync(path, "utf8"));
  const samples = report.samples?.filter(sample => sample.pass === 1);
  if (report.mode !== mode || report.corpusSha256 !== corpusSha256 || samples?.length !== queries.length ||
      samples.some((sample, i) => queryKey(sample) !== queryKey(queries[i]))) {
    throw new Error("Expected matching baseline and local reports generated from this corpus, in that order.");
  }
  return [report, samples];
}

function compare(baselinePath, localPath) {
  const [before, baselineSamples] = loadReport(baselinePath, "baseline");
  const [after, localSamples] = loadReport(localPath, "local");
  const missing = [];
  const regressions = [];
  const exactMisses = [];
  const emptyMisses = [];
  const miles = [];
  const cases = [];
  let pairedPositiveQueries = 0;
  let baselineHits = 0;
  let localHits = 0;

  for (const [i, query] of queries.entries()) {
    const baselineSample = baselineSamples[i];
    const localSample = localSamples[i];
    const b = completed(baselineSample) ? score(query, baselineSample) : null;
    const l = completed(localSample) ? score(query, localSample) : null;
    const { kind, q, label } = query;
    cases.push({
      kind, q, label,
      baseline: { outcome: baselineSample.outcome, ...b },
      local: { outcome: localSample.outcome, ...l },
    });
    if (!b || !l) missing.push({ kind, q, baseline: baselineSample.outcome, local: localSample.outcome });
    if (b && l && label !== "empty") {
      pairedPositiveQueries++;
      baselineHits += Number(b.correct);
      localHits += Number(l.correct);
      if (b.correct && !l.correct) regressions.push({ kind, q, label, baselineRank: b.rank, localRank: l.rank });
    }
    if (label.startsWith("exact") && l && !l.correct) exactMisses.push({ kind, q, rank: l.rank });
    if (label === "empty" && l && !l.correct) emptyMisses.push({ kind, q, matchCount: localSample.matches.length });
    if (kind === "album" && ["Kind of Bl", "Kind of Blue Miles Davis", "Miles Davis Kind of Blue"].includes(q)) {
      let ordering = "not-applicable";
      if (q !== "Kind of Bl" && l?.rank) {
        const ahead = localSample.matches.slice(0, l.rank - 1);
        const similarName = /\bkind of blue\b/i;
        if (ahead.some(match => similarName.test(match.title?.normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ") ?? ""))) {
          ordering = "fail";
        }
        else ordering = ahead.every(match => match.title) ? "pass" : "inconclusive";
      }
      miles.push({ q, outcome: localSample.outcome, rank: l?.rank ?? null, topFive: l?.correct ?? null, ordering });
    }
  }

  const exactAndEmptyPass = !exactMisses.length && !emptyMisses.length;
  const milesPass = miles.every(row => row.topFive && row.ordering !== "fail");
  const relevanceGate = missing.length || miles.some(row => row.ordering === "inconclusive")
    ? "inconclusive"
    : (localHits > baselineHits && exactAndEmptyPass && milesPass ? "pass" : "fail");
  const rate = hits => pairedPositiveQueries ? hits / pairedPositiveQueries : null;
  return {
    corpusSha256,
    baselineWindow: { origin: before.origin, startedAt: before.startedAt, finishedAt: before.finishedAt },
    localWindow: { origin: after.origin, startedAt: after.startedAt, finishedAt: after.finishedAt, snapshotAt: after.snapshotAt },
    paired: {
      positiveQueries: pairedPositiveQueries,
      baseline: { topFiveHits: baselineHits, rate: rate(baselineHits) },
      local: { topFiveHits: localHits, rate: rate(localHits) },
    },
    missing, regressions, exactMisses, emptyMisses, miles, relevanceGate, cases,
    p95Ms: after.p95Ms,
    latencyGate: after.latencyGate,
  };
}

async function main([mode, ...args]) {
  validateCorpus();
  if (mode === "compare" && args.length === 2) return compare(...args);
  if (!((mode === "baseline" && args.length === 0) || (["cold", "local"].includes(mode) && args.length === 2))) {
    throw new Error("Usage: catalog-benchmark.mjs baseline | {local,cold} SNAPSHOT_TIMESTAMP MAX_AGE_HOURS | compare BASELINE_JSON LOCAL_JSON");
  }

  let snapshot = {};
  let freshUntil = Infinity;
  if (mode !== "baseline") {
    const [timestamp, maxAgeHours] = args;
    const sourceTime = Date.parse(timestamp);
    const maxAge = Number(maxAgeHours);
    if (!Number.isFinite(sourceTime) || sourceTime > Date.now() || !Number.isFinite(maxAge) || maxAge <= 0 ||
        !/(?:Z|[+-]\d\d:\d\d)$/i.test(timestamp)) {
      throw new Error("Provide the active snapshot source timestamp with timezone and a positive maximum age in hours.");
    }
    freshUntil = sourceTime + maxAge * 3600_000;
    snapshot = { snapshotAt: new Date(sourceTime).toISOString(), maxAgeHours: maxAge };
  }
  const endpoint = searchEndpoint();
  const startedAt = new Date().toISOString();
  let evidence;
  switch (mode) {
    case "baseline":
      evidence = await baseline(endpoint);
      break;
    case "local":
      evidence = await warmCandidate(endpoint, freshUntil);
      break;
    case "cold":
      evidence = { concurrency: 1, samples: [await request(endpoint, queries[0], 1, freshUntil)] };
      break;
  }
  return {
    mode, corpusSha256, queryCount: queries.length, origin: endpoint.url.origin, startedAt,
    finishedAt: new Date().toISOString(), ...snapshot, ...evidence,
  };
}

try {
  console.log(JSON.stringify(await main(process.argv.slice(2)), null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
