export type Addr = { name: string; address: string };

export type Category = "primary" | "promotions" | "social" | "updates" | "forums";

export type FolderRole =
  | "inbox"
  | "sent"
  | "drafts"
  | "spam"
  | "trash"
  | "archive"
  | "snoozed"
  | "label";

export type Folder = {
  path: string;
  name: string;
  role: FolderRole;
  unread: number;
  total: number;
  delimiter: string;
};

export type AttachmentInfo = {
  part: string;
  filename: string;
  contentType: string;
  size: number;
  inline?: boolean;
  cid?: string;
};

export type MessageSummary = {
  id: string;
  folder: string;
  uid: number;
  from: Addr;
  to: Addr[];
  subject: string;
  snippet: string;
  date: string;
  unread: boolean;
  starred: boolean;
  important: boolean;
  draft: boolean;
  attachments: { filename: string; contentType: string }[];
  folderLabel?: string;
  category?: Category;
  threadCount?: number;
};

export type MessageDetail = MessageSummary & {
  cc: Addr[];
  bcc: Addr[];
  replyTo: Addr[];
  messageId: string;
  inReplyTo: string;
  references: string[];
  listUnsubscribe: string | null;
  text: string;
  hasHtml: boolean;
  hasRemoteImages: boolean;
  bodyAttachments: AttachmentInfo[];
  thread: MessageSummary[];
};

export type CategoryTabInfo = {
  key: Category;
  newCount: number;
  preview: string;
};

export type ListResult = {
  messages: MessageSummary[];
  total: number;
  offset: number;
  pageSize: number;
  tabs?: CategoryTabInfo[];
  sections?: { title: string; start: number }[];
};

export type Identity = { name: string; address: string };

export type Me = {
  username: string;
  displayName: string;
  email: string;
  firstName: string;
  picture: string | null;
  identities: Identity[];
  csrf: string;
  quota: { used: number; limit: number } | null;
  demo: boolean;
};
