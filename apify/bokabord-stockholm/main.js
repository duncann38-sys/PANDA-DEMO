import { Actor } from "apify";
import { chromium } from "playwright";

const DEFAULT_START_URL =
  "https://www.bokabord.se/restauranger/stockholm";
const DEFAULT_MAX_PAGES = 20;
const DEFAULT_MAX_RESULTS = 750;
const CARD_SELECTOR = 'a[href*="/restaurang/"]';
const CUISINE_TAGS = new Set(
  [
    "Afrikanskt",
    "Amerikanskt",
    "Asiatiskt",
    "Brittiskt",
    "Centraleuropeiskt",
    "Franskt",
    "Grekiskt",
    "Internationellt",
    "Italienskt",
    "Japanskt",
    "Kinesiskt",
    "Koreanskt",
    "Libanesiskt",
    "Mexikanskt",
    "Nordiskt",
    "Palestinskt",
    "Persiskt",
    "Spanskt",
    "Svenskt",
    "Sydamerikanskt",
    "Sydeuropeiskt",
    "Thailändskt",
    "Tyskt",
    "Ukrainskt",
    "Vietnamesiskt",
  ].map((tag) => tag.toLocaleLowerCase("sv-SE")),
);

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function clampInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function pageUrl(startUrl, pageNumber) {
  const url = new URL(startUrl);
  if (pageNumber <= 1) url.searchParams.delete("paged");
  else url.searchParams.set("paged", String(pageNumber));
  return url.href;
}

function venueKey(venue) {
  if (venue.bookingUrl) {
    return `url:${venue.bookingUrl.toLowerCase().replace(/\/+$/, "")}`;
  }
  return `name:${venue.name.toLowerCase()}|address:${venue.address.toLowerCase()}`;
}

function bookingId(bookingUrl) {
  try {
    const slug = new URL(bookingUrl).pathname
      .split("/")
      .filter(Boolean)
      .at(-1);
    return slug ? `bokabord:${slug}` : "";
  } catch {
    return "";
  }
}

async function extractPage(page) {
  const rawVenues = await page.locator(CARD_SELECTOR).evaluateAll((anchors) =>
    anchors.map((anchor) => {
      const href = anchor.href || anchor.getAttribute("href") || "";
      const name =
        anchor.querySelector("p.font-medium")?.textContent ||
        anchor.querySelector('img[alt]')?.getAttribute("alt") ||
        "";
      const address =
        anchor.querySelector("p.opacity-60")?.textContent ||
        anchor.querySelector("p + p")?.textContent ||
        "";
      const tags = Array.from(
        anchor.querySelectorAll('[class*="whitespace-nowrap"]'),
      )
        .map((node) => node.textContent || "")
        .filter(Boolean);
      const image =
        anchor.querySelector('img[class*="object-cover"]')?.getAttribute("src") ||
        "";
      return { href, name, address, tags, image };
    }),
  );

  return rawVenues
    .map((raw) => {
      const bookingUrl = new URL(raw.href, page.url()).href;
      const tags = raw.tags.map(normalizeText).filter(Boolean);
      const cuisine =
        tags.find((tag) =>
          CUISINE_TAGS.has(tag.toLocaleLowerCase("sv-SE")),
        ) || "";
      return {
        id: bookingId(bookingUrl),
        name: normalizeText(raw.name),
        cuisine,
        address: normalizeText(raw.address),
        bookingUrl,
        city: "Stockholm",
        provider: "bokabord",
        source: "bokabord.se",
        image: normalizeText(raw.image),
        timeSlots: [],
        menuUrl: null,
      };
    })
    .filter(
      (venue) =>
        venue.name &&
        venue.address &&
        /^https:\/\/www\.bokabord\.se\/restaurang\/[^/?#]+/i.test(
          venue.bookingUrl,
        ),
    );
}

await Actor.init();

let browser;
try {
  const input = (await Actor.getInput()) || {};
  const startUrl = normalizeText(input.startUrl) || DEFAULT_START_URL;
  const parsedStartUrl = new URL(startUrl);
  if (
    parsedStartUrl.hostname !== "www.bokabord.se" ||
    parsedStartUrl.pathname !== "/restauranger/stockholm"
  ) {
    throw new Error(
      "startUrl must be the official Bokabord Stockholm listings page.",
    );
  }

  const maxPages = clampInteger(
    input.maxPages,
    DEFAULT_MAX_PAGES,
    1,
    DEFAULT_MAX_PAGES,
  );
  const maxResults = clampInteger(
    input.maxResults,
    DEFAULT_MAX_RESULTS,
    1,
    DEFAULT_MAX_RESULTS,
  );
  const proxyConfiguration = input.proxyConfiguration
    ? await Actor.createProxyConfiguration(input.proxyConfiguration)
    : null;
  const proxyUrl = proxyConfiguration
    ? await proxyConfiguration.newUrl()
    : null;
  const parsedProxyUrl = proxyUrl ? new URL(proxyUrl) : null;

  browser = await chromium.launch({
    headless: true,
    proxy: parsedProxyUrl
      ? {
          server: `${parsedProxyUrl.protocol}//${parsedProxyUrl.host}`,
          username: decodeURIComponent(parsedProxyUrl.username),
          password: decodeURIComponent(parsedProxyUrl.password),
        }
      : undefined,
  });
  const page = await browser.newPage({
    locale: "sv-SE",
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  });
  page.setDefaultTimeout(30_000);

  const venues = [];
  const seen = new Set();
  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    const url = pageUrl(startUrl, pageNumber);
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    if (!response || !response.ok()) {
      throw new Error(
        `Bokabord page ${pageNumber} returned ${response?.status() || "no response"}.`,
      );
    }

    await page.waitForSelector(CARD_SELECTOR);
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    const pageVenues = await extractPage(page);
    let added = 0;
    for (const venue of pageVenues) {
      const key = venueKey(venue);
      if (seen.has(key)) continue;
      seen.add(key);
      venues.push(venue);
      added += 1;
      if (venues.length >= maxResults) break;
    }

    console.log(
      `Bokabord page ${pageNumber}: ${pageVenues.length} found, ${added} new.`,
    );
    if (
      venues.length >= maxResults ||
      pageVenues.length === 0 ||
      added === 0
    ) {
      break;
    }
  }

  if (venues.length === 0) {
    throw new Error("Bokabord returned no Stockholm venues.");
  }

  await Actor.pushData(venues);
  console.log(`Saved ${venues.length} Bokabord Stockholm venues.`);
} finally {
  await browser?.close();
}

await Actor.exit();