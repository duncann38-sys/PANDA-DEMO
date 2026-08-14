const { ApifyClient } = require('apify-client');
const fs = require('fs');
const path = require('path');

const client = new ApifyClient({ token: process.env.APIFY_API_TOKEN });

// Normalise whatever the OpenTable actor returns into [{ time, url }],
// which is exactly the shape the Panda app reads.
function normalizeSlots(item) {
  const raw = item.timeSlots || item.availability || item.slots || [];
  if (!Array.isArray(raw)) return [];
  return raw
    .map(s => {
      if (typeof s === 'string') {
        return { time: s, url: item.url || item.bookingLink || item.bookingUrl || '' };
      }
      return {
        time: s.time || s.slot || s.label || '',
        url: s.url || s.bookingUrl || s.link || item.url || item.bookingLink || ''
      };
    })
    .filter(s => s.time);
}

async function run() {
  try {
    console.log('Fetching live venue data from Apify...');
    const run = await client.actor('canadesk/opentable').call({
      search: 'London',
      maxItems: 20
    });
    console.log(`Actor run finished. Dataset: ${run.defaultDatasetId}`);

    const { items } = await client.dataset(run.defaultDatasetId).listItems();

    const processedVenues = items.map(item => ({
      id: item.id || item.restaurantId,
      name: item.name,
      location: item.location || item.address,
      cuisine: item.cuisine,
      image: item.image || item.photoUrl,
      timeSlots: normalizeSlots(item),
      bookingUrl: item.url || item.bookingLink || item.bookingUrl || '',
      menuUrl: item.menuUrl || item.menu || null
    }));

    // Write to the REPO ROOT so the app can fetch ./venues.json
    const outputPath = path.join(process.cwd(), 'venues.json');
    fs.writeFileSync(outputPath, JSON.stringify(processedVenues, null, 2));
    console.log(`Saved ${processedVenues.length} venues to ${outputPath}`);

    // Log one venue so we can verify the real field shapes in the Actions log.
    if (processedVenues[0]) {
      console.log('Sample venue:', JSON.stringify(processedVenues[0], null, 2));
    }
  } catch (error) {
    console.error('Error fetching data from Apify:', error);
    process.exit(1);
  }
}

run();
