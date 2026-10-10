// Streetprint data build: fetches OSM street networks from Overpass for a curated list of crops,
// projects/clips/simplifies them and writes public/data/streets/{index.json,cities.json,p/<n>.json}.
//
//   node scripts/build-streets.mjs            fetch missing crops (cached in data-raw/streets/), then build
//   node scripts/build-streets.mjs --offline  build from the cache only, never touch the network
//   node scripts/build-streets.mjs --limit=20 only process the first N candidate crops (testing)
//
// Raw Overpass responses are cached gzipped in data-raw/streets/overpass/, so re-runs do not refetch.
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, statSync, createReadStream } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const ROOT = new URL('../', import.meta.url);
const RAW = new URL('data-raw/', ROOT);
const RAW_S = new URL('data-raw/streets/', ROOT);
const CACHE = new URL('data-raw/streets/overpass/', ROOT);
const OUT = new URL('public/data/streets/', ROOT);
const ARGS = process.argv.slice(2);
const OFFLINE = ARGS.includes('--offline');
const LIMIT = Number((ARGS.find((a) => a.startsWith('--limit=')) || '').split('=')[1]) || Infinity;
const ONLY = (ARGS.find((a) => a.startsWith('--only=')) || '').split('=')[1] || null;

// Main instance first; mirrors are used while it cools down or fails. All requests are GET.
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const UA = 'Meridian-Streetprint-build/1.0 (static daily geography puzzle; one-off offline build, cached)';
const PAUSE_MS = 3500;
const QUERY_VERSION = 'v1';

const HALF = 1500; // 3 km crop
const HALF_Z = 5000; // 10 km context view
const MIN_WAYS = 150;
const TARGET_PUZZLES = 365;
const SEED = 0x5713e7;

