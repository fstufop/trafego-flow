import type { SearchAdLibraryDto } from '../dto/search-ad-library.dto.js';

export interface InsightsRange {
  lowerBound: string;
  upperBound: string;
}

export interface AudienceDistribution {
  age?: string;
  gender?: string;
  region?: string;
  percentage: string;
}

export interface TargetLocation {
  name: string;
  type: string;
}

export interface AdLibraryAdvertiser {
  pageId: string;
  pageName: string;
  fundingEntity: string | null;
  spend: InsightsRange | null;
  impressions: InsightsRange | null;
  estimatedAudienceSize: InsightsRange | null;
  brTotalReach: number | null;
  adDeliveryStartTime: string;
  adDeliveryStopTime: string | null;
  publisherPlatforms: string[];
  languages: string[];
  demographicDistribution: AudienceDistribution[];
  deliveryByRegion: AudienceDistribution[];
  targetAges: string[];
  targetGender: string | null;
  targetLocations: TargetLocation[];
  adSnapshotUrl: string;
}

export interface AdLibraryPaging {
  cursors: { before: string; after: string };
}

export interface AdLibrarySearchResult {
  data: AdLibraryAdvertiser[];
  paging: AdLibraryPaging | null;
  total: number;
}

export interface IAdLibraryService {
  search(dto: SearchAdLibraryDto): Promise<AdLibrarySearchResult>;
}

export interface RawMetaAd {
  page_id: string;
  page_name: string;
  bylines?: string;
  spend?: { lower_bound: string; upper_bound: string };
  impressions?: { lower_bound: string; upper_bound: string };
  estimated_audience_size?: { lower_bound: string; upper_bound: string };
  br_total_reach?: number;
  ad_delivery_start_time: string;
  ad_delivery_stop_time?: string;
  publisher_platforms?: string[];
  languages?: string[];
  demographic_distribution?: Array<{ age?: string; gender?: string; percentage: string }>;
  delivery_by_region?: Array<{ region?: string; percentage: string }>;
  target_ages?: string[];
  target_gender?: string;
  target_locations?: Array<{ name: string; type: string }>;
  ad_snapshot_url: string;
}

export interface MetaAdLibraryResponse {
  data: RawMetaAd[];
  paging?: {
    cursors?: { before: string; after: string };
    next?: string;
  };
}
