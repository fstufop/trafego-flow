export interface IInstagramGraphService {
  sendTextMessage(pageId: string, recipientIgsid: string, text: string): Promise<void>;
  sendQuickReplies(pageId: string, recipientIgsid: string, text: string, options: string[]): Promise<void>;
  markSeen(pageId: string, recipientIgsid: string): Promise<void>;
}
