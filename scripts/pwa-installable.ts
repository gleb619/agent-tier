/**
 * Minimal PWA installability check (Lighthouse 13 dropped its PWA category,
 * so the `web:lighthouse` gate asserts installability itself):
 *   - index.html links a webmanifest
 *   - the manifest has the installable fields (name, display, start_url,
 *     192px + 512px icons) and every icon src serves a real image
 *   - /sw.js serves a service worker script (fetch handler + precache)
 *
 * Network access is injected (`fetchImpl`) so the whole check is unit-testable.
 */

export interface InstallableResult {
  ok: boolean;
  failures: string[];
  checks: string[];
}

type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  headers: HeadersLike;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

interface HeadersLike {
  get(name: string): string | null;
}

interface ManifestIcon {
  src: string;
  sizes?: string;
  type?: string;
  purpose?: string;
}

interface WebManifest {
  name?: string;
  short_name?: string;
  start_url?: string;
  scope?: string;
  display?: string;
  icons?: ManifestIcon[];
}

function hasSize(icon: ManifestIcon, px: number): boolean {
  return (icon.sizes ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .some((s) => s === `${px}x${px}`);
}

export async function checkInstallable(baseUrl: string, fetchImpl: FetchLike): Promise<InstallableResult> {
  const failures: string[] = [];
  const checks: string[] = [];
  const origin = baseUrl.replace(/\/$/, "");

  const get = async (url: string) => {
    try {
      return await fetchImpl(url);
    } catch (err) {
      failures.push(`GET ${url}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  };

  const htmlRes = await get(`${origin}/`);
  if (!htmlRes) return { ok: false, failures, checks };
  if (!htmlRes.ok) {
    return { ok: false, failures: [`GET / → ${htmlRes.status}`], checks };
  }
  const html = await htmlRes.text();
  const manifestHref =
    /rel=["']manifest["'][^>]*href=["']([^"']+)["']/.exec(html)?.[1] ??
    /href=["']([^"']+)["'][^>]*rel=["']manifest["']/.exec(html)?.[1];
  if (!manifestHref) {
    failures.push('index.html has no <link rel="manifest">');
  } else {
    checks.push(`manifest linked: ${manifestHref}`);
  }

  let manifest: WebManifest | null = null;
  if (manifestHref) {
    const url = new URL(manifestHref, origin).toString();
    const res = await get(url);
    if (!res) {
      // failure already recorded
    } else if (!res.ok) {
      failures.push(`GET ${manifestHref} → ${res.status}`);
    } else {
      try {
        manifest = JSON.parse(await res.text()) as WebManifest;
      } catch {
        failures.push(`GET ${manifestHref}: invalid JSON`);
      }
    }
  }

  if (manifest) {
    if (!manifest.name && !manifest.short_name) failures.push("manifest: missing name/short_name");
    else checks.push("manifest name present");

    const display = manifest.display ?? "browser";
    if (!["standalone", "minimal-ui", "fullscreen"].includes(display)) {
      failures.push(`manifest: display "${display}" is not installable`);
    } else {
      checks.push(`manifest display: ${display}`);
    }

    if (!manifest.start_url) failures.push("manifest: missing start_url");
    else checks.push("manifest start_url present");

    const icons = manifest.icons ?? [];
    for (const px of [192, 512]) {
      const hit = icons.find((i) => hasSize(i, px));
      if (!hit) {
        failures.push(`manifest: no ${px}px icon`);
        continue;
      }
      const iconUrl = new URL(hit.src, origin).toString();
      const res = await get(iconUrl);
      if (!res) continue;
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok) {
        failures.push(`icon ${hit.src} → ${res.status}`);
      } else if (!(type.startsWith("image/") || type === "application/octet-stream")) {
        failures.push(`icon ${hit.src}: not an image (content-type: ${type})`);
      } else {
        checks.push(`icon ${px}px serves (${type})`);
      }
    }
  }

  const swRes = await get(`${origin}/sw.js`);
  if (!swRes) {
    // failure already recorded
  } else if (!swRes.ok) {
    failures.push(`GET /sw.js → ${swRes.status}`);
  } else {
    const sw = await swRes.text();
    if (!sw.includes('addEventListener("fetch"') && !sw.includes("addEventListener('fetch'")) {
      failures.push("/sw.js: no fetch handler");
    } else if (!sw.includes("caches")) {
      failures.push("/sw.js: no cache usage (precache missing?)");
    } else {
      checks.push("service worker has fetch handler + cache");
    }
  }

  return { ok: failures.length === 0, failures, checks };
}
