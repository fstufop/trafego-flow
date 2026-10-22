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
  postback?: { mid?: string; title?: string; payload: string };
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
    from: { id: string; username: string };
    media: { id: string; media_product_type?: string };
    id: string;
    parent_id?: string;
    text: string;
  };
}
