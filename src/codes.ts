// Picklist codes of the register's own Advanced Search wizard, captured live
// on 2026-09-07 by walking the wizard (see AGENTS.md). Codes are the option
// values the site sends as `SV` with `SN=P`; labels are the option texts.
// The same codes are valid on both registers unless stated.

export const REGIONS: Record<string, string> = {
    '1': 'Wales & South West',
    '2': 'East & South East',
    '3': 'North West',
    '4': 'Yorks & North East',
    '5': 'Midlands',
    '6': 'London',
    '7': 'Scotland',
};

export const COUNTRIES: Record<string, string> = {
    '8': 'England',
    '9': 'Scotland',
    '10': 'Wales',
    '11': 'Jersey',
};

export const INDUSTRIES: Record<string, string> = {
    '12': 'Agriculture hunting forestry and fishing',
    '13': 'Construction',
    '14': 'Extractive and utility supply industries',
    '15': 'Manufacturing',
    '16': 'Total service industries',
};

export const HSE_DIVISIONS: Record<string, string> = {
    '17': 'South West',
    '18': 'South East',
    '19': 'East',
    '20': 'North West',
    '21': 'North East',
    '22': 'East Midlands',
    '23': 'West Midlands',
    '24': 'Yorkshire and Humber',
    '25': 'London',
    '26': 'Wales',
    '27': 'Scotland',
};

/** Convictions only ("defendant's Status" picklist). */
export const DEFENDANT_STATUSES: Record<string, string> = {
    '1980': 'Private Company',
    '1972': 'Individual',
    '1981': 'Self Employed (Sole Trader)',
    '1974': 'Self Employed (Employer)',
    '1976': 'Limited Liability Partnership',
    '1978': 'Partnership',
    '1977': 'Local Authority',
    '1973': 'Central Government',
    '1975': 'NHS',
    '1979': 'Other',
};

/**
 * Notices only. The notice-type picklist is not in the wizard's FI list; the
 * codes come from the site's own Improvement/Prohibition radio filter, which
 * expands to `SF=NT / EO=IN / SV=<codes;>` (verified live: 08 -> 7,627
 * notices, 01;02;03 -> 22,424, 04..09 -> 7,650 of 30,226).
 */
export const NOTICE_TYPES: Record<string, string> = {
    '01': 'Improvement Notice',
    '02': 'Improvement Notice (Crown)',
    '03': 'Improvement Notice (other)',
    '04': 'Deferred Prohibition Notice (Crown)',
    '05': 'Immediate Prohibition Notice (Crown)',
    '06': 'Deferred Prohibition Notice',
    '07': 'Prohibition Notice (FEPA)',
    '08': 'Immediate Prohibition Notice',
    '09': 'Prohibition Notice (COMAH)',
};

/** Notices only ("act" picklist, 43 entries as rendered by the site - labels are truncated by the site itself). */
export const ACTS: Record<string, string> = {
    '502': 'Health and Safety At Work Act 1974',
    '517': 'Corp Manslaughter & Corp Homicide 2007',
    '519': 'Manslaughter',
    '518': 'Culpable Homicide',
    '491': 'Factories Act 1961',
    '512': 'Activity Centres Act 1995',
    '490': 'Agriculture (Safety, Health and Welfare)',
    '481': 'Celluloid Act 1922',
    '488': 'Emergency Laws (Misc Provisions) Act 195',
    '504': 'Employment (Continental Shelf) Act 1978',
    '500': 'Employment Medical Advisory Service Act',
    '513': 'Environment Act 1995',
    '507': 'Environmental Protection Act 1990',
    '479': 'Explosives Act 1875',
    '482': 'Explosives Act 1923',
    '515': 'Fire (Scotland) Act 2005',
    '487': 'Fireworks Act 1951',
    '505': 'Food and Environmental Protection Act 19',
    '516': 'Fraud Act 2006',
    '501': 'Gas Act 1972',
    '514': 'Gas Act 1995',
    '499': 'Mineral Workings (Offshore Inst) Act 197',
    '497': 'Mines and Quarries (Tips) Act 1969',
    '489': 'Mines and Quarries Act 1954',
    '495': 'Nuclear Installations Act 1965',
    '478': 'Offences Against the Person Act 1861',
    '494': 'Offices, Shops and Railway Premises Act',
    '511': 'Offshore (Protection Against Victimisati',
    '509': 'Offshore Safety Act 1992',
    '521': 'Other, not elsewhere specified',
    '520': 'Perverting the Course Of Justice',
    '483': 'Petroleum (Consolidation) Act 1928',
    '485': 'Petroleum (Production) Act 1934',
    '486': 'Petroleum (Transfer Of Licences) Act 193',
    '506': 'Petroleum Act 1987',
    '503': 'Petroleum And Submarine Pipelines Act 19',
    '493': 'Pipelines Act 1962',
    '492': 'Public Health Act 1961',
    '484': 'Road and Rail Traffic Act 1933',
    '496': 'Transport Act 1968',
    '510': 'Transport And Works Act 1992',
    '508': 'Water Resources Act 1991',
    '480': 'Women, Young Persons And Children Act 19',
};

/**
 * www.hse.gov.uk/robots.txt (2026-09-07) disallows one specific case detail
 * URL (`/prosecutions/case/case_details.asp?SF=CN&SV=4157835`, the legacy
 * path of this register). resources.hse.gov.uk itself has no robots.txt, but
 * the case is skipped anyway.
 */
export const ROBOTS_DISALLOWED_CASE_NUMBERS: ReadonlySet<string> = new Set(['4157835']);
