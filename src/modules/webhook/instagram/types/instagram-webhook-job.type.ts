export interface InstagramDmJobPayload {
  pageId: string;
  senderId: string;
  text?: string;
}

export interface InstagramCommentJobPayload {
  pageId: string;
  postId: string;
  commentId: string;
  text: string;
}

export interface InstagramPostbackJobPayload {
  pageId: string;
  senderId: string;
  payload: string;
}
