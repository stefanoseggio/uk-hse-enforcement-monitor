export type DatasetName = 'convictions' | 'notices';

export interface ActorInput {
    datasets: DatasetName[];
    fetchBreachDetail: boolean;
    maxItemsPerDataset: number;
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
}

export interface NoticeBreach {
    breachId: string | null;
    actOrRegulation: string | null;
}

interface CommonFields {
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
    detailUrl: string;
    scrapedAt: string;
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
}

export type HseRecord = ConvictionRecord | NoticeRecord;
