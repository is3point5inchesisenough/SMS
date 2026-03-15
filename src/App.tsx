import React, { useState, useEffect, useRef } from 'react';
import { 
  onAuthStateChanged, 
  signInWithPhoneNumber, 
  RecaptchaVerifier, 
  signOut,
  User
} from 'firebase/auth';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  setDoc, 
  doc, 
  getDoc,
  serverTimestamp,
  orderBy
} from 'firebase/firestore';
import { 
  MessageSquare, 
  Users, 
  FileText, 
  Send, 
  LogOut, 
  Plus, 
  Trash2, 
  Edit2,
  CheckCircle2,
  AlertCircle,
  History,
  Phone,
  LayoutDashboard
} from 'lucide-react';
import { auth, db } from './firebase';
import { UserProfile, Template, MessageLog } from './types';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'single' | 'bulk' | 'templates' | 'history'>('single');
  
  // Auth State
  const [phoneNumber, setPhoneNumber] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [authError, setAuthError] = useState('');
  
  // Data State
  const [templates, setTemplates] = useState<Template[]>([]);
  const [logs, setLogs] = useState<MessageLog[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [messageBody, setMessageBody] = useState('');
  const [recipient, setRecipient] = useState('');
  const [bulkRecipients, setBulkRecipients] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ success: boolean; message: string } | null>(null);

  const recaptchaVerifier = useRef<RecaptchaVerifier | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      if (user) {
        const docRef = doc(db, 'users', user.uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setProfile(docSnap.data() as UserProfile);
        } else {
          const newProfile: UserProfile = {
            uid: user.uid,
            phoneNumber: user.phoneNumber || '',
            role: 'user',
            createdAt: new Date().toISOString(),
          };
          await setDoc(docRef, newProfile);
          setProfile(newProfile);
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Cleanup recaptcha on unmount
  useEffect(() => {
    return () => {
      if (recaptchaVerifier.current) {
        try {
          recaptchaVerifier.current.clear();
        } catch (e) {}
      }
    };
  }, []);

  useEffect(() => {
    if (!user) return;

    const qTemplates = query(collection(db, 'templates'));
    const unsubscribeTemplates = onSnapshot(qTemplates, (snapshot) => {
      setTemplates(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Template)));
    });

    const qLogs = query(
      collection(db, 'messageLogs'), 
      where('senderUid', '==', user.uid),
      orderBy('timestamp', 'desc')
    );
    const unsubscribeLogs = onSnapshot(qLogs, (snapshot) => {
      setLogs(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as MessageLog)));
    });

    return () => {
      unsubscribeTemplates();
      unsubscribeLogs();
    };
  }, [user]);

  const handleSendCode = async () => {
    setAuthError('');
    
    // Ensure we have a clean state for recaptcha
    if (recaptchaVerifier.current) {
      try {
        recaptchaVerifier.current.clear();
      } catch (e) {}
      recaptchaVerifier.current = null;
    }

    const container = document.getElementById('recaptcha-container');
    if (!container) {
      setAuthError("Authentication system error. Please refresh the page.");
      return;
    }

    try {
      // Initialize right before use
      recaptchaVerifier.current = new RecaptchaVerifier(auth, container, {
        size: 'invisible',
        'callback': () => {
          // reCAPTCHA solved
        }
      });

      const formattedPhone = phoneNumber.startsWith('+') ? phoneNumber : `+63${phoneNumber.replace(/^0/, '')}`;
      const confirmationResult = await signInWithPhoneNumber(auth, formattedPhone, recaptchaVerifier.current);
      setVerificationId(confirmationResult.verificationId);
      (window as any).confirmationResult = confirmationResult;
    } catch (error: any) {
      console.error("Auth Error:", error);
      setAuthError(error.message || "Failed to send verification code.");
      
      // Reset on error
      if (recaptchaVerifier.current) {
        try {
          recaptchaVerifier.current.clear();
        } catch (e) {}
        recaptchaVerifier.current = null;
      }
    }
  };

  const handleVerifyCode = async () => {
    setAuthError('');
    try {
      await (window as any).confirmationResult.confirm(verificationCode);
    } catch (error: any) {
      setAuthError('Invalid verification code.');
    }
  };

  const handleSendSMS = async () => {
    if (!user) return;
    setIsSending(true);
    setSendResult(null);

    try {
      const response = await fetch('/api/send-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient, message: messageBody }),
      });
      const data = await response.json();

      if (data.success) {
        await addDoc(collection(db, 'messageLogs'), {
          senderUid: user.uid,
          recipient,
          message: messageBody,
          status: 'sent',
          type: 'single',
          timestamp: serverTimestamp(),
        });
        setSendResult({ success: true, message: 'Message sent successfully!' });
        setRecipient('');
        setMessageBody('');
      } else {
        throw new Error(data.error);
      }
    } catch (error: any) {
      setSendResult({ success: false, message: error.message });
      await addDoc(collection(db, 'messageLogs'), {
        senderUid: user.uid,
        recipient,
        message: messageBody,
        status: 'failed',
        type: 'single',
        timestamp: serverTimestamp(),
      });
    } finally {
      setIsSending(false);
    }
  };

  const handleSendBulkSMS = async () => {
    if (!user) return;
    setIsSending(true);
    setSendResult(null);

    const recipients = bulkRecipients.split(/[\n,]+/).map(r => r.trim()).filter(r => r);

    try {
      const response = await fetch('/api/send-bulk-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipients, message: messageBody }),
      });
      const data = await response.json();

      for (const res of data.results) {
        await addDoc(collection(db, 'messageLogs'), {
          senderUid: user.uid,
          recipient: res.recipient,
          message: messageBody,
          status: res.success ? 'sent' : 'failed',
          type: 'bulk',
          timestamp: serverTimestamp(),
        });
      }

      const successCount = data.results.filter((r: any) => r.success).length;
      setSendResult({ 
        success: true, 
        message: `Bulk send complete: ${successCount}/${recipients.length} successful.` 
      });
      setBulkRecipients('');
      setMessageBody('');
    } catch (error: any) {
      setSendResult({ success: false, message: error.message });
    } finally {
      setIsSending(false);
    }
  };

  const applyTemplate = (template: Template) => {
    setSelectedTemplate(template);
    setMessageBody(template.content);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-600"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 border border-neutral-200">
          <div className="flex flex-col items-center mb-8">
            <div className="bg-emerald-100 p-4 rounded-full mb-4">
              <MessageSquare className="w-8 h-8 text-emerald-600" />
            </div>
            <h1 className="text-2xl font-bold text-neutral-900">PinoySMS</h1>
            <p className="text-neutral-500 text-center mt-2">
              Professional SMS Broadcasting for the Philippines
            </p>
          </div>

          <div id="recaptcha-container"></div>

          {!verificationId ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">
                  Mobile Number
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 font-medium">
                    +63
                  </span>
                  <input
                    type="tel"
                    placeholder="9123456789"
                    className="w-full pl-12 pr-4 py-3 rounded-xl border border-neutral-200 focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, ''))}
                  />
                </div>
              </div>
              <button
                onClick={handleSendCode}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 rounded-xl transition-colors shadow-lg shadow-emerald-200"
              >
                Send Verification Code
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">
                  Verification Code
                </label>
                <input
                  type="text"
                  placeholder="123456"
                  className="w-full px-4 py-3 rounded-xl border border-neutral-200 focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all"
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value)}
                />
              </div>
              <button
                onClick={handleVerifyCode}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 rounded-xl transition-colors shadow-lg shadow-emerald-200"
              >
                Verify & Login
              </button>
              <button
                onClick={() => setVerificationId(null)}
                className="w-full text-neutral-500 text-sm hover:text-neutral-700 transition-colors"
              >
                Change Phone Number
              </button>
            </div>
          )}

          {authError && (
            <div className="mt-4 p-3 bg-red-50 border border-red-100 rounded-lg flex items-start gap-2 text-red-600 text-sm">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <p>{authError}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col md:flex-row">
      {/* Sidebar */}
      <aside className="w-full md:w-64 bg-white border-b md:border-b-0 md:border-r border-neutral-200 flex flex-col">
        <div className="p-6 border-b border-neutral-100 flex items-center gap-3">
          <div className="bg-emerald-600 p-2 rounded-lg">
            <MessageSquare className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-xl text-neutral-900">PinoySMS</span>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          <button
            onClick={() => setView('single')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all",
              view === 'single' ? "bg-emerald-50 text-emerald-700 font-medium" : "text-neutral-600 hover:bg-neutral-50"
            )}
          >
            <Send className="w-5 h-5" />
            Single Message
          </button>
          <button
            onClick={() => setView('bulk')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all",
              view === 'bulk' ? "bg-emerald-50 text-emerald-700 font-medium" : "text-neutral-600 hover:bg-neutral-50"
            )}
          >
            <Users className="w-5 h-5" />
            Bulk Message
          </button>
          <button
            onClick={() => setView('templates')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all",
              view === 'templates' ? "bg-emerald-50 text-emerald-700 font-medium" : "text-neutral-600 hover:bg-neutral-50"
            )}
          >
            <FileText className="w-5 h-5" />
            Templates
          </button>
          <button
            onClick={() => setView('history')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all",
              view === 'history' ? "bg-emerald-50 text-emerald-700 font-medium" : "text-neutral-600 hover:bg-neutral-50"
            )}
          >
            <History className="w-5 h-5" />
            History
          </button>
        </nav>

        <div className="p-4 border-t border-neutral-100">
          <div className="flex items-center gap-3 px-4 py-3 mb-2">
            <div className="w-8 h-8 bg-neutral-200 rounded-full flex items-center justify-center">
              <Phone className="w-4 h-4 text-neutral-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-neutral-900 truncate">{user.phoneNumber}</p>
              <p className="text-xs text-neutral-500 capitalize">{profile?.role}</p>
            </div>
          </div>
          <button
            onClick={() => signOut(auth)}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-red-600 hover:bg-red-50 transition-all"
          >
            <LogOut className="w-5 h-5" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-neutral-900 capitalize">
              {view.replace('-', ' ')}
            </h2>
            <p className="text-neutral-500">
              {view === 'single' && "Send a message to a single recipient."}
              {view === 'bulk' && "Send messages to multiple recipients at once."}
              {view === 'templates' && "Manage your message templates."}
              {view === 'history' && "Review your sent message history."}
            </p>
          </div>

          {/* Views */}
          <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 p-6">
            {(view === 'single' || view === 'bulk') && (
              <div className="space-y-6">
                {/* Template Selector */}
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-2">
                    Select Template (Optional)
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {templates.map(t => (
                      <button
                        key={t.id}
                        onClick={() => applyTemplate(t)}
                        className={cn(
                          "p-3 text-left rounded-xl border transition-all",
                          selectedTemplate?.id === t.id 
                            ? "border-emerald-500 bg-emerald-50 text-emerald-700" 
                            : "border-neutral-200 hover:border-neutral-300 text-neutral-600"
                        )}
                      >
                        <p className="font-medium text-sm truncate">{t.name}</p>
                        <p className="text-xs opacity-70 truncate">{t.content}</p>
                      </button>
                    ))}
                    <button
                      onClick={() => setView('templates')}
                      className="p-3 text-left rounded-xl border border-dashed border-neutral-300 hover:border-neutral-400 text-neutral-500 flex items-center justify-center gap-2"
                    >
                      <Plus className="w-4 h-4" />
                      <span className="text-sm">New Template</span>
                    </button>
                  </div>
                </div>

                {/* Recipient(s) */}
                {view === 'single' ? (
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1">
                      Recipient Mobile Number
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 font-medium">
                        +63
                      </span>
                      <input
                        type="tel"
                        placeholder="9123456789"
                        className="w-full pl-12 pr-4 py-3 rounded-xl border border-neutral-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                        value={recipient}
                        onChange={(e) => setRecipient(e.target.value.replace(/\D/g, ''))}
                      />
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1">
                      Recipients (Comma or New Line separated)
                    </label>
                    <textarea
                      placeholder="9123456789&#10;9987654321"
                      className="w-full px-4 py-3 rounded-xl border border-neutral-200 focus:ring-2 focus:ring-emerald-500 outline-none min-h-[120px]"
                      value={bulkRecipients}
                      onChange={(e) => setBulkRecipients(e.target.value)}
                    />
                    <p className="text-xs text-neutral-500 mt-1">
                      Format: 9123456789 or +639123456789
                    </p>
                  </div>
                )}

                {/* Message Body */}
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">
                    Message Content
                  </label>
                  <textarea
                    placeholder="Enter your message here..."
                    className="w-full px-4 py-3 rounded-xl border border-neutral-200 focus:ring-2 focus:ring-emerald-500 outline-none min-h-[150px]"
                    value={messageBody}
                    onChange={(e) => setMessageBody(e.target.value)}
                  />
                  <div className="flex justify-between mt-1">
                    <p className="text-xs text-neutral-500">
                      Characters: {messageBody.length} | Segments: {Math.ceil(messageBody.length / 160)}
                    </p>
                    <button 
                      onClick={() => setMessageBody('')}
                      className="text-xs text-red-500 hover:underline"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                {/* Result Message */}
                {sendResult && (
                  <div className={cn(
                    "p-4 rounded-xl flex items-start gap-3",
                    sendResult.success ? "bg-emerald-50 text-emerald-700 border border-emerald-100" : "bg-red-50 text-red-700 border border-red-100"
                  )}>
                    {sendResult.success ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <AlertCircle className="w-5 h-5 shrink-0" />}
                    <p className="text-sm font-medium">{sendResult.message}</p>
                  </div>
                )}

                {/* Action Button */}
                <button
                  disabled={isSending || !messageBody || (view === 'single' ? !recipient : !bulkRecipients)}
                  onClick={view === 'single' ? handleSendSMS : handleSendBulkSMS}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-neutral-300 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-emerald-100 flex items-center justify-center gap-2"
                >
                  {isSending ? (
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                  ) : (
                    <>
                      <Send className="w-5 h-5" />
                      {view === 'single' ? 'Send Message' : 'Send Bulk Broadcast'}
                    </>
                  )}
                </button>
              </div>
            )}

            {view === 'templates' && (
              <div className="space-y-6">
                <div className="flex justify-between items-center">
                  <h3 className="font-semibold text-neutral-900">Your Templates</h3>
                  <button 
                    onClick={async () => {
                      const name = prompt('Template Name:');
                      const content = prompt('Template Content:');
                      if (name && content && user) {
                        await addDoc(collection(db, 'templates'), {
                          name,
                          content,
                          createdBy: user.uid,
                          createdAt: serverTimestamp(),
                        });
                      }
                    }}
                    className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    Add New
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  {templates.length === 0 ? (
                    <div className="text-center py-12 text-neutral-500">
                      <FileText className="w-12 h-12 mx-auto mb-4 opacity-20" />
                      <p>No templates yet. Create one to get started!</p>
                    </div>
                  ) : (
                    templates.map(t => (
                      <div key={t.id} className="p-4 border border-neutral-200 rounded-xl hover:border-emerald-200 transition-all">
                        <div className="flex justify-between items-start mb-2">
                          <h4 className="font-bold text-neutral-900">{t.name}</h4>
                          <div className="flex gap-2">
                            <button className="p-1.5 text-neutral-400 hover:text-emerald-600 transition-colors">
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button className="p-1.5 text-neutral-400 hover:text-red-600 transition-colors">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                        <p className="text-sm text-neutral-600 bg-neutral-50 p-3 rounded-lg border border-neutral-100 italic">
                          "{t.content}"
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {view === 'history' && (
              <div className="space-y-6">
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-neutral-100">
                        <th className="pb-4 font-semibold text-sm text-neutral-500">Recipient</th>
                        <th className="pb-4 font-semibold text-sm text-neutral-500">Message</th>
                        <th className="pb-4 font-semibold text-sm text-neutral-500">Status</th>
                        <th className="pb-4 font-semibold text-sm text-neutral-500">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-50">
                      {logs.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="py-12 text-center text-neutral-500">
                            No message history found.
                          </td>
                        </tr>
                      ) : (
                        logs.map(log => (
                          <tr key={log.id} className="group hover:bg-neutral-50 transition-colors">
                            <td className="py-4 text-sm font-medium text-neutral-900">{log.recipient}</td>
                            <td className="py-4 text-sm text-neutral-600 max-w-xs truncate">{log.message}</td>
                            <td className="py-4">
                              <span className={cn(
                                "px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                                log.status === 'sent' ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                              )}>
                                {log.status}
                              </span>
                            </td>
                            <td className="py-4 text-xs text-neutral-400">
                              {log.timestamp ? new Date((log.timestamp as any).seconds * 1000).toLocaleString() : 'Pending...'}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
