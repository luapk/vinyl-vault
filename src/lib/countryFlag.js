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

  // Regions Discogs uses in place of a country. "EU" and "Europe" both occur.
  europe: 'EU', eu: 'EU',
};

// Discogs joins territories with commas and ampersands: "UK, Europe & US",
// "USA & Canada", "UK & Ireland". Split on these AFTER trying the whole string,
// because "Trinidad & Tobago" is one country carrying an ampersand.
const TERRITORY_SEPARATOR = /\s*(?:,|&|\band\b)\s*/i;
// Three is the widest combination that occurs. More than that would be a wall
// of flags in a meta row that also has to carry the year and the format.
const MAX_TERRITORIES = 3;

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
  if (ISO[key]) return toFlag(ISO[key]);

  // A combined release shows each territory it was pressed for.
  const parts = key.split(TERRITORY_SEPARATOR).map(p => p.trim()).filter(Boolean);
  if (parts.length < 2 || parts.length > MAX_TERRITORIES) return null;
  const flags = [];
  for (const part of parts) {
    // All or nothing. "France & Benelux" has no flag for Benelux, and showing
    // a lone French flag would read as a French pressing, which it is not.
    if (NO_FLAG.has(part) || !ISO[part]) return null;
    flags.push(toFlag(ISO[part]));
  }
  return flags.join('');
}

// The ISO code behind a Discogs country string, for anything that needs to key
// off the country rather than print it -- the shipping corridor, chiefly.
// Exported from here rather than copied, because two vocabularies for the same
// field drift, and the failure is quiet: a pressing whose flag renders but
// whose shipping falls back to rest-of-world.
//
// A combined territory ("UK, Europe & US") resolves to its first recognised
// member. That is a guess about where a copy is likely to be, not a fact about
// where this one is, and the caller is expected to label it as such.
export function isoFor(country) {
  const key = String(country || '').trim().toLowerCase();
  if (!key || NO_FLAG.has(key)) return null;
  if (ISO[key]) return ISO[key];
  for (const part of key.split(TERRITORY_SEPARATOR).map(p => p.trim())) {
    if (part && !NO_FLAG.has(part) && ISO[part]) return ISO[part];
  }
  return null;
}

// Country with its flag, for a one-line meta row. Falls back to the bare name.
export function countryLabel(country) {
  const name = String(country || '').trim();
  if (!name) return '';
  const flag = flagFor(name);
  return flag ? `${flag} ${name}` : name;
}

// Suggestions for the country field on the manual search.
//
// The first block is every country string that actually appears in a real
// collection, read from the database and ordered by how often it occurs, so
// the common answers are the first ones offered. Discogs has its own
// spellings ("UK", not "United Kingdom"), and typing a near miss is the whole
// problem this list exists to prevent. The rest are ordinary Discogs country
// names, alphabetically, for the pressings a collection has not reached yet.
export const DISCOGS_COUNTRIES = [
  'UK', 'Europe', 'US', 'Germany', 'UK & Europe', 'South Africa', 'Netherlands',
  'Italy', 'France', 'UK, Europe & US', 'Belgium', 'Canada', 'Sweden',
  'USA & Europe', 'Spain', 'Japan', 'Portugal', 'Norway', 'Australia', 'Poland',
  'UK & Ireland', 'Czech Republic', 'Greece', 'Iceland', 'Singapore',
  'USA & Canada', 'USA, Canada & Europe', 'Denmark', 'Romania', 'South Korea',
  'Switzerland', 'Thailand', 'UK & US',

  'Argentina', 'Austria', 'Brazil', 'Bulgaria', 'Chile', 'China', 'Colombia',
  'Croatia', 'Cuba', 'Cyprus', 'Egypt', 'Estonia', 'Finland', 'Ghana',
  'Hong Kong', 'Hungary', 'India', 'Indonesia', 'Ireland', 'Israel', 'Jamaica',
  'Kenya', 'Latvia', 'Lithuania', 'Luxembourg', 'Malaysia', 'Malta', 'Mexico',
  'New Zealand', 'Nigeria', 'Peru', 'Philippines', 'Puerto Rico', 'Russia',
  'Serbia', 'Slovakia', 'Slovenia', 'Taiwan', 'Trinidad & Tobago', 'Turkey',
  'Ukraine', 'Uruguay', 'Venezuela',
];
