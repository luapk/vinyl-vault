// A flag for the country Discogs reports on a pressing.
//
// Country is the field that tells a UK pressing from a German one, which for
// a lot of records is the whole question. It is already printed on every
// candidate card; a flag makes it readable at a glance rather than a word to
// parse among three others.
//
// Discogs uses its own country vocabulary, not ISO names ("UK", not "United
// Kingdom"), and it includes regions and states that no longer exist. Anything
// not in this map returns null and the caller prints the name alone, so an
// unrecognised country is plain rather than wrong.

const ISO = {
  // The ones that dominate a vinyl collection.
  uk: 'GB', 'united kingdom': 'GB', england: 'GB', scotland: 'GB', wales: 'GB',
  us: 'US', usa: 'US', 'united states': 'US',
  germany: 'DE', japan: 'JP', france: 'FR', italy: 'IT', netherlands: 'NL',
  canada: 'CA', australia: 'AU', spain: 'ES', sweden: 'SE', belgium: 'BE',
  switzerland: 'CH', austria: 'AT', denmark: 'DK', norway: 'NO', finland: 'FI',
  greece: 'GR', ireland: 'IE', portugal: 'PT', poland: 'PL', russia: 'RU',
  brazil: 'BR', mexico: 'MX', argentina: 'AR', 'new zealand': 'NZ',
  'south africa': 'ZA', india: 'IN', israel: 'IL', turkey: 'TR',
  'south korea': 'KR', korea: 'KR', taiwan: 'TW', china: 'CN',
  'hong kong': 'HK', singapore: 'SG', thailand: 'TH', indonesia: 'ID',
  philippines: 'PH', malaysia: 'MY', colombia: 'CO', chile: 'CL', peru: 'PE',
  venezuela: 'VE', uruguay: 'UY', croatia: 'HR', serbia: 'RS', slovenia: 'SI',
  hungary: 'HU', 'czech republic': 'CZ', czechia: 'CZ', slovakia: 'SK',
  romania: 'RO', bulgaria: 'BG', ukraine: 'UA', estonia: 'EE', latvia: 'LV',
  lithuania: 'LT', iceland: 'IS', luxembourg: 'LU', malta: 'MT', cyprus: 'CY',
  egypt: 'EG', nigeria: 'NG', ghana: 'GH', kenya: 'KE', jamaica: 'JM',
  cuba: 'CU', 'puerto rico': 'PR', 'trinidad & tobago': 'TT',

  // Regions Discogs uses in place of a country.
  europe: 'EU', 'uk & europe': 'EU', 'europe & uk': 'EU',
  'usa & canada': 'US', 'us & canada': 'US',
};

// No emoji flag exists for a state that no longer does, and inventing a
// successor's flag would be wrong on the sleeve in the user's hand. These are
// named explicitly so they read as a decision rather than a gap.
const NO_FLAG = new Set([
  'yugoslavia', 'czechoslovakia', 'ussr', 'soviet union',
  'german democratic republic (gdr)', 'east germany', 'gdr',
  'scandinavia', 'unknown', 'worldwide',
]);

function toFlag(iso) {
  return String.fromCodePoint(...[...iso].map(c => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export function flagFor(country) {
  const key = String(country || '').trim().toLowerCase();
  if (!key || NO_FLAG.has(key)) return null;
  const iso = ISO[key];
  return iso ? toFlag(iso) : null;
}

// Country with its flag, for a one-line meta row. Falls back to the bare name.
export function countryLabel(country) {
  const name = String(country || '').trim();
  if (!name) return '';
  const flag = flagFor(name);
  return flag ? `${flag} ${name}` : name;
}
