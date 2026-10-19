export interface InstagramDmJobPayload {
  pageId: string;
  senderId: string;
  text?: string;
}

export interface InstagramCommentJobPayload {
  pageId: string;
  postId: string;
  commentId: string;
}
