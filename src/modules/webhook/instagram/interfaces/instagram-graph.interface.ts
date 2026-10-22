export interface IInstagramGraphService {
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
