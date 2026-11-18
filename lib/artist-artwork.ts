import "server-only";
import { CatalogError, requestProvider } from "./provider";

const week = 7 * 24 * 60 * 60;

export type ArtistImage = {
  src: string;
  source: string;
  author: string;
  license: string;
  licenseUrl?: string;
};

function query<T>(
  provider: "wikidata" | "commons",
  params: Record<string, string>,
  read: (data: Record<string, unknown>) => T,
) {
  return requestProvider(provider, `api.php?${new URLSearchParams({ ...params, format: "json" })}`, week, (data) => {
    if (!data || typeof data !== "object" || "error" in data) throw new CatalogError("upstream");
    return read(data as Record<string, unknown>);
  });
}

function trustedUrl(value: unknown, hosts: string[], prefix: string) {
  if (typeof value !== "string") return;
  const url = URL.parse(value);
  if (url?.protocol === "https:" && !url.username && !url.password && hosts.includes(url.host) && url.pathname.startsWith(prefix)) {
    return url;
  }
}

export async function artistArtwork(id: string): Promise<ArtistImage | null> {
  const entity = await query("wikidata", {
    action: "query", list: "search", srsearch: `haswbstatement:P434=${id}`, srnamespace: "0", srlimit: "2", srprop: "",
  }, (data) => {
    const hits = (data.query as { search?: { title?: string }[] })?.search;
    const title = hits?.length === 1 ? hits[0].title : undefined;
    return typeof title === "string" && /^Q[1-9]\d*$/.test(title) ? title : null;
  });
  if (!entity) return null;

  const filename = await query("wikidata", {
    action: "wbgetclaims", entity, property: "P18",
  }, (data) => {
    type Claim = { rank: string; mainsnak?: { datavalue?: { value?: unknown } } };
    const images = (data.claims as { P18?: Claim[] })?.P18 ?? [];
    const claim = images.find(({ rank }) => rank === "preferred") ?? images.find(({ rank }) => rank === "normal");
    const name = claim?.mainsnak?.datavalue?.value;
    return typeof name === "string" && name.length <= 255 && !/[|\x00-\x1f]/.test(name) ? name : null;
  });
  if (!filename) return null;

  return query("commons", {
    action: "query", titles: `File:${filename}`, prop: "imageinfo", iiprop: "url|extmetadata",
    iiextmetadatafilter: "Artist|LicenseShortName|LicenseUrl", iiurlwidth: "250", formatversion: "2",
  }, (data) => {
    type ImageInfo = {
      thumburl?: unknown;
      descriptionurl?: unknown;
      extmetadata?: Record<string, { value?: unknown }>;
    };
    const image = (data.query as { pages?: { imageinfo?: ImageInfo[] }[] })?.pages?.[0]?.imageinfo?.[0];
    const src = trustedUrl(image?.thumburl, ["upload.wikimedia.org", "thumb.wikimedia.org"], "/wikipedia/commons/");
    const source = trustedUrl(image?.descriptionurl, ["commons.wikimedia.org"], "/wiki/File:");
    const licenseUrl = trustedUrl(image?.extmetadata?.LicenseUrl?.value, ["creativecommons.org"], "/");
    const license = image?.extmetadata?.LicenseShortName?.value;
    const credit = image?.extmetadata?.Artist?.value;
    const author = typeof credit === "string" ? credit.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() : "";
    if (!src || !source || typeof license !== "string" || !license.trim()) return null;
    if (license !== "Public domain" && (!licenseUrl || !author)) return null;
    // The source file page carries the full credit, including any linked author names.
    src.search = "";
    return { src: src.href, source: source.href, author, license, licenseUrl: licenseUrl?.href };
  });
}