// ---------------------------------------------------------------------------------------------
// Curated cities: [geonames name, country code, [[lat, lon], ...crop centres], options]
// The first centre is the most characteristic district. Options: minWays (small towns),
// foot (also count footways: car-free cities like Venice), alt (extra GeoNames name to match).
// ---------------------------------------------------------------------------------------------
const CITIES = [
  ['Barcelona', 'ES', [[41.3916, 2.1649], [41.4030, 2.1560], [41.4040, 2.1960], [41.3800, 2.1700]]],
  ['New York City', 'US', [[40.7549, -73.9840], [40.7200, -73.9990], [40.6760, -73.9800], [40.8060, -73.9500]]],
  ['Paris', 'FR', [[48.8650, 2.3330], [48.8738, 2.2950], [48.8560, 2.3680], [48.8400, 2.3200]]],
  ['Washington', 'US', [[38.9000, -77.0330], [38.8890, -77.0000], [38.9250, -77.0350]]],
  ['La Plata', 'AR', [[-34.9215, -57.9545], [-34.9050, -57.9400]]],
  ['Brasília', 'BR', [[-15.7940, -47.8825], [-15.8150, -47.9050], [-15.7680, -47.8850]]],
  ['Chandigarh', 'IN', [[30.7410, 76.7850], [30.7180, 76.7700]]],
  ['Palmanova', 'IT', [[45.9056, 13.3100]], { minWays: 40 }],
  ['Savannah', 'US', [[32.0760, -81.0920], [32.0560, -81.0950]]],
  ['Adelaide', 'AU', [[-34.9285, 138.6007], [-34.9050, 138.5960]]],
  ['Amsterdam', 'NL', [[52.3700, 4.8900], [52.3560, 4.9150], [52.3640, 4.8600]]],
  ['Venice', 'IT', [[45.4375, 12.3310]], { foot: true }],
  ['Kyoto', 'JP', [[35.0050, 135.7620], [35.0280, 135.7500], [34.9900, 135.7550]]],
  ['Mannheim', 'DE', [[49.4875, 8.4660], [49.4780, 8.4950]]],
  ['Karlsruhe', 'DE', [[49.0100, 8.4040], [49.0050, 8.3780]]],
  ['Salt Lake City', 'US', [[40.7608, -111.8910], [40.7450, -111.8650]]],
  ['Chicago', 'US', [[41.8800, -87.6320], [41.9080, -87.6770], [41.8000, -87.6100], [41.9250, -87.6500]]],
  ['Melbourne', 'AU', [[-37.8136, 144.9631], [-37.7980, 144.9800], [-37.8640, 144.9850]]],
  ['Buenos Aires', 'AR', [[-34.6037, -58.3816], [-34.5880, -58.4300], [-34.6230, -58.4450]]],
  ['Mexico City', 'MX', [[19.4326, -99.1332], [19.4120, -99.1700], [19.3880, -99.1600]]],
  ['Moscow', 'RU', [[55.7540, 37.6200], [55.7300, 37.5800], [55.7820, 37.6400]]],
  ['Istanbul', 'TR', [[41.0100, 28.9650], [41.0360, 28.9800], [40.9900, 29.0280], [41.0650, 28.9950]]],
  ['Cairo', 'EG', [[30.0444, 31.2400], [30.0430, 31.2650], [30.0900, 31.3250]]],
  ['Tokyo', 'JP', [[35.6812, 139.7671], [35.6900, 139.7000], [35.7120, 139.7960], [35.6580, 139.7020]]],
  ['Beijing', 'CN', [[39.9130, 116.3970], [39.9400, 116.3850], [39.9050, 116.4600]]],
  ['Philadelphia', 'US', [[39.9526, -75.1652], [39.9300, -75.1600], [39.9800, -75.1550]]],
  ['San Francisco', 'US', [[37.7900, -122.4100], [37.7600, -122.4300], [37.7780, -122.4800]]],
  ['Lisbon', 'PT', [[38.7140, -9.1390], [38.7370, -9.1450]]],
  ['Budapest', 'HU', [[47.4980, 19.0550], [47.5080, 19.0780], [47.4820, 19.0750]]],
  ['Vienna', 'AT', [[48.2082, 16.3719], [48.1950, 16.3450], [48.2200, 16.3950]]],
  ['Rome', 'IT', [[41.8990, 12.4770], [41.9080, 12.4600], [41.8920, 12.5100]]],
  ['Saint Petersburg', 'RU', [[59.9343, 30.3351], [59.9250, 30.3100], [59.9620, 30.3100]]],
  ['Edinburgh', 'GB', [[55.9533, -3.1950], [55.9400, -3.2050]]],
  ['Copenhagen', 'DK', [[55.6800, 12.5700], [55.6930, 12.5500]]],
  ['Marrakesh', 'MA', [[31.6295, -7.9850], [31.6370, -8.0120]]],
  ['Fes', 'MA', [[34.0600, -4.9850], [34.0400, -5.0000]], { foot: true }],
  ['Jerusalem', 'IL', [[31.7767, 35.2280], [31.7700, 35.2050]]],
  ['Isfahan', 'IR', [[32.6546, 51.6680], [32.6380, 51.6700]]],
  ['Seoul', 'KR', [[37.5665, 126.9780], [37.5000, 127.0300], [37.5550, 126.9230]]],
  ['Singapore', 'SG', [[1.2900, 103.8480], [1.3050, 103.8350], [1.3120, 103.8850]]],
  ['Hong Kong', 'HK', [[22.2810, 114.1600], [22.3150, 114.1700]]],
  ['Nairobi', 'KE', [[-1.2864, 36.8200], [-1.2650, 36.8050]]],
  ['Cape Town', 'ZA', [[-33.9249, 18.4241], [-33.9300, 18.4650]]],
  ['Lagos', 'NG', [[6.4550, 3.3900], [6.5000, 3.3700]]],
  ['Sydney', 'AU', [[-33.8700, 151.2070], [-33.8900, 151.2150], [-33.8900, 151.1800]]],
  ['Toronto', 'CA', [[43.6510, -79.3830], [43.6560, -79.4250], [43.6900, -79.3950]]],
  ['Montréal', 'CA', [[45.5080, -73.5700], [45.5250, -73.5800], [45.5450, -73.6100]], { alt: 'Montreal' }],
  ['Vancouver', 'CA', [[49.2827, -123.1207], [49.2620, -123.1000], [49.2500, -123.1550]]],
  ['Havana', 'CU', [[23.1370, -82.3600], [23.1350, -82.3900]]],
  ['Lima', 'PE', [[-12.0464, -77.0428], [-12.1200, -77.0300], [-12.0850, -77.0400]]],
  ['Bogotá', 'CO', [[4.6000, -74.0750], [4.6500, -74.0600], [4.6230, -74.1000]]],
  ['Santiago', 'CL', [[-33.4378, -70.6504], [-33.4250, -70.6100], [-33.4650, -70.6500]]],
  ['Rio de Janeiro', 'BR', [[-22.9068, -43.1800], [-22.9711, -43.1850], [-22.9200, -43.2300]]],
  ['São Paulo', 'BR', [[-23.5475, -46.6361], [-23.5620, -46.6600], [-23.5350, -46.6800]]],
  ['Mumbai', 'IN', [[18.9400, 72.8350], [19.0170, 72.8450], [19.0600, 72.8400]]],
  ['Delhi', 'IN', [[28.6315, 77.2167], [28.6560, 77.2300], [28.5700, 77.2400]]],
  ['Bangkok', 'TH', [[13.7500, 100.4980], [13.7450, 100.5300], [13.7320, 100.5650]]],
  ['Hanoi', 'VN', [[21.0320, 105.8500], [21.0150, 105.8350]]],
  ['Manila', 'PH', [[14.5900, 120.9850], [14.6100, 120.9900]]],
  ['Jakarta', 'ID', [[-6.1750, 106.8270], [-6.2200, 106.8300], [-6.1400, 106.8130]]],
  ['Dubai', 'AE', [[25.2650, 55.3050], [25.2000, 55.2750]]],
  ['Tehran', 'IR', [[35.6892, 51.3890], [35.7300, 51.4100], [35.7000, 51.3400]]],
  ['Baghdad', 'IQ', [[33.3400, 44.4000], [33.3100, 44.3750]]],
  ['Ankara', 'TR', [[39.9250, 32.8550], [39.9000, 32.8600], [39.9450, 32.8200]]],
  ['Athens', 'GR', [[37.9800, 23.7300], [37.9700, 23.7520], [37.9950, 23.7350]]],
  ['Berlin', 'DE', [[52.5200, 13.4050], [52.4990, 13.4200], [52.5400, 13.4150], [52.4720, 13.3300]]],
  ['Munich', 'DE', [[48.1374, 11.5755], [48.1600, 11.5800]]],
  ['Warsaw', 'PL', [[52.2297, 21.0122], [52.2500, 20.9950]]],
  ['Prague', 'CZ', [[50.0870, 14.4210], [50.0750, 14.4400]]],
  ['Kraków', 'PL', [[50.0614, 19.9366], [50.0750, 19.9150]]],
  ['Madrid', 'ES', [[40.4168, -3.7038], [40.4250, -3.6800], [40.4400, -3.7000]]],
  ['Sevilla', 'ES', [[37.3891, -5.9900], [37.3800, -5.9700]], { alt: 'Seville' }],
  ['Valencia', 'ES', [[39.4699, -0.3763], [39.4620, -0.3600]]],
  ['Milan', 'IT', [[45.4642, 9.1900], [45.4800, 9.2050]]],
  ['Turin', 'IT', [[45.0703, 7.6869], [45.0600, 7.6650]]],
  ['Naples', 'IT', [[40.8480, 14.2560], [40.8380, 14.2440]]],
  ['London', 'GB', [[51.5130, -0.1100], [51.5150, -0.1550], [51.4700, -0.1650], [51.5400, -0.1000]]],
  ['Glasgow', 'GB', [[55.8610, -4.2510], [55.8720, -4.2900]]],
  ['Dublin', 'IE', [[53.3498, -6.2603], [53.3320, -6.2700]]],
  ['Oslo', 'NO', [[59.9139, 10.7522], [59.9270, 10.7600]]],
  ['Stockholm', 'SE', [[59.3326, 18.0649], [59.3150, 18.0700], [59.3420, 18.0400]]],
  ['Helsinki', 'FI', [[60.1690, 24.9410], [60.1850, 24.9500]]],
  ['Riga', 'LV', [[56.9496, 24.1052], [56.9600, 24.1250]]],
  ['Tallinn', 'EE', [[59.4370, 24.7536], [59.4300, 24.7300]]],
  ['Kyiv', 'UA', [[50.4501, 30.5234], [50.4400, 30.5000]]],
  ['Minsk', 'BY', [[53.9000, 27.5600], [53.9150, 27.5800]]],
  ['Tbilisi', 'GE', [[41.6938, 44.8015], [41.7100, 44.7900]]],
  ['Baku', 'AZ', [[40.3720, 49.8400], [40.3950, 49.8550]]],
  ['Yerevan', 'AM', [[40.1810, 44.5130], [40.1950, 44.5000]]],
  ['Almaty', 'KZ', [[43.2500, 76.9300], [43.2350, 76.9050]]],
  ['Tashkent', 'UZ', [[41.3111, 69.2797], [41.3000, 69.2500]]],
  ['Samarkand', 'UZ', [[39.6542, 66.9650]]],
  ['Kabul', 'AF', [[34.5300, 69.1700]]],
  ['Karachi', 'PK', [[24.8600, 67.0150], [24.8200, 67.0400]]],
  ['Lahore', 'PK', [[31.5800, 74.3200], [31.5550, 74.3400]]],
  ['Kolkata', 'IN', [[22.5726, 88.3639], [22.5400, 88.3550]]],
  ['Dhaka', 'BD', [[23.7150, 90.4074], [23.7900, 90.4100]]],
  ['Kathmandu', 'NP', [[27.7050, 85.3150]]],
  ['Colombo', 'LK', [[6.9271, 79.8612], [6.9000, 79.8600]]],
  ['Yangon', 'MM', [[16.7780, 96.1600], [16.8000, 96.1500]]],
  ['Kuala Lumpur', 'MY', [[3.1478, 101.6953], [3.1600, 101.7150]]],
  ['Taipei', 'TW', [[25.0420, 121.5150], [25.0400, 121.5480]]],
  ['Shanghai', 'CN', [[31.2300, 121.4750], [31.2120, 121.4500], [31.2500, 121.4500]]],
  ['Osaka', 'JP', [[34.6800, 135.5000], [34.6650, 135.5050], [34.7000, 135.4950]]],
  ['Sapporo', 'JP', [[43.0618, 141.3545], [43.0450, 141.3400]]],
  ['Pyongyang', 'KP', [[39.0300, 125.7500]]],
  ['Ulaanbaatar', 'MN', [[47.9180, 106.9170]]],
  ['Auckland', 'NZ', [[-36.8485, 174.7633], [-36.8700, 174.7750]]],
  ['Wellington', 'NZ', [[-41.2865, 174.7762]]],
  ['Honolulu', 'US', [[21.2900, -157.8300], [21.3100, -157.8600]]],
  ['Los Angeles', 'US', [[34.0480, -118.2500], [34.0950, -118.3300], [34.0300, -118.3400]]],
  ['Las Vegas', 'US', [[36.1150, -115.1700], [36.1700, -115.1400]]],
  ['Phoenix', 'US', [[33.4484, -112.0740], [33.5000, -112.0700]]],
  ['Houston', 'US', [[29.7600, -95.3700], [29.7450, -95.3950]]],
  ['New Orleans', 'US', [[29.9580, -90.0650], [29.9300, -90.0900]]],
  ['Miami', 'US', [[25.7750, -80.1950], [25.7650, -80.2200]]],
  ['Atlanta', 'US', [[33.7550, -84.3900], [33.7800, -84.3800]]],
  ['Boston', 'US', [[42.3550, -71.0650], [42.3420, -71.0800]]],
  ['Detroit', 'US', [[42.3314, -83.0458], [42.3600, -83.0700]]],
  ['Denver', 'US', [[39.7400, -104.9900], [39.7450, -104.9600]]],
  ['Seattle', 'US', [[47.6062, -122.3321], [47.6230, -122.3200]]],
  ['Portland', 'US', [[45.5200, -122.6780], [45.5200, -122.6500]]],
  ['Minneapolis', 'US', [[44.9778, -93.2650], [44.9500, -93.2800]]],
  ['Ottawa', 'CA', [[45.4215, -75.6972], [45.4050, -75.6900]]],
  ['Québec', 'CA', [[46.8120, -71.2150]], { alt: 'Quebec' }],
  ['Guatemala City', 'GT', [[14.6349, -90.5069], [14.6050, -90.5150]]],
  ['Panamá', 'PA', [[8.9824, -79.5199], [8.9700, -79.5350]], { alt: 'Panama City' }],
  ['Caracas', 'VE', [[10.5000, -66.9167], [10.4950, -66.8600]]],
  ['Quito', 'EC', [[-0.2200, -78.5125], [-0.1950, -78.4950]]],
  ['La Paz', 'BO', [[-16.5000, -68.1300]]],
  ['Montevideo', 'UY', [[-34.9060, -56.1900], [-34.9000, -56.1600]]],
  ['Asunción', 'PY', [[-25.2850, -57.6350]]],
  ['Belo Horizonte', 'BR', [[-19.9220, -43.9380], [-19.9350, -43.9300]]],
  ['Dakar', 'SN', [[14.6750, -17.4400]]],
  ['Accra', 'GH', [[5.5550, -0.2050]]],
  ['Addis Ababa', 'ET', [[9.0300, 38.7450], [9.0100, 38.7600]]],
  ['Kinshasa', 'CD', [[-4.3250, 15.3150]]],
  ['Luanda', 'AO', [[-8.8250, 13.2400]]],
  ['Johannesburg', 'ZA', [[-26.2041, 28.0473], [-26.1880, 28.0300]]],
  ['Harare', 'ZW', [[-17.8300, 31.0500]]],
  ['Dar es Salaam', 'TZ', [[-6.8160, 39.2850]]],
  ['Khartoum', 'SD', [[15.5950, 32.5300]]],
  ['Tunis', 'TN', [[36.8000, 10.1800]]],
  ['Algiers', 'DZ', [[36.7700, 3.0550]]],
  ['Casablanca', 'MA', [[33.5900, -7.6150], [33.5800, -7.6400]]],
  ['Tripoli', 'LY', [[32.8900, 13.1800]]],
  ['Beirut', 'LB', [[33.8938, 35.5050]]],
  ['Damascus', 'SY', [[33.5110, 36.3000]]],
  ['Amman', 'JO', [[31.9539, 35.9106]]],
  ['Riyadh', 'SA', [[24.6900, 46.6850], [24.6350, 46.7150]]],
  ['Doha', 'QA', [[25.2854, 51.5250]]],
  ['Muscat', 'OM', [[23.6000, 58.4300]]],
  ["Sanaa", 'YE', [[15.3540, 44.2100]], { alt: "Sana'a" }],
  // More cities with a distinctive or famous street pattern
  ['Izmir', 'TR', [[38.4237, 27.1428], [38.4400, 27.1500]]],
  ['Bursa', 'TR', [[40.1950, 29.0600]]],
  ['Hamburg', 'DE', [[53.5511, 9.9937], [53.5650, 9.9600]]],
  ['Frankfurt am Main', 'DE', [[50.1109, 8.6821]], { alt: 'Frankfurt' }],
  ['Cologne', 'DE', [[50.9375, 6.9603]]],
  ['Zürich', 'CH', [[47.3769, 8.5417]], { alt: 'Zurich' }],
  ['Geneva', 'CH', [[46.2044, 6.1432]]],
  ['Brussels', 'BE', [[50.8467, 4.3525], [50.8350, 4.3700]]],
  ['Antwerpen', 'BE', [[51.2194, 4.4025]], { alt: 'Antwerp' }],
  ['Rotterdam', 'NL', [[51.9225, 4.4792]]],
  ['Lyon', 'FR', [[45.7600, 4.8400]]],
  ['Marseille', 'FR', [[43.2965, 5.3800]]],
  ['Bordeaux', 'FR', [[44.8378, -0.5792]]],
  ['Porto', 'PT', [[41.1500, -8.6100]]],
  ['Bilbao', 'ES', [[43.2630, -2.9350]]],
  ['Florence', 'IT', [[43.7700, 11.2550]]],
  ['Bologna', 'IT', [[44.4949, 11.3426]]],
  ['Belgrade', 'RS', [[44.8150, 20.4600], [44.8050, 20.4750]]],
  ['Bucharest', 'RO', [[44.4350, 26.1000], [44.4500, 26.0900]]],
  ['Sofia', 'BG', [[42.6977, 23.3219]]],
  ['Zagreb', 'HR', [[45.8100, 15.9800]]],
  ['Ljubljana', 'SI', [[46.0530, 14.5050]]],
  ['Bratislava', 'SK', [[48.1460, 17.1077]]],
  ['Vilnius', 'LT', [[54.6872, 25.2797]]],
  ['Thessaloniki', 'GR', [[40.6350, 22.9450]]],
  ['Odesa', 'UA', [[46.4800, 30.7350]], { alt: 'Odessa' }],
  ['Manchester', 'GB', [[53.4808, -2.2426]]],
  ['Liverpool', 'GB', [[53.4084, -2.9800]]],
  ['Birmingham', 'GB', [[52.4800, -1.9000]]],
  ['Chennai', 'IN', [[13.0827, 80.2707], [13.0400, 80.2500]]],
  ['Bengaluru', 'IN', [[12.9716, 77.5946], [12.9300, 77.6200]]],
  ['Jaipur', 'IN', [[26.9220, 75.8230], [26.9100, 75.8000]]],
  ['Hyderabad', 'IN', [[17.3616, 78.4747]]],
  ['Ahmedabad', 'IN', [[23.0250, 72.5850]]],
  ["Xi'an", 'CN', [[34.2610, 108.9420], [34.2500, 108.9600]], { alt: 'Xian' }],
  ['Guangzhou', 'CN', [[23.1250, 113.2650]]],
  ['Chengdu', 'CN', [[30.6600, 104.0650]]],
  ['Nanjing', 'CN', [[32.0450, 118.7850]]],
  ['Nagoya', 'JP', [[35.1700, 136.9000], [35.1600, 136.9150]]],
  ['Hiroshima', 'JP', [[34.3950, 132.4550]]],
  ['Busan', 'KR', [[35.1000, 129.0300]]],
  ['Ho Chi Minh City', 'VN', [[10.7760, 106.7000], [10.7800, 106.6700]]],
  ['Phnom Penh', 'KH', [[11.5650, 104.9200]]],
  ['Perth', 'AU', [[-31.9523, 115.8613], [-31.9350, 115.8500]]],
  ['Brisbane', 'AU', [[-27.4698, 153.0251], [-27.4600, 153.0400]]],
  ['Christchurch', 'NZ', [[-43.5320, 172.6362]]],
  ['Edmonton', 'CA', [[53.5461, -113.4938]]],
  ['Calgary', 'CA', [[51.0447, -114.0719]]],
  ['Winnipeg', 'CA', [[49.8951, -97.1384]]],
  ['Dallas', 'US', [[32.7800, -96.8000]]],
  ['San Diego', 'US', [[32.7157, -117.1611], [32.7480, -117.1300]]],
  ['Austin', 'US', [[30.2700, -97.7431]]],
  ['Pittsburgh', 'US', [[40.4406, -79.9959]]],
  ['Baltimore', 'US', [[39.2950, -76.6150], [39.3100, -76.6000]]],
  ['St. Louis', 'US', [[38.6270, -90.2000]], { alt: 'Saint Louis' }],
  ['Kansas City', 'US', [[39.0997, -94.5786]]],
  ['Cleveland', 'US', [[41.4993, -81.6944]]],
  ['Guadalajara', 'MX', [[20.6767, -103.3475], [20.6700, -103.3700]]],
  ['Puebla', 'MX', [[19.0414, -98.2063]]],
  ['Monterrey', 'MX', [[25.6714, -100.3090]]],
  ['Medellín', 'CO', [[6.2476, -75.5658]]],
  ['Cali', 'CO', [[3.4516, -76.5320]]],
  ['Córdoba', 'AR', [[-31.4201, -64.1888]]],
  ['Rosario', 'AR', [[-32.9468, -60.6393], [-32.9550, -60.6600]]],
  ['Mendoza', 'AR', [[-32.8895, -68.8458]]],
  ['Valparaíso', 'CL', [[-33.0450, -71.6200]]],
  ['Porto Alegre', 'BR', [[-30.0330, -51.2200]]],
  ['Recife', 'BR', [[-8.0600, -34.8800]]],
  ['Salvador', 'BR', [[-12.9800, -38.5100]]],
  ['Curitiba', 'BR', [[-25.4290, -49.2671]]],
  ['Alexandria', 'EG', [[31.2000, 29.9100]]],
  ['Jeddah', 'SA', [[21.4850, 39.1900]]],
  ['Kuwait City', 'KW', [[29.3700, 47.9800]]],
  ['Abu Dhabi', 'AE', [[24.4900, 54.3700]]],
  ['San Juan', 'PR', [[18.4500, -66.0700]]],
  ['Santo Domingo', 'DO', [[18.4700, -69.9000]]],
  ['Kampala', 'UG', [[0.3150, 32.5800]]],
  ['Mombasa', 'KE', [[-4.0600, 39.6650]]],
  ['Durban', 'ZA', [[-29.8587, 31.0218]]],
  ['Abidjan', 'CI', [[5.3250, -4.0200]]],
  ['Lusaka', 'ZM', [[-15.4167, 28.2833]]],
  ['Antananarivo', 'MG', [[-18.9100, 47.5250]]],
  ['Maputo', 'MZ', [[-25.9650, 32.5800]]],
  ['Windhoek', 'NA', [[-22.5700, 17.0836]]],
  ['Bamako', 'ML', [[12.6400, -8.0000]]],
  ['Niamey', 'NE', [[13.5137, 2.1098]]],
  ['Ouagadougou', 'BF', [[12.3700, -1.5250]]],
  ['Conakry', 'GN', [[9.5400, -13.6800]]],
  ['Mogadishu', 'SO', [[2.0400, 45.3400]]],
  ['Port Louis', 'MU', [[-20.1609, 57.5012]]],
  ['Chisinau', 'MD', [[47.0245, 28.8323]]],
  ['Skopje', 'MK', [[41.9965, 21.4314]]],
  ['Tirana', 'AL', [[41.3275, 19.8187]]],
  ['Sarajevo', 'BA', [[43.8563, 18.4131]]],
  ['Reykjavík', 'IS', [[64.1466, -21.9426]], { alt: 'Reykjavik', minWays: 120 }],
  ['Bishkek', 'KG', [[42.8746, 74.6050]]],
  ['Dushanbe', 'TJ', [[38.5650, 68.7750]]],
  ['Ashgabat', 'TM', [[37.9450, 58.3800]]],
  ['Islamabad', 'PK', [[33.7150, 73.0700]]],
  ['Thimphu', 'BT', [[27.4728, 89.6393]], { minWays: 80 }],
  ['Vientiane', 'LA', [[17.9667, 102.6100]]],
  ['Cebu City', 'PH', [[10.3000, 123.9000]]],
  ['Surabaya', 'ID', [[-7.2575, 112.7400]]],
  ['Bandung', 'ID', [[-6.9150, 107.6100]]],
  ['Macau', 'MO', [[22.1950, 113.5450]], { alt: 'Macao' }],
];

