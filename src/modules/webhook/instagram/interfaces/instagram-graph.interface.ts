export interface InstagramFollowStatus {
  id: string;
  name?: string;
  username?: string;
  follower_count?: number;
  is_user_follow_business?: boolean;
  is_business_follow_user?: boolean;
}

export interface IInstagramGraphService {
  getFollowStatus(
    pageId: string,
    igsid: string,
  ): Promise<InstagramFollowStatus>;
  subscribeAccountToWebhooks(
    pageId: string,
    fields: string[],
  ): Promise<{ success: boolean }>;
  sendTextMessage(
    pageId: string,
    recipientIgsid: string,
    text: string,
  ): Promise<void>;
  sendQuickReplies(
    pageId: string,
    recipientIgsid: string,
    text: string,
    options: string[],
  ): Promise<void>;
  sendCommentPrivateReply(
    pageId: string,
    commentId: string,
    text: string,
  ): Promise<void>;
  markSeen(pageId: string, recipientIgsid: string): Promise<void>;
  replyToComment(
    pageId: string,
    commentId: string,
    message: string,
  ): Promise<void>;
  sendButtonTemplate(
    pageId: string,
    recipientIgsid: string,
    text: string,
    buttonTitle: string,
    buttonUrl: string,
  ): Promise<void>;
  setIceBreakers(
    pageId: string,
    questions: Array<{ question: string; payload: string }>,
  ): Promise<void>;
}
