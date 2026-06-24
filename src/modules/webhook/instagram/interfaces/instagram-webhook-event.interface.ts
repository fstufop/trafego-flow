export interface InstagramWebhookPayload {
  object: 'instagram';
  entry: InstagramEntry[];
}

export interface InstagramEntry {
  id: string;
  time: number;
  messaging?: InstagramMessagingEvent[];
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