// Turkish display names (shown in TR) where they differ from the English name.
const TR_NAMES = {
  'New York City': 'New York', Washington: 'Washington', Venice: 'Venedik', Moscow: 'Moskova', Cairo: 'Kahire',
  Beijing: 'Pekin', Lisbon: 'Lizbon', Vienna: 'Viyana', Rome: 'Roma', 'Saint Petersburg': 'St. Petersburg',
  Copenhagen: 'Kopenhag', Marrakesh: 'Marakeş', Fes: 'Fas', Jerusalem: 'Kudüs', Isfahan: 'İsfahan', Seoul: 'Seul',
  Singapore: 'Singapur', Lagos: 'Lagos', Havana: 'Havana', 'Mexico City': 'Meksiko', Delhi: 'Delhi',
  Tehran: 'Tahran', Baghdad: 'Bağdat', Athens: 'Atina', Munich: 'Münih', Warsaw: 'Varşova', Prague: 'Prag',
  Kraków: 'Krakov', Sevilla: 'Sevilla', Milan: 'Milano', Turin: 'Torino', Naples: 'Napoli', London: 'Londra',
  Kyiv: 'Kiev', Tbilisi: 'Tiflis', Baku: 'Bakü', Yerevan: 'Erivan', Tashkent: 'Taşkent', Samarkand: 'Semerkant',
  Karachi: 'Karaçi', Kathmandu: 'Katmandu', Damascus: 'Şam', Tripoli: 'Trablus', Algiers: 'Cezayir',
  Riyadh: 'Riyad', Muscat: 'Maskat', Sanaa: 'Sana', Khartoum: 'Hartum', 'Addis Ababa': 'Addis Ababa',
  Cologne: 'Köln', Geneva: 'Cenevre', Brussels: 'Brüksel', Antwerpen: 'Anvers', Florence: 'Floransa',
  Belgrade: 'Belgrad', Bucharest: 'Bükreş', Sofia: 'Sofya', Thessaloniki: 'Selanik', Odesa: 'Odessa',
  Alexandria: 'İskenderiye', Jeddah: 'Cidde', 'Kuwait City': 'Kuveyt', Mecca: 'Mekke', Chisinau: 'Kişinev',
  Skopje: 'Üsküp', Tirana: 'Tiran', Sarajevo: 'Saraybosna', Ashgabat: 'Aşkabat', Bishkek: 'Bişkek',
  Dushanbe: 'Duşanbe', 'Hong Kong': 'Hong Kong', Macau: 'Makao', Edinburgh: 'Edinburg', Izmir: 'İzmir',
  Istanbul: 'İstanbul', 'Ho Chi Minh City': 'Ho Chi Minh Kenti', 'Cape Town': 'Cape Town',
  Montevideo: 'Montevideo', Kabul: 'Kabil', Lahore: 'Lahor', Dhaka: 'Dakka',
};

