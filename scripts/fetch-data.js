
const { ApifyClient } = require('apify-client');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const client = new ApifyClient({ token: process.env.APIFY_API_TOKEN });
const BOKABORD_ACTOR_ID = process.env.BOKABORD_ACTOR_ID || 'receptional_difference/bokabord-stockholm';
// Fresh future date each run so neighbourhood search URLs never go stale.
function futureDateTime() {
  const d = new Date();
  d.setHours(19, 0, 0, 0);
  if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T19:00:00`;
}
// A self-refreshing OpenTable neighbourhood search URL from lat/lng.
function areaUrl(name, lat, lng) {
  const params = new URLSearchParams({
    dateTime: futureDateTime(),
    covers: '2',
    latitude: String(lat),
    longitude: String(lng),
    searchCenterType: 'neighborhood',
    searchedLocationName: name,
    shouldUseLatLongSearch: 'false',
    originCorrelationId: crypto.randomUUID()
  });
  return `https://www.opentable.co.uk/s?${params.toString()}`;
}
// Each area is scraped SEPARATELY so every borough is guaranteed its own pull.
const AREAS = [
  { label: 'Central London', url: 'https://www.opentable.co.uk/london-restaurants',        want: 1000 },
  { label: 'Battersea',      url: areaUrl('Battersea',  51.4730, -0.1541),                 want: 300 },
  { label: 'Nine Elms',      url: areaUrl('Nine Elms',  51.4800, -0.1300),                 want: 300 },
  { label: 'Chelsea',        url: areaUrl('Chelsea',    51.4883, -0.1697),                 want: 300 },
  { label: 'Fulham',         url: areaUrl('Fulham',     51.4778, -0.2047),                 want: 300 },
  { label: 'Clapham',        url: areaUrl('Clapham',    51.4620, -0.1380),                 want: 300 },
  { label: 'Putney',         url: areaUrl('Putney',     51.4610, -0.2160),                 want: 300 },
  { label: 'Victoria',       url: 'https://www.opentable.co.uk/landmark/restaurants-near-victoria-station', want: 300 }
];
async function scrapeArea(area) {
  try {
    console.log(`\n--- Scraping ${area.label} ---`);
    const run = await client.actor('shahidirfan/opentable-scraper').call({
      startUrls: [{ url: area.url }],
      results_wanted: area.want,
      max_pages: 25,
      proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] }
    }, { timeout: 900, waitSecs: 900 });
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    console.log(`${area.label}: ${items.length} raw results`);
    return items;
  } catch (err) {
    console.error(`${area.label} failed (skipping):`, err.message);
    return []; // one area failing must not break the whole file
  }
}
async function scrapeBokabord() {
  try {
    console.log('\n--- Scraping Stockholm via Bokabord ---');
    const run = await client.actor(BOKABORD_ACTOR_ID).call({
      startUrl: 'https://www.bokabord.se/restauranger/stockholm',
      maxPages: 20,
      maxResults: 750,
      proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] }
    });
    const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: 1000 });
    console.log('Stockholm: ' + items.length + ' raw Bokabord results');
    return { ok: true, items };
  } catch (err) {
    console.error('Stockholm Bokabord refresh failed (preserving existing records):', err.message);
    return { ok: false, items: [] };
  }
}
function normalizeBokabord(items) {
  const venues = [];
  const seen = new Set();
  for (const item of items) {
    if (!item || !item.name || !item.bookingUrl) continue;
    const key = String(item.bookingUrl).trim().toLowerCase().replace(/\/+$/, '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    venues.push({
      id: item.id || undefined,
      name: item.name,
      address: item.address || '',
      city: item.city || 'Stockholm',
      cuisine: item.cuisine || '',
      image: item.image || '',
      phone: item.phone || '',
      timeSlots: Array.isArray(item.timeSlots) ? item.timeSlots : [],
      bookingUrl: item.bookingUrl,
      menuUrl: item.menuUrl || null,
      provider: 'bokabord',
      source: 'bokabord.se'
    });
  }
  return venues;
}
function isBokabord(venue) {
  return [venue && venue.source, venue && venue.provider, venue && venue.bookingUrl, venue && venue.url]
    .some(value => String(value || '').toLowerCase().includes('bokabord'));
}
async function run() {
  try {
    console.log('Fetching live venue data from Apify per area (shahidirfan/opentable-scraper)...');
    // Run all areas in parallel, then merge.
    const [areaResults, bokabordRefresh] = await Promise.all([
      Promise.all(AREAS.map(scrapeArea)),
      scrapeBokabord()
    ]);
    const allItems = areaResults.flat();
    const seen = new Set();
    const processedVenues = [];
    for (const item of allItems) {
      if (!item || !item.name) continue;
      const key = String(item.restaurantId || item.id || item.name).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      processedVenues.push({
        id: item.restaurantId || item.id,
        name: item.name,
        address: item.address || '',
        cuisine: item.cuisine || '',
        rating: item.rating || null,
        reviewCount: item.reviewCount || null,
        image: item.profileImage || '',
        phone: item.phoneNumber || '',
        timeSlots: [],
        bookingUrl: item.url || '',
        menuUrl: null,
        provider: 'opentable',
        source: 'opentable.co.uk'
      });
    }
    const refreshedBokabordVenues = normalizeBokabord(bokabordRefresh.items);
    const useBokabordRefresh = bokabordRefresh.ok && refreshedBokabordVenues.length > 0;
    const outputPath = path.join(process.cwd(), 'venues.json');
      let existingVenues = [];
      try {
        const parsed = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
        existingVenues = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.venues) ? parsed.venues : []);
      } catch (error) {
        if (error.code !== 'ENOENT') console.warn('Could not read existing venues.json:', error.message);
      }
      const isOpenTable = venue => [venue && venue.source, venue && venue.bookingUrl, venue && venue.url]
        .some(value => String(value || '').toLowerCase().includes('opentable'));
      const recordKey = venue => {
        const bookingUrl = String((venue && (venue.bookingUrl || venue.url)) || '').trim().toLowerCase().replace(/\/+$/, '');
        if (bookingUrl) return 'url:' + bookingUrl;
        const stableId = String((venue && (venue.id || venue.restaurantId || venue.placeId || venue.googlePlaceId)) || '').trim().toLowerCase();
        if (stableId) return 'id:' + stableId;
        const normal = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
        return 'name:' + normal(venue && venue.name) + '|address:' + normal(venue && venue.address);
      };
      const preservedVenues = existingVenues.filter(venue => !isOpenTable(venue) && !(useBokabordRefresh && isBokabord(venue)));
      const mergedVenues = [];
      const mergedKeys = new Set();
      for (const venue of [...processedVenues, ...(useBokabordRefresh ? refreshedBokabordVenues : []), ...preservedVenues]) {
        if (!venue || !venue.name) continue;
        const key = recordKey(venue);
        if (mergedKeys.has(key)) continue;
        mergedKeys.add(key);
        mergedVenues.push(venue);
      }
      fs.writeFileSync(outputPath, JSON.stringify(mergedVenues, null, 2));
      console.log(
        '\nSaved ' + processedVenues.length + ' refreshed OpenTable venues, ' +
        (useBokabordRefresh ? refreshedBokabordVenues.length + ' refreshed Bokabord venues, ' : 'preserved the prior Bokabord records, ') +
        'and preserved ' + preservedVenues.length + ' other venues (' + mergedVenues.length + ' total) to ' + outputPath
      );
      if (mergedVenues[0]) {
        console.log('Sample venue:', JSON.stringify(mergedVenues[0], null, 2));
      }
      } catch (error) {
    console.error('Error fetching data from Apify:', error);
    process.exit(1);
  }
}
run();
