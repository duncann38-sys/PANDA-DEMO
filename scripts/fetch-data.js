
const { ApifyClient } = require('apify-client');
const fs = require('fs');
const path = require('path');

const client = new ApifyClient({ token: process.env.APIFY_API_TOKEN });

async function run() {
  try {
    console.log('Fetching live venue data from Apify (shahidirfan/opentable-scraper)...');

    // Input matches the exact keys the actor expects (from a verified console run).
    const run = await client.actor('shahidirfan/opentable-scraper').call({
      startUrls: [
        { url: 'https://www.opentable.co.uk/london-restaurants' }
      ],
      results_wanted: 40,
      max_pages: 3,
      proxyConfiguration: {
        useApifyProxy: true,
        apifyProxyGroups: ['RESIDENTIAL']
      }
    });

    console.log(`Actor run finished. Dataset: ${run.defaultDatasetId}`);
    const { items } = await client.dataset(run.defaultDatasetId).listItems();

    const processedVenues = items
      .filter(item => item && item.name)
      .map(item => ({
        id: item.restaurantId || item.id,
        name: item.name,
        address: item.address || '',
        cuisine: item.cuisine || '',
        rating: item.rating || null,
        reviewCount: item.reviewCount || null,
        image: item.profileImage || '',
        phone: item.phoneNumber || '',
        // No live time slots from this scraper: the OpenTable page URL powers
        // the "Book on OpenTable" button in the app.
        timeSlots: [],
        bookingUrl: item.url || '',
        menuUrl: null
      }));

    const outputPath = path.join(process.cwd(), 'venues.json');
    fs.writeFileSync(outputPath, JSON.stringify(processedVenues, null, 2));
    console.log(`Saved ${processedVenues.length} venues to ${outputPath}`);
    if (processedVenues[0]) {
      console.log('Sample venue:', JSON.stringify(processedVenues[0], null, 2));
    }
  } catch (error) {
    console.error('Error fetching data from Apify:', error);
    process.exit(1);
  }
}

run();
