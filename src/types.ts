export interface UserProfile {
  uid: string;
  phoneNumber: string;
  role: 'admin' | 'user';
  createdAt: string;
}

export interface Template {
  id: string;
  name: string;
  content: string;
  createdBy: string;
  createdAt: string;
}

export interface MessageLog {
  id: string;
  senderUid: string;
  recipient: string;
  message: string;
  status: 'sent' | 'failed';
  type: 'single' | 'bulk';
  timestamp: string;
}
