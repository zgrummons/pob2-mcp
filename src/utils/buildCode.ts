/**
 * Path of Building build-code helpers.
 *
 * A PoB export code is base64(zlib-deflate(buildXml)), using URL-safe base64
 * (`-`/`_`). Share sites (pobb.in, pastebin) host that code at a raw endpoint.
 */
import zlib from "node:zlib";

const MAX_CODE_BYTES = 4 * 1024 * 1024; // 4MB guard for fetched codes
const MAX_XML_BYTES = 16 * 1024 * 1024; // 16MB guard for decoded XML

/** Decode a PoB export code into build XML. */
export function decodePobCode(code: string): string {
  const cleaned = (code || "").trim().replace(/\s+/g, "");
  if (!cleaned) throw new Error("empty build code");
  // Normalize URL-safe base64 to standard base64.
  const b64 = cleaned.replace(/-/g, "+").replace(/_/g, "/");
  let buf: Buffer;
  try {
    buf = Buffer.from(b64, "base64");
  } catch (e) {
    throw new Error(`build code is not valid base64: ${(e as Error).message}`);
  }
  if (buf.length === 0) throw new Error("build code decoded to empty data");

  // PoB codes are zlib-deflated; fall back to raw-deflate / gzip just in case.
  const attempts: Array<(b: Buffer) => Buffer> = [
    zlib.inflateSync,
    zlib.inflateRawSync,
    zlib.gunzipSync,
  ];
  for (const inflate of attempts) {
    try {
      const xml = inflate(buf);
      if (xml.length > MAX_XML_BYTES) throw new Error("decoded build XML exceeds size limit");
      const text = xml.toString("utf8");
      if (text.includes("<PathOfBuilding")) return text;
    } catch {
      /* try next strategy */
    }
  }
  throw new Error("failed to decode build code (not a valid PoB export code)");
}

/**
 * If `source` is a share URL (pobb.in / pastebin), rewrite it to the raw code
 * endpoint. Otherwise return it unchanged.
 */
export function rawUrlFor(source: string): string {
  const u = source.trim();
  const pobb = u.match(/^https?:\/\/pobb\.in\/([A-Za-z0-9_-]+)\/?$/i);
  if (pobb) return `https://pobb.in/${pobb[1]}/raw`;
  const pastebin = u.match(/^https?:\/\/pastebin\.com\/(?!raw\/)([A-Za-z0-9]+)\/?$/i);
  if (pastebin) return `https://pastebin.com/raw/${pastebin[1]}`;
  return u;
}

/** Fetch a build code from a share URL (browser-like UA; bot filters block plain UAs). */
export async function fetchBuildCode(url: string): Promise<string> {
  if (!/^https?:\/\//i.test(url)) throw new Error("not an http(s) URL");
  const target = rawUrlFor(url);
  const res = await fetch(target, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; pob2-mcp-server)", Accept: "*/*" },
  });
  if (!res.ok) throw new Error(`failed to fetch build (${res.status}) from ${target}`);
  const text = await res.text();
  if (text.length > MAX_CODE_BYTES) throw new Error("fetched build code exceeds size limit");
  return text.trim();
}

/**
 * Resolve a source (raw PoB code OR a share URL) into build XML.
 */
export async function resolveBuildXml(source: string): Promise<string> {
  const s = (source || "").trim();
  if (!s) throw new Error("missing build source");
  const code = /^https?:\/\//i.test(s) ? await fetchBuildCode(s) : s;
  return decodePobCode(code);
}