// ------------------------------------------------------------------ small utils
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R_EARTH = 6371008.8;
const RAD = Math.PI / 180;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Same as src/core/i18n.ts fold(). */
export function fold(s) {
  return s
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(a)));
}

// ------------------------------------------------------------------ GeoNames
const BAD_FCODES = new Set(['PPLX', 'PPLH', 'PPLQ', 'PPLW', 'PPLCH', 'STLMT']);

function loadGeonames() {
  const rows = [];
  const text = readFileSync(new URL('cities500.txt', RAW), 'utf8');
  for (const line of text.split('\n')) {
    if (!line) continue;
    const f = line.split('\t');
    rows.push({
      id: f[0], name: f[1], ascii: f[2], alts: f[3] ? f[3].split(',') : [], lat: +f[4], lon: +f[5],
      fcode: f[7], cc: f[8], pop: +f[14] || 0,
    });
  }
  return rows;
}

function matchCity(rows, name, cc, lat, lon, alt) {
  const want = new Set([fold(name), alt ? fold(alt) : null].filter(Boolean));
  let best = null;
  for (const r of rows) {
    if (r.cc !== cc || BAD_FCODES.has(r.fcode)) continue;
    if (!(want.has(fold(r.name)) || want.has(fold(r.ascii)) || r.alts.some((a) => want.has(fold(a))))) continue;
    if (haversineKm(lat, lon, r.lat, r.lon) > 40) continue;
    if (!best || r.pop > best.pop) best = r;
  }
  return best;
}

