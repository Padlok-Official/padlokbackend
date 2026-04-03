// All supported country dial prefixes, longest first so matching is greedy
const COUNTRY_PREFIXES = [
  '+233', '+234', '+254', '+256', '+255', '+250',
  '+225', '+221', '+228', '+229', '+223', '+227', '+226', '+245',
  '+237', '+241', '+242', '+235', '+236', '+240',
  '+27',
] as const;

/**
 * Extract the country dial prefix (e.g. "+233") from an E.164 phone number.
 * Returns null if no known prefix matches.
 */
export function getPhoneCountryPrefix(phoneNumber: string): string | null {
  if (!phoneNumber) return null;
  for (const prefix of COUNTRY_PREFIXES) {
    if (phoneNumber.startsWith(prefix)) return prefix;
  }
  return null;
}

/**
 * Utility to derive currency from phone number country codes.
 */
export function getCurrencyFromPhoneNumber(phoneNumber: string): string {
  if (!phoneNumber) return 'NGN';

  // Basic mapping of country codes to currencies
  if (phoneNumber.startsWith('+233')) return 'GHS'; // Ghana
  if (phoneNumber.startsWith('+254')) return 'KES'; // Kenya
  if (phoneNumber.startsWith('+27')) return 'ZAR';  // South Africa
  if (phoneNumber.startsWith('+256')) return 'UGX'; // Uganda
  if (phoneNumber.startsWith('+255')) return 'TZS'; // Tanzania
  if (phoneNumber.startsWith('+250')) return 'RWF'; // Rwanda
  
  // West African CFA franc (XOF)
  if (
    phoneNumber.startsWith('+225') || // Ivory Coast
    phoneNumber.startsWith('+221') || // Senegal
    phoneNumber.startsWith('+228') || // Togo
    phoneNumber.startsWith('+229') || // Benin
    phoneNumber.startsWith('+223') || // Mali
    phoneNumber.startsWith('+227') || // Niger
    phoneNumber.startsWith('+226') || // Burkina Faso
    phoneNumber.startsWith('+245')    // Guinea-Bissau
  ) return 'XOF';

  // Central African CFA franc (XAF)
  if (
    phoneNumber.startsWith('+237') || // Cameroon
    phoneNumber.startsWith('+241') || // Gabon
    phoneNumber.startsWith('+242') || // Congo
    phoneNumber.startsWith('+235') || // Chad
    phoneNumber.startsWith('+236') || // CAR
    phoneNumber.startsWith('+240')    // Equatorial Guinea
  ) return 'XAF';

  // Default to NGN for anything else (or Nigeria +234)
  return 'NGN';
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  GHS: 'GH₵',
  NGN: '₦',
  KES: 'KSh',
  ZAR: 'R',
  UGX: 'USh',
  TZS: 'TSh',
  RWF: 'RF',
  XOF: 'CFA',
  XAF: 'FCFA',
};

export function getCurrencySymbol(currencyCode: string): string {
  return CURRENCY_SYMBOLS[currencyCode] || currencyCode;
}
