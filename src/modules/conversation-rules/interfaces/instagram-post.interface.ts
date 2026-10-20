export interface InstagramPost {
  id: string;
  caption: string | null;
  timestamp: string;
  permalink: string;
}

export interface InstagramPostsPaging {
  cursors: { before?: string; after?: string };
}

export interface InstagramPostsResult {
  data: InstagramPost[];
  paging: InstagramPostsPaging | null;
}