/** Streams alternateNamesV2.txt out of the zip (downloaded once) and keeps names for the given ids. */
async function loadAltNames(ids, countryLangs) {
  const filtered = new URL('altnames-filtered.tsv', RAW_S);
  const idKey = [...ids].sort().join(',');
  const stamp = String(idKey.length) + ':' + idKey.slice(0, 64);
  if (existsSync(filtered)) {
    const txt = readFileSync(filtered, 'utf8');
    const [head, ...lines] = txt.split('\n');
    if (head === stamp) return parseAlt(lines);
  }
  const zip = new URL('alternateNamesV2.zip', RAW_S);
  if (!existsSync(zip)) {
    if (OFFLINE) throw new Error('alternateNamesV2.zip missing and --offline given');
    console.log('downloading GeoNames alternateNamesV2.zip (~200 MB) ...');
    const res = await fetch('https://download.geonames.org/export/dump/alternateNamesV2.zip', { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`alternateNamesV2.zip -> ${res.status}`);
    writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  }
  console.log('filtering alternate names ...');
  const proc = spawn('unzip', ['-p', zip.pathname, 'alternateNamesV2.txt']);
  const rl = createInterface({ input: proc.stdout, crlfDelay: Infinity });
  const keep = [];
  for await (const line of rl) {
    const tab = line.indexOf('\t');
    const tab2 = line.indexOf('\t', tab + 1);
    const gid = line.slice(tab + 1, tab2);
    if (!ids.has(gid)) continue;
    const f = line.split('\t');
    // f: id, geonameid, lang, name, preferred, short, colloquial, historic, from, to
    const lang = f[2];
    if (f[6] === '1' || f[7] === '1') continue;
    if (!lang || lang.length > 3 || lang === 'link' || lang === 'post' || lang === 'iata' || lang === 'icao') continue;
    const cl = countryLangs.get(gid);
    if (lang !== 'en' && lang !== 'tr' && !(cl && cl.has(lang))) continue;
    keep.push([gid, lang, f[3], f[4] === '1' ? 1 : 0, f[5] === '1' ? 1 : 0].join('\t'));
  }
  writeFileSync(filtered, [stamp, ...keep].join('\n'));
  return parseAlt(keep);
}

function parseAlt(lines) {
  const by = new Map();
  for (const l of lines) {
    if (!l) continue;
    const [gid, lang, name, pref, short] = l.split('\t');
    if (!by.has(gid)) by.set(gid, []);
    by.get(gid).push({ lang, name, pref: pref === '1', short: short === '1' });
  }
  return by;
}

function loadCountryLangs() {
  const m = new Map();
  for (const line of readFileSync(new URL('countryInfo.txt', RAW), 'utf8').split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const f = line.split('\t');
    m.set(f[0], new Set((f[15] || '').split(',').map((s) => s.split('-')[0].trim()).filter(Boolean)));
  }
  return m;
}

const LATIN = /^[\p{Script=Latin}\p{M}0-9\s'’.\-()]+$/u;

async function buildCityList(rows, puzzleCities) {
  const valid = new Set(JSON.parse(readFileSync(new URL('public/data/countries.json', ROOT), 'utf8')).map((c) => c.c));
  let big = rows.filter((r) => r.pop >= 250000 && !BAD_FCODES.has(r.fcode) && valid.has(r.cc));
  big.sort((a, b) => b.pop - a.pop);
  const puzzleIds = new Set(puzzleCities.map((c) => c.id));
  // Drop wards/districts listed as separate places: a smaller place within 10 km of a much bigger one.
  const kept = [];
  for (const r of big) {
    if (puzzleIds.has(r.id)) continue;
    const shadow = [...kept, ...puzzleCities].some(
      (k) => k.pop >= r.pop * 2 && haversineKm(k.lat, k.lon, r.lat, r.lon) < 10,
    );
    const dup = kept.some((k) => k.cc === r.cc && fold(k.name) === fold(r.name) && haversineKm(k.lat, k.lon, r.lat, r.lon) < 30);
    if (!shadow && !dup) kept.push(r);
  }
  const all = [...puzzleCities, ...kept];
  const countryLangs = loadCountryLangs();
  const cityLangs = new Map(all.map((c) => [c.id, countryLangs.get(c.cc) || new Set()]));
  const alt = await loadAltNames(new Set(all.map((c) => c.id)), cityLangs);
  const out = [];
  for (const c of all) {
    const names = alt.get(c.id) || [];
    const keys = new Set([fold(c.name), fold(c.ascii)]);
    for (const a of names) {
      if (!LATIN.test(a.name) || a.name.length > 40) continue;
      const k = fold(a.name);
      if (k) keys.add(k);
    }
    const trPref = names.find((a) => a.lang === 'tr' && a.pref) || names.find((a) => a.lang === 'tr' && !a.short);
    let tr = TR_NAMES[c.name] || (trPref && LATIN.test(trPref.name) ? trPref.name : null);
    if (tr) keys.add(fold(tr));
    if (c.alt) keys.add(fold(c.alt));
    const display = c.display || c.name;
    keys.delete(fold(display));
    keys.delete('');
    const e = { i: c.id, n: display, c: c.cc, a: +c.lat.toFixed(4), o: +c.lon.toFixed(4) };
    if (tr && tr !== display) e.t = tr;
    const k = [...keys].filter((x) => x.length <= 30).slice(0, 14);
    if (k.length) e.k = k;
    out.push(e);
  }
  out.sort((a, b) => a.n.localeCompare(b.n));
  return out;
}

// ------------------------------------------------------------------ Overpass
function bboxFor(lat, lon, half, margin = 1.08) {
  const dLat = (half * margin) / (R_EARTH * RAD);
  const dLon = (half * margin) / (R_EARTH * RAD * Math.cos(lat * RAD));
  return [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map((v) => +v.toFixed(6)).join(',');
}

const STREET_RE = 'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian|road|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link';
const MAJOR = new Set(['motorway', 'trunk', 'primary', 'secondary', 'motorway_link', 'trunk_link']);
const FAST = new Set(['motorway', 'trunk', 'motorway_link', 'trunk_link']);

export function buildQuery(lat, lon, foot, big = false) {
  const b3 = bboxFor(lat, lon, HALF);
  const b10 = bboxFor(lat, lon, HALF_Z);
  const streets = foot ? `${STREET_RE}|footway` : STREET_RE;
  // Small declared limits get admitted much faster on a busy server; escalate only after failures.
  const limits = big ? '[timeout:240][maxsize:536870912]' : '[timeout:90][maxsize:201326592]';
  return `[out:json]${limits};
(
  way["highway"~"^(${streets})$"](${b3});
  way["railway"~"^(rail|subway|light_rail|tram)$"](${b3});
  way["highway"~"^(motorway|trunk|primary|secondary|motorway_link|trunk_link)$"](${b10});
  way["natural"="water"](${b10});
  way["waterway"~"^(riverbank|river|canal)$"](${b10});
  way["natural"="coastline"](${b10});
  way["landuse"="reservoir"](${b10});
  relation["natural"="water"](${b10});
  relation["waterway"="riverbank"](${b10});
  relation["landuse"="reservoir"](${b10});
);
out geom(${b10});`;
}

let lastRequest = 0;
const downUntil = new Map();

/** Seconds until overpass-api.de has a free slot for us (0 = free now). It publishes per-IP slot state. */
async function slotWait(endpoint) {
  try {
    const res = await fetch(endpoint.replace('/interpreter', '/status'), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
    const txt = await res.text();
    if (/\d+ slots? available now/.test(txt)) return 0;
    const secs = [...txt.matchAll(/in (-?\d+) seconds/g)].map((m) => +m[1]);
    return secs.length ? Math.max(1, Math.min(...secs)) + 1 : 15;
  } catch {
    return 0;
  }
}

/**
 * Picks where to send the next request: the main instance when it has a free slot, otherwise a mirror
 * that is not cooling down after errors, otherwise wait for the main instance. Requests stay strictly
 * sequential; this only avoids idling while the main instance's per-IP cooldown runs.
 */
async function pickEndpoint(avoid) {
  for (;;) {
    const main = ENDPOINTS[0];
    const mainBusy = avoid === main || (downUntil.get(main) || 0) > Date.now();
    const wait = mainBusy ? Infinity : await slotWait(main);
    if (wait === 0) return main;
    const mirror = ENDPOINTS.slice(1).find((e) => e !== avoid && (downUntil.get(e) || 0) < Date.now());
    if (mirror) return mirror;
    if (wait === Infinity) return main;
    await sleep(Math.min(wait, 120) * 1000);
  }
}

async function overpass(makeQuery) {
  let attempt = 0;
  let avoid = null;
  for (;;) {
    const endpoint = await pickEndpoint(avoid);
    const wait = lastRequest + PAUSE_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();
    let status = 0;
    let body = '';
    try {
      const res = await fetch(`${endpoint}?data=${encodeURIComponent(makeQuery(attempt >= 4))}`, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(300000),
      });
      status = res.status;
      body = await res.text();
    } catch (e) {
      body = String(e);
    }
    lastRequest = Date.now();
    if (status === 200 && body.startsWith('{')) {
      try {
        const json = JSON.parse(body);
        if (json.remark && /error|timed out|out of memory/i.test(json.remark)) throw new Error(json.remark);
        return json;
      } catch (e) {
        body = String(e.message || e);
      }
    }
    const host = endpoint.split('/')[2];
    const msg = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 100);
    if (status === 429) {
      console.log(`    overpass ${host} -> 429, waiting for a slot`);
      await sleep(5000);
      avoid = null;
      continue;
    }
    attempt++;
    if (attempt >= 10) throw new Error(`overpass failed after ${attempt} attempts: ${status} ${msg}`);
    // cool an endpoint down after an error: main instance 1 min, mirrors 2 min, 30 min for hard server errors
    const cool = endpoint === ENDPOINTS[0] ? 60000 : status === 500 ? 30 * 60000 : 120000;
    downUntil.set(endpoint, Date.now() + cool);
    avoid = endpoint;
    const backoff = Math.min(60000, 4000 * 2 ** Math.floor((attempt - 1) / 3));
    console.log(`    overpass ${host} -> ${status} ${msg}; retry in ${backoff / 1000}s`);
    await sleep(backoff);
  }
}

function cacheFile(key) {
  return new URL(`${key}.json.gz`, CACHE);
}

async function fetchCrop(key, lat, lon, foot) {
  const file = cacheFile(key);
  if (existsSync(file)) return JSON.parse(gunzipSync(readFileSync(file)).toString('utf8'));
  if (OFFLINE) return null;
  const t0 = Date.now();
  const json = await overpass((big) => buildQuery(lat, lon, foot, big));
  const buf = gzipSync(JSON.stringify(json));
  writeFileSync(file, buf);
  console.log(`    fetched ${json.elements.length} elements in ${((Date.now() - t0) / 1000).toFixed(1)}s (${(buf.length / 1024).toFixed(0)} KB gz)`);
  return json;
}

// ------------------------------------------------------------------ geometry
function projector(lat0, lon0) {
  const kx = R_EARTH * RAD * Math.cos(lat0 * RAD);
  const ky = R_EARTH * RAD;
  return (p) => [(p.lon - lon0) * kx, -(p.lat - lat0) * ky];
}

/** Splits a geometry array (nulls = outside Overpass bbox) into runs of projected points. */
function runs(geometry, proj) {
  const out = [];
  let cur = [];
  for (const p of geometry || []) {
    if (!p) {
      if (cur.length > 1) out.push(cur);
      cur = [];
    } else cur.push(proj(p));
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

/** Liang–Barsky clip of a polyline to the square [-h,h]^2; returns pieces. */
export function clipLine(pts, h) {
  const pieces = [];
  let cur = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const dx = x1 - x0;
    const dy = y1 - y0;
    let t0 = 0;
    let t1 = 1;
    let ok = true;
    for (const [p, q] of [[-dx, x0 + h], [dx, h - x0], [-dy, y0 + h], [dy, h - y0]]) {
      if (p === 0) {
        if (q < 0) { ok = false; break; }
      } else {
        const r = q / p;
        if (p < 0) { if (r > t1) { ok = false; break; } if (r > t0) t0 = r; } else { if (r < t0) { ok = false; break; } if (r < t1) t1 = r; }
      }
    }
    if (!ok) { if (cur) { pieces.push(cur); cur = null; } continue; }
    const a = [x0 + t0 * dx, y0 + t0 * dy];
    const b = [x0 + t1 * dx, y0 + t1 * dy];
    if (!cur) cur = [a];
    cur.push(b);
    if (t1 < 1) { pieces.push(cur); cur = null; }
  }
  if (cur) pieces.push(cur);
  return pieces.filter((p) => p.length > 1);
}

function dp(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  const t2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const L = dx * dx + dy * dy;
    let maxD = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      let d;
      if (L === 0) d = (px - ax) ** 2 + (py - ay) ** 2;
      else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L));
        d = (ax + t * dx - px) ** 2 + (ay + t * dy - py) ** 2;
      }
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > t2) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Simplify, round to integer metres and delta-encode: [x0,y0,dx1,dy1,...]. */
function encode(pts, tol, closed = false) {
  let s = dp(pts, tol);
  const q = [];
  for (const [x, y] of s) {
    const p = [Math.round(x), Math.round(y)];
    const l = q[q.length - 1];
    if (!l || l[0] !== p[0] || l[1] !== p[1]) q.push(p);
  }
  if (q.length < 2 || (closed && q.length < 4)) return null;
  const out = [q[0][0], q[0][1]];
  for (let i = 1; i < q.length; i++) out.push(q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]);
  return out;
}

function lineLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}

function ringArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  return Math.abs(a / 2);
}

/** Even-odd point-in-polygon over a list of closed rings. */
export function inside(rings, x, y) {
  let c = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i];
      const [xj, yj] = r[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
  }
  return c;
}

/** Perimeter parameter of a boundary point, clockwise on screen from the top-left corner. */
function perim(p, h) {
  const [x, y] = p;
  const e = 1e-6 * h;
  if (Math.abs(y + h) < e) return x + h; // top edge, left -> right
  if (Math.abs(x - h) < e) return 2 * h + (y + h); // right edge, top -> bottom
  if (Math.abs(y - h) < e) return 4 * h + (h - x); // bottom edge, right -> left
  if (Math.abs(x + h) < e) return 6 * h + (h - y); // left edge, bottom -> top
  return null;
}
const CORNERS = (h) => [[0, [-h, -h]], [2 * h, [h, -h]], [4 * h, [h, h]], [6 * h, [-h, h]]];

/** Walk clockwise along the box border from parameter a to b, returning intermediate corners. */
function walk(a, b, h) {
  const P = 8 * h;
  let span = (b - a + P) % P;
  const out = [];
  for (const [t, c] of CORNERS(h)) {
    const d = (t - a + P) % P;
    if (d > 0 && d < span) out.push([d, c]);
  }
  out.sort((u, v) => u[0] - v[0]);
  return out.map((x) => x[1]);
}

/** Join runs that share endpoints (same projected coords) into chains. */
function chain(lines) {
  const key = (p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
  const pool = lines.map((l) => l.slice());
  const out = [];
  const used = new Uint8Array(pool.length);
  const byEnd = new Map();
  pool.forEach((l, i) => {
    for (const k of [key(l[0]), key(l[l.length - 1])]) {
      if (!byEnd.has(k)) byEnd.set(k, []);
      byEnd.get(k).push(i);
    }
  });
  for (let i = 0; i < pool.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    let c = pool[i];
    for (let dir = 0; dir < 2; dir++) {
      for (;;) {
        const endK = key(c[c.length - 1]);
        if (endK === key(c[0]) && c.length > 2) break;
        const nxt = (byEnd.get(endK) || []).find((j) => !used[j]);
        if (nxt == null) break;
        used[nxt] = 1;
        const l = pool[nxt];
        c = key(l[0]) === endK ? c.concat(l.slice(1)) : c.concat(l.slice().reverse().slice(1));
      }
      c = c.reverse();
    }
    out.push(c);
  }
  return out;
}

/**
 * Turns the boundary runs of one area feature into renderable even-odd rings inside the box.
 * Returns { rings, partial } where partial means the polygon crosses the box border and the fill side
 * was chosen by `decide` (or by the coastline orientation).
 */
export function areaRings(lines, h, decide) {
  const chains = chain(lines);
  const closedRings = [];
  const pieces = [];
  for (const c of chains) {
    const a = c[0];
    const b = c[c.length - 1];
    const closed = Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.01;
    const allIn = c.every(([x, y]) => Math.abs(x) <= h && Math.abs(y) <= h);
    if (closed && allIn) {
      closedRings.push(c);
      continue;
    }
    let src = c;
    if (closed) {
      // start the ring outside the box so every clipped piece runs border to border
      const k = c.findIndex(([x, y]) => Math.abs(x) > h || Math.abs(y) > h);
      src = [...c.slice(k, -1), ...c.slice(0, k), c[k]];
    }
    for (const p of clipLine(src, h)) {
      const ta = perim(p[0], h);
      const tb = perim(p[p.length - 1], h);
      if (ta == null || tb == null) continue; // broken data: dangling end inside the box
      pieces.push({ p, ta, tb });
    }
  }
  if (!pieces.length) return { rings: closedRings, partial: false };
  const loops = closedRings.slice();
  for (const { p, ta, tb } of pieces) loops.push([...p, ...walk(tb, ta, h)]);
  const box = [[-h, -h], [h, -h], [h, h], [-h, h]];
  const water = decide(loops, pieces);
  return { rings: water ? loops : [...loops, box], partial: true };
}

/** Fraction of the box covered by an even-odd region, and road length inside it. */
function regionStats(loops, h, evidence) {
  const N = 40;
  let inCount = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const x = -h + ((i + 0.5) * 2 * h) / N;
    const y = -h + ((j + 0.5) * 2 * h) / N;
    if (inside(loops, x, y)) inCount++;
  }
  let lenIn = 0;
  let lenAll = 0;
  for (const [x, y, L] of evidence) {
    lenAll += L;
    if (inside(loops, x, y)) lenIn += L;
  }
  return { frac: inCount / (N * N), lenIn, lenAll };
}

