import { createServer } from "node:http";
const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
const groups = [
  { id: ids[0], title: "Shared title", "primary-type": "Album", "artist-credit": [{ name: "First Artist", joinphrase: " & " }, { name: "Guest" }], "first-release-date": "1998-05-01" },
  { id: ids[1], title: "Shared title", "primary-type": "Album", "artist-credit": [{ name: "Second Artist" }], "first-release-date": "2005" },
  { id: ids[2], title: "Sparse album", "primary-type": "Album" },
  { id: "55555555-5555-4555-8555-555555555555", title: "Direct album", "primary-type": "Album", "artist-credit": [{ name: "Direct Artist" }], "first-release-date": "2012" },
];
let outage = false;
let requests = [];
createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  res.setHeader("Content-Type", "application/json");
  if (url.pathname === "/control") {
    if (url.searchParams.has("outage")) outage = url.searchParams.get("outage") === "true";
    if (url.searchParams.has("reset")) requests = [];
    res.end(JSON.stringify(requests)); return;
  }
  if (url.pathname === "/health") { res.end("{}"); return; }
  requests.push({ url: req.url, time: Date.now(), agent: req.headers["user-agent"] });
  const query = url.searchParams.get("query") || "";
  if (outage || query.includes("failure")) { res.writeHead(502); res.end("{}"); return; }
  if (query.includes("timeout")) { setTimeout(() => res.end("{}"), 4500); return; }
  if (query.includes("throttled")) { res.writeHead(429, { "Retry-After": "6" }); res.end("{}"); return; }
  if (query.includes("malformed")) { res.end('{"unexpected":true}'); return; }
  if (url.pathname === "/release-group/") {
    const results = query.includes("empty") ? [] : [...groups, groups[0], { ...groups[0], id: "44444444-4444-4444-8444-444444444444", "primary-type": "Single" }];
    res.end(JSON.stringify({ "release-groups": results })); return;
  }
  const group = groups.find((item) => url.pathname === `/release-group/${item.id}`);
  res.writeHead(group ? 200 : 404);
  res.end(JSON.stringify(group || {}));
}).listen(3101, "127.0.0.1");
