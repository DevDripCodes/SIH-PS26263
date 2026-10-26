// Pure parsers that turn raw uploaded text into the values the database expects.
// Parsers return `{ ok: true, value: null }` for blank input and `{ ok: false }` for unreadable
// input, so rules can tell "missing" apart from "wrong".

export type Residency = "INDIAN_RESIDENT" | "NRI" | "OCI" | "PIO" | "FOREIGN_NATIONAL" | "CIWGC";
export type Quota =
  | "REGULAR_SANCTIONED"
  | "NRI_QUOTA"
  | "SUPERNUMERARY_TFW"
  | "SUPERNUMERARY_FN_OCI_CIWGC"
  | "SUPERNUMERARY_PMSSS"
  | "SUPERNUMERARY_EWS"
  | "LATERAL_ENTRY";
export type Gender = "MALE" | "FEMALE" | "OTHER";
export type SocialCategory = "GEN" | "EWS" | "OBC" | "SC" | "ST";

export type Parsed<T> = { ok: true; value: T | null } | { ok: false };

const blank = (raw: string | null | undefined): raw is null | undefined | "" => !raw || !raw.trim();
const key = (raw: string) =>
  raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

function lookup<T>(table: Record<string, T>, raw: string | null | undefined): Parsed<T> {
  if (blank(raw)) return { ok: true, value: null };
  const value = table[key(raw)];
  return value === undefined ? { ok: false } : { ok: true, value };
}

/** 12 digits; spaces, dashes and dots between groups are ignored. */
export function parseApaar(raw: string | null | undefined): Parsed<string> {
  if (blank(raw)) return { ok: true, value: null };
  const digits = raw.trim().replace(/[\s.-]/g, "");
  return /^\d{12}$/.test(digits) ? { ok: true, value: digits } : { ok: false };
}

/** True when Excel has turned a long number into scientific notation (digits are lost). */
export function looksLikeScientificNotation(raw: string | null | undefined): boolean {
  return !blank(raw) && /^\d(\.\d+)?E\+\d+$/i.test(raw.trim());
}

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

/**
 * Accepts YYYY-MM-DD, YYYY/MM/DD, DD-MM-YYYY, DD/MM/YYYY, DD.MM.YYYY and Excel serial day numbers.
 * Day-first is assumed for numeric dates (Indian convention); MM/DD/YYYY is not supported.
 */
export function parseDate(raw: string | null | undefined): Parsed<string> {
  if (blank(raw)) return { ok: true, value: null };
  const s = raw.trim();
  let y: number, m: number, d: number;

  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(s);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s))) {
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if (/^\d{5}$/.test(s) && Number(s) > 7000 && Number(s) < 80000) {
    const date = new Date(EXCEL_EPOCH_MS + Number(s) * 86_400_000);
    return { ok: true, value: date.toISOString().slice(0, 10) };
  } else {
    return { ok: false };
  }

  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return { ok: false };
  return { ok: true, value: date.toISOString().slice(0, 10) };
}

export function parseYesNo(raw: string | null | undefined): Parsed<boolean> {
  return lookup({ Y: true, YES: true, TRUE: true, "1": true, N: false, NO: false, FALSE: false, "0": false }, raw);
}

export function parseGender(raw: string | null | undefined): Parsed<Gender> {
  return lookup<Gender>(
    {
      M: "MALE",
      MALE: "MALE",
      BOY: "MALE",
      F: "FEMALE",
      FEMALE: "FEMALE",
      GIRL: "FEMALE",
      O: "OTHER",
      OTHER: "OTHER",
      OTHERS: "OTHER",
      T: "OTHER",
      TG: "OTHER",
      TRANSGENDER: "OTHER",
      THIRD_GENDER: "OTHER",
    },
    raw,
  );
}

export function parseResidency(raw: string | null | undefined): Parsed<Residency> {
  return lookup<Residency>(
    {
      INDIAN: "INDIAN_RESIDENT",
      INDIAN_RESIDENT: "INDIAN_RESIDENT",
      INDIAN_NATIONAL: "INDIAN_RESIDENT",
      RESIDENT: "INDIAN_RESIDENT",
      RESIDENT_INDIAN: "INDIAN_RESIDENT",
      IN: "INDIAN_RESIDENT",
      NRI: "NRI",
      NON_RESIDENT_INDIAN: "NRI",
      OCI: "OCI",
      OVERSEAS_CITIZEN_OF_INDIA: "OCI",
      PIO: "PIO",
      PERSON_OF_INDIAN_ORIGIN: "PIO",
      FN: "FOREIGN_NATIONAL",
      FOREIGN: "FOREIGN_NATIONAL",
      FOREIGNER: "FOREIGN_NATIONAL",
      FOREIGN_NATIONAL: "FOREIGN_NATIONAL",
      CIWGC: "CIWGC",
    },
    raw,
  );
}

