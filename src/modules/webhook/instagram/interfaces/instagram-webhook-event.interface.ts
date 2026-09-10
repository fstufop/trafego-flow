export interface InstagramWebhookPayload {
  object: 'instagram';
  entry: InstagramEntry[];
}

export interface InstagramEntry {
  id: string;
  time: number;
  messaging?: InstagramMessagingEvent[];
  changes?: InstagramCommentChangeEvent[];
}

export interface InstagramMessagingEvent {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: { mid: string; text?: string; attachments?: InstagramAttachment[] };
  reaction?: { mid: string; action: string; emoji?: string };
  read?: { mid: string };
}

export interface InstagramAttachment {
  type: string;
  payload: { url?: string };
}

export interface InstagramCommentChangeEvent {
  field: 'comments';
  value: {
    from: { id: string; name: string };
    post_id: string;
    comment_id: string;
    message: string;
    item: 'comment';
    verb: 'add' | 'edited' | 'remove';
  };
}