/** Lakes/rivers: the side of the border with fewer roads (per area) is the water. */
export function densityDecider(h, evidence) {
  return (loops) => {
    const { frac, lenIn, lenAll } = regionStats(loops, h, evidence);
    const areaIn = Math.max(frac, 1e-3);
    const areaOut = Math.max(1 - frac, 1e-3);
    const dIn = lenIn / areaIn;
    const dOut = (lenAll - lenIn) / areaOut;
    if (lenAll < 1) return frac <= 0.5;
    return dIn <= dOut; // true: the loops' own region is the water
  };
}

/** Coastline: OSM draws it with land on the left, so the water is on the right of the line. */
export function coastDecider(h) {
  return (loops, pieces) => {
    let best = null;
    for (const { p } of pieces) for (let i = 1; i < p.length; i++) {
      const L = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
      if (!best || L > best.L) best = { L, a: p[i - 1], b: p[i] };
    }
    const { a, b, L } = best;
    const dx = (b[0] - a[0]) / L;
    const dy = (b[1] - a[1]) / L;
    const eps = Math.min(1, L / 4);
    // screen coordinates have y pointing south, so "right of travel" is (-dy, dx)
    const x = (a[0] + b[0]) / 2 - dy * eps;
    const y = (a[1] + b[1]) / 2 + dx * eps;
    if (Math.abs(x) > h || Math.abs(y) > h) return true;
    return inside(loops, x, y);
  };
}

function isArea(tags) {
  return tags.natural === 'water' || tags.waterway === 'riverbank' || tags.landuse === 'reservoir';
}

