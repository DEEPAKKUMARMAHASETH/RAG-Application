import React, {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {BookOpen, FileText, LogOut, MessageSquare, Pencil, Plus, Send, Trash2, Upload} from 'lucide-react';
import './styles.css';

const api = async (path, options = {}) => {
  const token = localStorage.getItem('token');
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {...(options.body instanceof FormData ? {} : {'Content-Type': 'application/json'}), ...(token ? {Authorization: `Bearer ${token}`} : {}), ...options.headers},
  });
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.detail || 'Request failed'); }
  return response.status === 204 ? null : response.json();
};

function Auth({onDone}) {
  const [register, setRegister] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const submit = async event => {
    event.preventDefault(); setBusy(true); setError('');
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    try { const result = await api(register ? '/auth/register' : '/auth/login', {method: 'POST', body: JSON.stringify(fields)}); localStorage.setItem('token', result.access_token); onDone(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return <main className="auth"><section className="auth-card"><div className="brand"><BookOpen/><span>StudySource AI</span></div><h1>{register ? 'Create your workspace' : 'Welcome back'}</h1><p>Ask questions from your documents, with sources you can verify.</p><form onSubmit={submit}>{register && <input name="full_name" placeholder="Full name" required/>}<input name="email" type="email" placeholder="Email address" required/><input name="password" type="password" placeholder="Password (8+ characters)" minLength="8" required/>{error && <div className="error">{error}</div>}<button disabled={busy}>{busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'}</button></form><button className="link" onClick={() => setRegister(!register)}>{register ? 'Already registered? Sign in' : 'New here? Create an account'}</button></section></main>;
}

function App() {
  const [ready, setReady] = useState(false), [docs, setDocs] = useState([]), [threads, setThreads] = useState([]);
  const [messages, setMessages] = useState([]), [question, setQuestion] = useState(''), [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(''), [conversation, setConversation] = useState(null), [selectedDocs, setSelectedDocs] = useState([]);
  const refreshThreads = async () => setThreads(await api('/conversations'));
  const openThread = async id => { try { const data = await api(`/conversations/${id}`); setConversation(id); setMessages(data.messages); localStorage.setItem('conversation_id', String(id)); } catch (err) { setNotice(err.message); } };
  const load = async () => {
    try { await api('/auth/me'); const [documents, conversations] = await Promise.all([api('/documents'), api('/conversations')]); setDocs(documents); setThreads(conversations); setReady(true); const saved = Number(localStorage.getItem('conversation_id')); if (saved && conversations.some(item => item.id === saved)) await openThread(saved); }
    catch { setReady(false); }
  };
  useEffect(() => { load(); }, []);
  const newChat = () => { setConversation(null); setMessages([]); setQuestion(''); localStorage.removeItem('conversation_id'); };
  const renameThread = async (event, item) => { event.stopPropagation(); const title = prompt('Conversation title', item.title); if (!title?.trim()) return; await api(`/conversations/${item.id}`, {method: 'PATCH', body: JSON.stringify({title: title.trim()})}); await refreshThreads(); };
  const removeThread = async (event, id) => { event.stopPropagation(); if (!confirm('Delete this conversation?')) return; await api(`/conversations/${id}`, {method: 'DELETE'}); if (conversation === id) newChat(); await refreshThreads(); };
  const upload = async event => { const file = event.target.files[0]; if (!file) return; setNotice('Uploading and indexing…'); const data = new FormData(); data.append('file', file); try { await api('/documents', {method: 'POST', body: data}); setDocs(await api('/documents')); setNotice('Document is ready.'); } catch (err) { setNotice(err.message); } event.target.value = ''; };
  const removeDocument = async id => { if (!confirm('Delete this document and its vectors?')) return; await api(`/documents/${id}`, {method: 'DELETE'}); setSelectedDocs(current => current.filter(item => item !== id)); setDocs(await api('/documents')); };
  const toggleDocument = id => setSelectedDocs(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  const send = async event => {
    event?.preventDefault(); if (!question.trim() || busy) return; const text = question.trim(); setMessages(current => [...current, {role: 'user', content: text}]); setQuestion(''); setBusy(true);
    try { const result = await api('/chat', {method: 'POST', body: JSON.stringify({question: text, conversation_id: conversation, document_ids: selectedDocs.length ? selectedDocs : null})}); setConversation(result.conversation_id); localStorage.setItem('conversation_id', String(result.conversation_id)); setMessages(current => [...current, {role: 'assistant', content: result.answer, citations: result.citations}]); await refreshThreads(); }
    catch (err) { setMessages(current => [...current, {role: 'assistant', content: `Error: ${err.message}`}]); } finally { setBusy(false); }
  };
  const onComposerKeyDown = event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } };
  const logout = () => { localStorage.removeItem('token'); localStorage.removeItem('conversation_id'); setReady(false); };
  if (!ready) return <Auth onDone={load}/>;

  return <div className="shell"><aside><div className="brand"><BookOpen/><span>StudySource AI</span></div><button className="new-chat" onClick={newChat}><Plus size={18}/> New chat</button><h3>Conversations</h3><div className="threads">{threads.length === 0 && <p>No conversations yet.</p>}{threads.map(item => <div key={item.id} className={`thread ${conversation === item.id ? 'active' : ''}`} onClick={() => openThread(item.id)}><MessageSquare size={15}/><span>{item.title}</span><button onClick={event => renameThread(event, item)} title="Rename"><Pencil size={13}/></button><button onClick={event => removeThread(event, item.id)} title="Delete"><Trash2 size={13}/></button></div>)}</div><label className="upload"><Upload size={18}/> Upload document<input type="file" accept=".pdf,.docx,.txt" onChange={upload}/></label>{notice && <small>{notice}</small>}<h3>Knowledge base</h3><div className="docs">{docs.length === 0 && <p>No documents yet.</p>}{docs.map(doc => <div className={`doc ${selectedDocs.includes(doc.id) ? 'selected' : ''}`} key={doc.id} onClick={() => toggleDocument(doc.id)}><input type="checkbox" checked={selectedDocs.includes(doc.id)} onChange={() => toggleDocument(doc.id)} onClick={event => event.stopPropagation()}/><FileText size={17}/><span title={doc.original_name}>{doc.original_name}<small>{doc.status} · {doc.chunk_count} chunks</small></span><button onClick={event => { event.stopPropagation(); removeDocument(doc.id); }} title="Delete"><Trash2 size={15}/></button></div>)}</div><p className="selection-note">{selectedDocs.length ? `${selectedDocs.length} document(s) selected` : 'Searching all documents'}</p><button className="logout" onClick={logout}><LogOut size={17}/> Sign out</button></aside><main className="chat"><header><h2>{conversation ? threads.find(item => item.id === conversation)?.title || 'Conversation' : 'New conversation'}</h2><p>Enter sends · Shift+Enter adds a new line</p></header><div className="messages">{messages.length === 0 ? <div className="empty"><BookOpen size={42}/><h2>What would you like to learn?</h2><p>Choose documents or search your complete knowledge base.</p></div> : messages.map((message, index) => <article key={message.id || index} className={message.role}><strong>{message.role === 'user' ? 'You' : 'Assistant'}</strong><div>{message.content}</div>{message.citations?.length > 0 && <details><summary>{message.citations.length} sources</summary>{message.citations.map((citation, citationIndex) => <p key={citationIndex}><b>{citation.filename}{citation.page ? ` · page ${citation.page}` : ''}</b><br/>{citation.excerpt}</p>)}</details>}</article>)}{busy && <article className="assistant">Searching your documents…</article>}</div><form className="composer" onSubmit={send}><textarea value={question} onChange={event => setQuestion(event.target.value)} onKeyDown={onComposerKeyDown} placeholder="Ask a question…" rows="2"/><button disabled={busy || !question.trim()} title="Send"><Send size={19}/></button></form></main></div>;
}

createRoot(document.getElementById('root')).render(<App/>);
