export type DatasetName = 'convictions' | 'notices';
export type EventType = 'NEW_LISTING' | 'SANCTION' | 'UPDATED';
export type TriState = 'any' | 'yes' | 'no';
/** Legacy v1 preset, still honoured and mapped onto `dateFrom`. */
export type DateRangePreset = '24h' | '7d' | '30d';

export interface ActorInput {
    // Filters - every one maps to a server-side search criterion on
    // resources.hse.gov.uk (see AGENTS.md for the column codes), except
    // eventTypes which is applied by the delta engine.
    datasets?: DatasetName[];
    nameContains?: string;
    descriptionContains?: string;
    localAuthorityContains?: string;
    mainActivityContains?: string;
    region?: string;
    country?: string;
    industry?: string;
    hseDivision?: string;
    dateFrom?: string;
    dateTo?: string;
    hseReference?: string;
    recordNumber?: string;
    defendantStatus?: string;
    resultingFromFatality?: TriState;
    minTotalFineGbp?: number;
    maxTotalFineGbp?: number;
    noticeTypes?: string[];
    act?: string;
    eventTypes?: EventType[];
    // Monitoring / delta
    onlyNew?: boolean;
    recheckDays?: number;
    deltaStateName?: string;
    resetState?: boolean;
    // Limits & performance
    maxItemsPerDataset?: number;
    fetchDetail?: boolean;
    fetchBreachDetail?: boolean;
    fetchPartyDetail?: boolean;
    maxConcurrency?: number;
    /** @deprecated use dateFrom */
    dateRange?: DateRangePreset;
}

/** One server-side search criterion in the site's own vocabulary. */
export interface Criterion {
    /** Column code, e.g. DN, ODS, UKR, NT */
    sf: string;
    /** F = free text / date / number, P = picklist id */
    sn: 'F' | 'P';
    /** =, <, >, LIKE, IN */
    eo: string;
    sv: string;
}

/** Resolved server-side query for one register. */
export interface RegisterQuery {
    register: DatasetName;
    criteria: Criterion[];
    /** Site sort code (DCN for convictions, DNN for notices - see AGENTS.md). */
    sort: string;
}

export interface ConvictionBreach {
    breachId: string | null;
    court: string | null;
    courtLevel: string | null;
    act: string | null;
    regulation: string | null;
    dateOfHearing: string | null;
    result: string | null;
    fine: string | null;
    // v2: from the per-case breach list (available without a breach page fetch)
    resultListing: string | null;
    actOrRegulation: string | null;
    legislation: string | null;
    provision: string | null;
    paragraph: string | null;
    // v2 normalised twins
    dateOfHearingIso: string | null;
    fineGbp: number | null;
    actName: string | null;
    actSection: string | null;
    actSubSection: string | null;
    regulationName: string | null;
    regulationNumber: string | null;
    regulationParagraph: string | null;
    resultCategory: string | null;
    isCustodial: boolean | null;
    source_url: string | null;
}

export interface NoticeBreach {
    breachId: string | null;
    actOrRegulation: string | null;
    // v2 normalised twins ("Act / reg / para" split)
    legislation: string | null;
    provision: string | null;
    paragraph: string | null;
}

export interface CommonFields {
    // ---- Standardised B2B envelope (shared across this portfolio's fleet) ----
    record_id: string;
    event_type: EventType;
    scraped_at: string;
    is_new: boolean;
    source_url: string;
    data_source: string;

    // ---- Location of offence (raw, as the register renders it) ----
    address: string | null;
    region: string | null;
    localAuthority: string | null;
    industry: string | null;
    mainActivity: string | null;
    typeOfLocation: string | null;
    hseGroup: string | null;
    hseDirectorate: string | null;
    hseArea: string | null;
    hseDivision: string | null;

    // ---- v2 normalised twins ----
    postcode: string | null;
    country: string | null;
    sicCode: string | null;
    sicDescription: string | null;

    // ---- Party (defendant / recipient) page - fetchPartyDetail ----
    partyStatus: string | null;
    partyEntityType: string | null;
    partyAddress: string | null;
    partyPostcode: string | null;
    partyHseReference: string | null;
    partyUrl: string | null;
    partyConvictionCount: number | null;
    partyNoticeCount: number | null;
    partyOtherCaseNumbers: string[] | null;
    partyOtherNoticeNumbers: string[] | null;
    isRepeatOffender: boolean | null;

    // ---- Provenance ----
    detailFetched: boolean;
    detailError: string | null;
    breachDetailFetched: boolean;
    partyDetailFetched: boolean;
    partyDetailError: string | null;
    contentHash: string | null;
    firstSeenAt: string | null;
}

export interface ConvictionRecord extends CommonFields {
    recordType: 'conviction';
    caseNumber: string;
    defendantName: string | null;
    defendantId: string | null;
    description: string | null;
    offenceDate: string | null;
    totalFine: string | null;
    totalCosts: string | null;
    breaches: ConvictionBreach[];
    // v2
    offenceDateIso: string | null;
    totalFineGbp: number | null;
    totalCostsGbp: number | null;
    totalPenaltyGbp: number | null;
    hearingDate: string | null;
    hearingDateIso: string | null;
    resultingFromFatality: boolean | null;
    hasCustodialSentence: boolean | null;
    breachCount: number | null;
    legislationBreached: string[] | null;
    courtLevel: string | null;
}

export interface NoticeRecord extends CommonFields {
    recordType: 'notice';
    noticeNumber: string;
    recipientName: string | null;
    recipientId: string | null;
    noticeType: string | null;
    servedDate: string | null;
    description: string | null;
    complianceDate: string | null;
    revisedComplianceDate: string | null;
    result: string | null;
    breaches: NoticeBreach[];
    // v2
    noticeTypeListing: string | null;
    noticeCategory: string | null;
    isProhibition: boolean | null;
    isImprovement: boolean | null;
    isImmediate: boolean | null;
    isDeferred: boolean | null;
    isCrown: boolean | null;
    isComah: boolean | null;
    isFepa: boolean | null;
    servedDateIso: string | null;
    complianceDateIso: string | null;
    revisedComplianceDateIso: string | null;
    effectiveComplianceDateIso: string | null;
    daysToComply: number | null;
    daysUntilCompliance: number | null;
    hasRevisedComplianceDate: boolean | null;
    isOngoing: boolean | null;
    isCompliedWith: boolean | null;
    isOverdue: boolean | null;
    descriptionItemIds: string[] | null;
    breachCount: number | null;
    legislationBreached: string[] | null;
}

export type HseRecord = ConvictionRecord | NoticeRecord;

export const DATA_SOURCE_ATTRIBUTION =
    'Contains public sector information published by the Health and Safety Executive and licensed under the Open Government Licence v3.0 (HSE public registers of convictions and enforcement notices, resources.hse.gov.uk)';