// ------------------------------------------------------------------ crop processing
export function processCrop(json, lat, lon, opts) {
  const proj = projector(lat, lon);
  const streetsMajor = [];
  const streetsMinor = [];
  const rail = [];
  const zFast = [];
  const zMain = [];
  const evidence3 = [];
  const evidence10 = [];
  const waysInBox = new Set();
  const nameLen = new Map();
  const rose = new Float64Array(36);
  let nearest = Infinity;
  const waterAreas = [];
  const waterLines = [];
  const coast = [];
  const streetSet = new Set(STREET_RE.split('|'));
  if (opts.foot) streetSet.add('footway');

  for (const el of json.elements) {
    const tags = el.tags || {};
    if (el.type === 'way') {
      const hw = tags.highway;
      const rw = tags.railway;
      const rs = runs(el.geometry, proj);
      if (hw && streetSet.has(hw) && tags.area !== 'yes') {
        const pieces = rs.flatMap((r) => clipLine(r, HALF));
        let len = 0;
        for (const p of pieces) {
          len += lineLength(p);
          for (let i = 1; i < p.length; i++) {
            const dx = p[i][0] - p[i - 1][0];
            const dy = p[i][1] - p[i - 1][1];
            const L = Math.hypot(dx, dy);
            if (L < 0.01) continue;
            const b = ((Math.atan2(dx, -dy) / RAD) + 360) % 360;
            const bin = Math.round(b / 10) % 36;
            rose[bin] += L;
            rose[(bin + 18) % 36] += L;
            if (!tags.bridge && !tags.tunnel && tags.layer == null) {
              evidence3.push([(p[i][0] + p[i - 1][0]) / 2, (p[i][1] + p[i - 1][1]) / 2, L]);
            }
            const mx = (p[i][0] + p[i - 1][0]) / 2;
            const my = (p[i][1] + p[i - 1][1]) / 2;
            nearest = Math.min(nearest, Math.hypot(mx, my), Math.hypot(...p[i]));
          }
          const enc = encode(p, 3);
          if (enc) (MAJOR.has(hw) ? streetsMajor : streetsMinor).push(enc);
        }
        if (len > 1) {
          waysInBox.add(el.id);
          const nm = tags.name;
          if (nm && hw !== 'motorway' && hw !== 'motorway_link') {
            let label = nm;
            const en = tags['name:en'];
            if (en && en !== nm && !LATIN.test(nm)) label = `${nm} (${en})`;
            nameLen.set(label, (nameLen.get(label) || 0) + len);
          }
        }
      }
      if (hw && MAJOR.has(hw)) {
        for (const r of rs) for (const p of clipLine(r, HALF_Z)) {
          const enc = encode(p, 10);
          if (enc) (FAST.has(hw) ? zFast : zMain).push(enc);
          if (!tags.bridge && !tags.tunnel) {
            for (let i = 1; i < p.length; i++) {
              const L = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
              evidence10.push([(p[i][0] + p[i - 1][0]) / 2, (p[i][1] + p[i - 1][1]) / 2, L * 4]);
            }
          }
        }
      }
      if (rw && !tags.service && ['rail', 'subway', 'light_rail', 'tram'].includes(rw)) {
        for (const r of rs) for (const p of clipLine(r, HALF)) {
          const enc = encode(p, 3);
          if (enc) rail.push(enc);
        }
      }
      if (tags.natural === 'coastline') coast.push(...rs);
      else if (isArea(tags)) waterAreas.push({ id: `w${el.id}`, lines: rs });
      else if (tags.waterway === 'river' || tags.waterway === 'canal') {
        if (tags.tunnel || tags.location === 'underground') continue;
        waterLines.push(...rs);
      }
    } else if (el.type === 'relation' && isArea(tags)) {
      const lines = [];
      for (const m of el.members || []) if (m.type === 'way' && m.geometry) lines.push(...runs(m.geometry, proj));
      waterAreas.push({ id: `r${el.id}`, lines });
    }
  }

  // 10 km evidence also includes the full 3 km street network
  const ev10 = evidence10.concat(evidence3);
  const sample = (ev, n) => (ev.length <= n ? ev : ev.filter((_, i) => i % Math.ceil(ev.length / n) === 0));
  const e3 = sample(evidence3, 6000);
  const e10 = sample(ev10, 6000);

  function waterFor(h, tol, minArea, ev) {
    const polys = [];
    const wetRings = [];
    const dec = densityDecider(h, ev);
    for (const wa of waterAreas) {
      const { rings, partial } = areaRings(wa.lines, h, dec);
      if (!rings.length) continue;
      if (!partial) {
        const area = rings.reduce((s, r) => s + ringArea(r), 0);
        if (area < minArea) continue;
      }
      wetRings.push(rings);
      const enc = rings.map((r) => encode(r, tol, true)).filter(Boolean);
      if (enc.length) polys.push(enc);
    }
    if (coast.length) {
      const { rings } = areaRings(coast, h, coastDecider(h));
      if (rings.length) {
        wetRings.push(rings);
        const enc = rings.map((r) => encode(r, tol, true)).filter(Boolean);
        if (enc.length) polys.unshift(enc);
      }
    }
    const lines = [];
    for (const r of waterLines) for (const p of clipLine(r, h)) {
      const enc = encode(p, tol);
      if (enc) lines.push(enc);
    }
    // The centre is "in water" only if it and most points 75 m around it are wet (ignores fountains, ponds).
    const wet = (x, y) => wetRings.some((r) => inside(r, x, y));
    const ring = [[75, 0], [-75, 0], [0, 75], [0, -75]].filter(([x, y]) => wet(x, y)).length;
    const centreWet = wet(0, 0) && ring >= 3;
    return { polys, lines, centreWet };
  }

  const w3 = waterFor(HALF, 3, 150, e3);
  const w10 = waterFor(HALF_Z, 10, 4000, e10);

  const max = Math.max(...rose);
  const roseOut = [...rose].map((v) => Math.round((100 * v) / (max || 1)));
  const names = [...nameLen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map((e) => e[0]);

  return {
    ways: waysInBox.size,
    nearest,
    centreWet: w3.centreWet,
    data: {
      s: HALF,
      m: streetsMajor,
      r: streetsMinor,
      rl: rail,
      w: w3.polys,
      wl: w3.lines,
      z: { s: HALF_Z, f: zFast, m: zMain, w: w10.polys, wl: w10.lines },
      rose: roseOut,
      names,
    },
  };
}

// ------------------------------------------------------------------ main
function cropKey(name, lat, lon) {
  const slug = fold(name).replace(/ /g, '-');
  return `${QUERY_VERSION}-${slug}-${lat.toFixed(4)}_${lon.toFixed(4)}`;
}

function alternates(lat, lon) {
  // Fallback centres ~2.6 km away (N, E, S, W) if a curated centre fails the checks.
  const dLat = 2600 / (R_EARTH * RAD);
  const dLon = 2600 / (R_EARTH * RAD * Math.cos(lat * RAD));
  return [[lat + dLat, lon], [lat, lon + dLon], [lat - dLat, lon], [lat, lon - dLon]].map(([a, b]) => [+a.toFixed(4), +b.toFixed(4)]);
}

async function main() {
  for (const d of [RAW_S, CACHE, OUT]) mkdirSync(d, { recursive: true });
  const rows = loadGeonames();

  // Resolve curated cities against GeoNames
  const cities = [];
  const missing = [];
  for (const [name, cc, centres, opts = {}] of CITIES) {
    const m = matchCity(rows, name, cc, centres[0][0], centres[0][1], opts.alt);
    if (!m) { missing.push(`${name} (${cc})`); continue; }
    cities.push({ ...m, display: m.name, alt: opts.alt, centres, opts });
  }
  if (missing.length) throw new Error('GeoNames match failed for: ' + missing.join(', '));
  const dupIds = cities.filter((c, i) => cities.findIndex((d) => d.id === c.id) !== i);
  if (dupIds.length) throw new Error('duplicate city ids: ' + dupIds.map((c) => c.name).join(', '));

  // Fetch + process crops
  const accepted = [];
  const rejected = [];
  const failed = [];
  let processed = 0;
  const wanted = cities.reduce((s, c) => s + c.centres.length, 0);
  console.log(`${cities.length} cities, ${wanted} curated crops`);
  // Round-robin by crop rank (every city's first crop, then every second crop, ...) so that an
  // interrupted or rate-limited run still covers as many different cities as possible.
  const jobs = [];
  const maxRank = Math.max(...cities.map((c) => c.centres.length));
  for (let rank = 0; rank < maxRank; rank++) {
    for (const c of cities) if (c.centres[rank] && (!ONLY || fold(c.name).includes(fold(ONLY)))) jobs.push([c, c.centres[rank]]);
  }
  outer: for (const [c, centre] of jobs) {
    {
      const [lat, lon] = centre;
      if (processed >= LIMIT) break outer;
      processed++;
      const tries = [[lat, lon], ...alternates(lat, lon)];
      for (const [a, b] of tries) {
        const key = cropKey(c.name, a, b);
        if (accepted.some((p) => haversineKm(p.lat, p.lon, a, b) < 1.2)) continue; // too much overlap
        process.stdout.write(`[${processed}/${wanted}] ${c.name} ${a},${b}\n`);
        let json;
        try {
          json = await fetchCrop(key, a, b, !!c.opts.foot);
        } catch (e) {
          console.log(`    FAILED: ${e.message}`);
          failed.push(`${c.name} ${a},${b}`);
          break;
        }
        if (!json) { failed.push(`${c.name} ${a},${b} (not cached)`); break; }
        let res;
        try {
          res = processCrop(json, a, b, c.opts);
        } catch (e) {
          console.log(`    processing error: ${e.stack}`);
          rejected.push(`${c.name} ${a},${b}: error ${e.message}`);
          continue;
        }
        const minWays = c.opts.minWays ?? MIN_WAYS;
        const why = res.ways < minWays ? `${res.ways} ways` : res.centreWet ? 'centre in water' : res.nearest > 250 ? `no street within 250 m` : null;
        if (why) {
          console.log(`    rejected: ${why}`);
          rejected.push(`${c.name} ${a},${b}: ${why}`);
          continue;
        }
        accepted.push({ city: c, lat: a, lon: b, data: res.data, ways: res.ways });
        break;
      }
    }
  }

  // Order: round-robin by crop rank so the same city never comes back soon, shuffled per round.
  const rng = mulberry32(SEED);
  const shuffle = (a) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const byCity = new Map();
  for (const p of accepted) {
    if (!byCity.has(p.city.id)) byCity.set(p.city.id, []);
    byCity.get(p.city.id).push(p);
  }
  const rounds = [];
  for (const list of byCity.values()) list.forEach((p, i) => (rounds[i] ||= []).push(p));
  const ordered = [];
  for (const r of rounds) {
    shuffle(r);
    if (ordered.length && r.length > 1 && r[0].city.id === ordered[ordered.length - 1].city.id) [r[0], r[1]] = [r[1], r[0]];
    ordered.push(...r);
  }
  // First two weeks: cities whose street pattern is famous, so new players get a fair first taste.
  const OPENERS = ['Barcelona', 'New York City', 'Paris', 'Amsterdam', 'Washington', 'Venice', 'Istanbul', 'Brasília', 'Rome', 'Chicago', 'London', 'Kyoto', 'La Plata', 'Moscow'];
  const front = [];
  for (const name of OPENERS) {
    const i = ordered.findIndex((p) => p.city.name === name);
    if (i >= 0) front.push(...ordered.splice(i, 1));
  }
  ordered.unshift(...front);

  // Write output
  const pDir = new URL('p/', OUT);
  if (existsSync(pDir)) rmSync(pDir, { recursive: true });
  mkdirSync(pDir, { recursive: true });
  const index = [];
  let maxFile = 0;
  let totalBytes = 0;
  let totalGz = 0;
  ordered.forEach((p, i) => {
    const rot = 30 + Math.round(rng() * 300);
    index.push({ id: i, c: p.city.id, n: p.city.display, cc: p.city.cc, lat: p.lat, lon: p.lon, rot });
    const txt = JSON.stringify({ id: i, ...p.data });
    writeFileSync(new URL(`${i}.json`, pDir), txt);
    const gz = gzipSync(txt).length;
    maxFile = Math.max(maxFile, gz);
    totalBytes += txt.length;
    totalGz += gz;
  });
  writeFileSync(new URL('index.json', OUT), JSON.stringify(index));

  const cityList = await buildCityList(rows, cities);
  const citiesTxt = JSON.stringify(cityList);
  writeFileSync(new URL('cities.json', OUT), citiesTxt);
  const idxTxt = JSON.stringify(index);

  const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
  console.log('\n=== Streetprint build summary ===');
  console.log(`cities resolved: ${cities.length}, crops accepted: ${accepted.length}, rejected checks: ${rejected.length}, fetch failures: ${failed.length}`);
  if (accepted.length < TARGET_PUZZLES) console.log(`NOTE: ${accepted.length} puzzles < ${TARGET_PUZZLES}; the daily list cycles.`);
  console.log(`puzzle files: ${kb(totalBytes)} raw, ${kb(totalGz)} gzip, largest ${kb(maxFile)} gzip`);
  console.log(`index.json: ${kb(idxTxt.length)} (${kb(gzipSync(idxTxt).length)} gz); cities.json: ${cityList.length} cities, ${kb(citiesTxt.length)} (${kb(gzipSync(citiesTxt).length)} gz)`);
  if (rejected.length) console.log('rejected:\n  ' + rejected.join('\n  '));
  if (failed.length) console.log('failed:\n  ' + failed.join('\n  '));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
