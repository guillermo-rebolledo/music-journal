import { createServer } from "node:http";
const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
const groups = [
  { id: ids[0], title: "Shared title", "primary-type": "Album", "artist-credit": [{ name: "First Artist", joinphrase: " & " }, { name: "Guest" }], "first-release-date": "1998-05-01" },
  { id: ids[1], title: "Shared title", "primary-type": "Album", "artist-credit": [{ name: "Second Artist" }], "first-release-date": "2005" },
  { id: ids[2], title: "Sparse album", "primary-type": "Album" },
  { id: "55555555-5555-4555-8555-555555555555", title: "Direct album", "primary-type": "Album", "artist-credit": [{ name: "Direct Artist" }], "first-release-date": "2012" },
];
const artists = [
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Shared artist", disambiguation: "Mexican electronic duo" },
  { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Shared artist", disambiguation: "British folk singer" },
  { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "Sparse artist" },
];
const portraitArtist = { id: "abababab-abab-4bab-8bab-abababababab", name: "Portrait artist" };
const related = [
  { id: "14141414-1414-4414-8414-141414141414", name: "Related studio artist" },
  { id: "ffffffff-ffff-4fff-8fff-ffffffffffff", name: "Related fallback artist" },
  { id: "12121212-1212-4212-8212-121212121212", name: "Related sparse artist" },
  { id: "13131313-1313-4313-8313-131313131313", name: "Fourth related artist" },
];
const discoveryGroups = [
  { id: "41414141-4141-4141-8141-414141414141", title: "Lower ranked album" },
  { id: "42424242-4242-4242-8242-424242424242", title: "Popular album" },
  { id: "43434343-4343-4343-8343-434343434343", title: "Upcoming album", "first-release-date": "2999-01-01" },
  { id: "45454545-4545-4545-8545-454545454545", title: "Compilation", "secondary-types": ["Compilation"] },
  { id: "46464646-4646-4646-8646-464646464646", title: "Fallback album", "artist-credit": [{ name: related[1].name }] },
  { id: "47474747-4747-4747-8747-474747474747", title: "Undated album", "first-release-date": "" },
  { id: "48484848-4848-4848-8848-484848484848", title: "Popular single", "primary-type": "Single" },
  { id: "49494949-4949-4949-8949-494949494949", title: "Unranked studio album" },
].map((group) => ({
  "primary-type": "Album", "first-release-date": "2012-03", "artist-credit": [{ name: related[0].name }], ...group,
}));
let radioThrottled = false;
let outage = false;
let requests = [];
createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  res.setHeader("Content-Type", "application/json");
  if (url.pathname === "/control") {
    if (url.searchParams.has("outage")) outage = url.searchParams.get("outage") === "true";
    if (url.searchParams.has("radioThrottled")) radioThrottled = url.searchParams.get("radioThrottled") === "true";
    if (url.searchParams.has("reset")) requests = [];
    res.end(JSON.stringify(requests)); return;
  }
  if (url.pathname === "/health") { res.end("{}"); return; }
  // Optional artwork has its own providers and is excluded from catalog call counts.
  if (url.pathname === "/wikidata/api.php") {
    const search = url.searchParams.get("srsearch");
    if (search === `haswbstatement:P434=${portraitArtist.id}`) {
      res.end(JSON.stringify({ query: { search: [{ title: "Q123" }] } }));
    } else if (url.searchParams.get("entity") === "Q123") {
      res.end(JSON.stringify({ claims: { P18: [{ rank: "normal", mainsnak: { datavalue: { value: "Artist.jpg" } } }] } }));
    } else {
      res.end(JSON.stringify({ query: { search: [] } }));
    }
    return;
  }
  if (url.pathname === "/commons/api.php") {
    res.end(JSON.stringify({ query: { pages: [{ imageinfo: [{
      thumburl: "https://thumb.wikimedia.org/wikipedia/commons/thumb/example/250px-Artist.jpg",
      descriptionurl: "https://commons.wikimedia.org/wiki/File:Artist.jpg",
      extmetadata: {
        Artist: { value: "<a>Photo Author</a>" },
        LicenseShortName: { value: "CC BY 4.0" },
        LicenseUrl: { value: "https://creativecommons.org/licenses/by/4.0/" },
      },
    }] }] } }));
    return;
  }
  if (/^\/release-group\/[a-f0-9-]+\/front-(250|500)$/.test(url.pathname)) {
    res.writeHead(404); res.end("{}"); return;
  }
  requests.push({ url: req.url, time: Date.now(), agent: req.headers["user-agent"], ...(url.pathname.startsWith("/1/") && { privateHeaders: Boolean(req.headers.cookie || req.headers.authorization) }) });
  const query = url.searchParams.get("query") || "";
  if (outage || query.includes("failure")) { res.writeHead(502); res.end("{}"); return; }
  if (query.includes("timeout")) { setTimeout(() => res.end("{}"), 4500); return; }
  if (query.includes("throttled")) { res.writeHead(429, { "Retry-After": "6" }); res.end("{}"); return; }
  if (query.includes("malformed")) { res.end('{"unexpected":true}'); return; }
  if (url.pathname.startsWith("/1/lb-radio/artist/")) {
    if (radioThrottled) {
      res.writeHead(429, { "X-RateLimit-Reset-In": "30" }); res.end("{}"); return;
    }
    const seed = url.pathname.split("/").at(-1);
    const similar = seed === artists[0].id ? [artists[0], ...related] : [];
    res.end(JSON.stringify(Object.fromEntries(similar.map(({ id, name }) => [
      id, [{ similar_artist_mbid: id, similar_artist_name: name }],
    ])))); return;
  }
  if (url.pathname.startsWith("/1/popularity/top-release-groups-for-artist/")) {
    const id = url.pathname.split("/").at(-1);
    if (id === related[1].id) { res.writeHead(401); res.end("{}"); return; }
    const ranked = id === related[0].id ? [2, 3, 5, 6, 1, 0] : [];
    res.end(JSON.stringify(ranked.map((index) => ({ release_group_mbid: discoveryGroups[index].id })))); return;
  }
  if (url.pathname === "/release-group" && url.searchParams.has("artist")) {
    const id = url.searchParams.get("artist");
    const found = id === related[0].id ? [discoveryGroups[7]] : id === related[1].id ? [discoveryGroups[4]] : [discoveryGroups[5]];
    res.end(JSON.stringify({ "release-groups": found })); return;
  }
  if (url.pathname === "/release-group/" && query.includes("rgid:")) {
    res.end(JSON.stringify({ "release-groups": discoveryGroups.filter(({ id }) => query.includes(id)) })); return;
  }
  if (url.pathname === "/release-group/") {
    const results = query.includes("empty") ? [] : [...groups, groups[0], { ...groups[0], id: "44444444-4444-4444-8444-444444444444", "primary-type": "Single" }];
    res.end(JSON.stringify({ "release-groups": results })); return;
  }
  if (url.pathname === "/artist/") {
    if (query.includes("artwork fixture")) {
      res.end(JSON.stringify({ artists: [portraitArtist, artists[1]] })); return;
    }
    if (query.includes("discovery test seeds")) {
      res.end(JSON.stringify({ artists: related.slice(0, 2) })); return;
    }
    res.end(JSON.stringify({ artists: query.includes("empty") ? [] : [...artists, artists[0], { id: "invalid", name: "Invalid artist" }, { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", name: "" }] })); return;
  }
  if (url.pathname.startsWith("/artist/")) {
    const artist = [...artists, ...related].find((item) => url.pathname === `/artist/${item.id}`);
    res.writeHead(artist ? 200 : 404);
    res.end(JSON.stringify(artist || {})); return;
  }
  const group = [...groups, ...discoveryGroups].find((item) => url.pathname === `/release-group/${item.id}`);
  res.writeHead(group ? 200 : 404);
  res.end(JSON.stringify(group || {}));
}).listen(3101, "127.0.0.1");