export function parseQuota(raw: string | null | undefined): Parsed<Quota> {
  return lookup<Quota>(
    {
      REGULAR: "REGULAR_SANCTIONED",
      SANCTIONED: "REGULAR_SANCTIONED",
      REGULAR_SANCTIONED: "REGULAR_SANCTIONED",
      NRI: "NRI_QUOTA",
      NRI_QUOTA: "NRI_QUOTA",
      TFW: "SUPERNUMERARY_TFW",
      TFWS: "SUPERNUMERARY_TFW",
      TUITION_FEE_WAIVER: "SUPERNUMERARY_TFW",
      SUPERNUMERARY_TFW: "SUPERNUMERARY_TFW",
      FN_OCI_CIWGC: "SUPERNUMERARY_FN_OCI_CIWGC",
      SUPERNUMERARY_FN_OCI_CIWGC: "SUPERNUMERARY_FN_OCI_CIWGC",
      PMSSS: "SUPERNUMERARY_PMSSS",
      SUPERNUMERARY_PMSSS: "SUPERNUMERARY_PMSSS",
      EWS: "SUPERNUMERARY_EWS",
      SUPERNUMERARY_EWS: "SUPERNUMERARY_EWS",
      LATERAL: "LATERAL_ENTRY",
      LATERAL_ENTRY: "LATERAL_ENTRY",
      LE: "LATERAL_ENTRY",
    },
    raw,
  );
}

export function parseSocialCategory(raw: string | null | undefined): Parsed<SocialCategory> {
  return lookup<SocialCategory>(
    {
      GEN: "GEN",
      GENERAL: "GEN",
      UR: "GEN",
      OPEN: "GEN",
      EWS: "EWS",
      OBC: "OBC",
      OBC_NCL: "OBC",
      SC: "SC",
      ST: "ST",
    },
    raw,
  );
}

const COUNTRIES: Record<string, string> = {
  INDIA: "IN", INDIAN: "IN",
  NEPAL: "NP", NEPALI: "NP", NEPALESE: "NP",
  BANGLADESH: "BD", BANGLADESHI: "BD",
  SRI_LANKA: "LK", SRI_LANKAN: "LK",
  BHUTAN: "BT", BHUTANESE: "BT",
  AFGHANISTAN: "AF", AFGHAN: "AF",
  MALDIVES: "MV", MALDIVIAN: "MV",
  MYANMAR: "MM", BURMESE: "MM",
  PAKISTAN: "PK", PAKISTANI: "PK",
  CHINA: "CN", CHINESE: "CN",
  UNITED_STATES: "US", USA: "US", US: "US", AMERICAN: "US",
  UNITED_KINGDOM: "GB", UK: "GB", BRITISH: "GB",
  UNITED_ARAB_EMIRATES: "AE", UAE: "AE", EMIRATI: "AE",
  SAUDI_ARABIA: "SA", SAUDI: "SA",
  OMAN: "OM", QATAR: "QA", KUWAIT: "KW", BAHRAIN: "BH",
  CANADA: "CA", CANADIAN: "CA",
  AUSTRALIA: "AU", AUSTRALIAN: "AU",
  NEW_ZEALAND: "NZ",
  SINGAPORE: "SG", MALAYSIA: "MY", THAILAND: "TH", VIETNAM: "VN", INDONESIA: "ID",
  NIGERIA: "NG", NIGERIAN: "NG", KENYA: "KE", KENYAN: "KE", TANZANIA: "TZ",
  ETHIOPIA: "ET", UGANDA: "UG", ZIMBABWE: "ZW", SOUTH_AFRICA: "ZA", SUDAN: "SD",
  MAURITIUS: "MU", FIJI: "FJ",
  IRAN: "IR", IRAQ: "IQ", YEMEN: "YE",
  GERMANY: "DE", FRANCE: "FR", RUSSIA: "RU", KAZAKHSTAN: "KZ",
  JAPAN: "JP", SOUTH_KOREA: "KR", KOREA: "KR",
};

/** ISO 3166-1 alpha-2 code from a 2-letter code, country name or common demonym. */
export function parseCountry(raw: string | null | undefined): Parsed<string> {
  if (blank(raw)) return { ok: true, value: null };
  const k = key(raw);
  if (/^[A-Z]{2}$/.test(k)) return { ok: true, value: k === "UK" ? "GB" : k };
  const code = COUNTRIES[k];
  return code ? { ok: true, value: code } : { ok: false };
}

export function cleanName(raw: string | null | undefined): string | null {
  if (blank(raw)) return null;
  return raw.trim().replace(/\s+/g, " ");
}

/** Upper-cased, whitespace-free document number used for matching and fingerprints. */
export function cleanDocumentNo(raw: string | null | undefined): string | null {
  if (blank(raw)) return null;
  return raw.toUpperCase().replace(/[\s-]/g, "");
}

export function cleanRollNo(raw: string | null | undefined): string | null {
  if (blank(raw)) return null;
  return raw.trim().toUpperCase();
}

/** Whole years between two ISO dates. */
export function ageOn(dateOfBirth: string, onDate: string): number {
  const [by, bm, bd] = dateOfBirth.split("-").map(Number) as [number, number, number];
  const [y, m, d] = onDate.split("-").map(Number) as [number, number, number];
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}
