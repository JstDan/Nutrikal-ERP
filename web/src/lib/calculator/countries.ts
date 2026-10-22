const EU = 'AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE';
const OTHER =
  'AD AE AF AG AL AM AO AR AU AZ BA BB BD BF BH BI BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV ' +
  'DJ DM DO DZ EC EG ER ET FJ FM GA GB GD GE GH GM GN GQ GT GW GY HK HN HT ID IL IN IQ IR IS JM JO JP KE KG KH KI KM ' +
  'KN KP KR KW KZ LA LB LC LI LK LR LS LY MA MC MD ME MG MH MK ML MM MN MR MU MV MW MX MY MZ NA NE NG NI NO NP NR NZ ' +
  'OM PA PE PG PH PK PS PW PY QA RS RU RW SA SB SC SD SG SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM TN TO TR TT ' +
  'TV TW TZ UA UG US UY UZ VA VC VE VN VU WS XK YE ZA ZM ZW';

function regionNames(locale: string) {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' });
  } catch {
    return null;
  }
}

const english = regionNames('en');

/** English country name for an ISO code; this is what offers store and the PDF prints. */
export const countryName = (code: string) => (code === 'XK' ? 'Kosovo' : (english?.of(code.toUpperCase()) ?? code));

export interface CountryOption {
  /** ISO 3166 code (clients store this). */
  code: string;
  /** English name, stored on the offer. */
  name: string;
  /** Name in the interface language. */
  label: string;
  group: 'eu' | 'other';
}

/** EU countries first, then all others, each sorted by the name shown in the interface. */
export function countryOptions(locale: string): CountryOption[] {
  const local = regionNames(locale);
  const build = (codes: string, group: CountryOption['group']) =>
    codes
      .split(' ')
      .map((code) => ({
        code,
        name: countryName(code),
        label: code === 'XK' ? (locale === 'bg' ? 'Косово' : 'Kosovo') : (local?.of(code) ?? countryName(code)),
        group,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, locale));
  return [...build(EU, 'eu'), ...build(OTHER, 'other')];
}

export const DEFAULT_COUNTRY = 'Bulgaria';
