// =============================================================================
// 145 PSG Expense System — Expense categories + ATO classification data
// =============================================================================
// Each category carries:
//   id         - stable key stored on expense records
//   label      - display name
//   atoClass   - ATO transaction classification for BAS/reporting
//   fbt        - true if Fringe Benefits Tax may apply
//   gstFree    - true if this category is typically GST-free
//   quarter    - ATO quarters run Q1=Jul-Sep, Q2=Oct-Dec, Q3=Jan-Mar, Q4=Apr-Jun
// =============================================================================

export const CATEGORIES = Object.freeze([
  { id: 'catering',   label: 'Catering & Meals',      atoClass: 'Entertainment',    fbt: true,  gstFree: false },
  { id: 'events',     label: 'Events & Activities',    atoClass: 'Entertainment',    fbt: false, gstFree: false },
  { id: 'welfare',    label: 'Welfare Packages',       atoClass: 'Welfare/Benefits', fbt: true,  gstFree: false },
  { id: 'printing',   label: 'Printing & Stationery',  atoClass: 'Administration',   fbt: false, gstFree: false },
  { id: 'transport',  label: 'Transport',              atoClass: 'Travel',           fbt: false, gstFree: false },
  { id: 'venue',      label: 'Venue Hire',             atoClass: 'Facilities',       fbt: false, gstFree: false },
  { id: 'medical',    label: 'Medical Items',          atoClass: 'Medical',          fbt: false, gstFree: true  },
  { id: 'gifts',      label: 'Gifts & Awards',         atoClass: 'Entertainment',    fbt: true,  gstFree: false },
  { id: 'comms',      label: 'Communications',         atoClass: 'Communications',   fbt: false, gstFree: false },
  { id: 'equipment',  label: 'Equipment & Supplies',   atoClass: 'Equipment',        fbt: false, gstFree: false },
  { id: 'other',      label: 'Other',                  atoClass: 'Other',            fbt: false, gstFree: false },
]);

export const CATEGORY_MAP = Object.freeze(
  Object.fromEntries(CATEGORIES.map(c => [c.id, c]))
);

/** Return a category record by id, or undefined. */
export function getCategory(id) {
  return CATEGORY_MAP[id];
}

/** Label string for an id, falling back to the raw id. */
export function categoryLabel(id) {
  return CATEGORY_MAP[id]?.label ?? id;
}

// =============================================================================
// Australian financial year helpers
// =============================================================================

/**
 * Return the ATO financial year string for a date, e.g. '2025-26'.
 * ATO FY runs 1 July to 30 June.
 */
export function financialYear(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const yr = d.getFullYear();
  const mo = d.getMonth(); // 0-indexed, 0=Jan
  const fyStart = mo >= 6 ? yr : yr - 1;
  return `${fyStart}-${String(fyStart + 1).slice(-2)}`;
}

/**
 * ATO BAS quarter number (1-4) for a date.
 * Q1 = Jul-Sep, Q2 = Oct-Dec, Q3 = Jan-Mar, Q4 = Apr-Jun.
 */
export function atoQuarter(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const mo = d.getMonth(); // 0-indexed
  if (mo >= 6 && mo <= 8)  return 1; // Jul-Sep
  if (mo >= 9 && mo <= 11) return 2; // Oct-Dec
  if (mo >= 0 && mo <= 2)  return 3; // Jan-Mar
  return 4;                           // Apr-Jun
}

/**
 * Label for an ATO quarter, e.g. 'Q1 (Jul-Sep 2025)'.
 */
export function quarterLabel(quarter, fyStartYear) {
  const ranges = {
    1: `Jul-Sep ${fyStartYear}`,
    2: `Oct-Dec ${fyStartYear}`,
    3: `Jan-Mar ${fyStartYear + 1}`,
    4: `Apr-Jun ${fyStartYear + 1}`,
  };
  return `Q${quarter} (${ranges[quarter] ?? '?'})`;
}

/**
 * Derive the FY start year from a string like '2025-26'.
 */
export function fyStartYear(fyString) {
  return parseInt(fyString?.split('-')[0] ?? '2024', 10);
}

/**
 * All ATO financial years available, from FY 2023-24 to current+1.
 */
export function availableFinancialYears() {
  const current = parseInt(financialYear().split('-')[0], 10);
  const years = [];
  for (let y = 2023; y <= current + 1; y++) {
    years.push(`${y}-${String(y + 1).slice(-2)}`);
  }
  return years;
}

// =============================================================================
// GST helpers
// =============================================================================

export const GST_RATE = 0.10;

/**
 * GST component of an amount (in cents), given whether GST is included.
 * Returns 0 for GST-free categories.
 */
export function gstAmount(amountCents, included, category) {
  const cat = getCategory(category);
  if (cat?.gstFree) return 0;
  if (!included) return 0;
  // GST is 1/11 of a GST-inclusive amount
  return Math.round(amountCents / 11);
}

/**
 * Format cents as an AUD dollar string, e.g. '$1,234.56'.
 */
export function fmtAUD(cents) {
  if (cents === null || cents === undefined || isNaN(cents)) return '$0.00';
  return new Intl.NumberFormat('en-AU', {
    style: 'currency', currency: 'AUD',
  }).format(cents / 100);
}

/**
 * Parse a dollar string like '$1,234.56' or '1234.56' to cents.
 * Returns NaN on failure.
 */
export function parseDollars(str) {
  if (str === null || str === undefined) return NaN;
  const cleaned = String(str).replace(/[$,\s]/g, '');
  const val = parseFloat(cleaned);
  if (isNaN(val)) return NaN;
  return Math.round(val * 100);
}
