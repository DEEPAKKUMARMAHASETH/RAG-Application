import React, {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {BookOpen, FileText, LogOut, Send, Trash2, Upload} from 'lucide-react';
import './styles.css';

const api = async (path, options = {}) => {
  const token = localStorage.getItem('token');
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {...(options.body instanceof FormData ? {} : {'Content-Type':'application/json'}), ...(token ? {Authorization:`Bearer ${token}`} : {}), ...options.headers}
  });
  if (!response.ok) { const body = await response.json().catch(()=>({})); throw new Error(body.detail || 'Request failed'); }
  return response.status === 204 ? null : response.json();
};

function Auth({onDone}) {
  const [register, setRegister] = useState(false), [error,setError]=useState(''), [busy,setBusy]=useState(false);
  const submit = async e => {
    e.preventDefault(); setBusy(true); setError('');
    const fields=Object.fromEntries(new FormData(e.currentTarget));
    try { const result=await api(register?'/auth/register':'/auth/login',{method:'POST',body:JSON.stringify(fields)}); localStorage.setItem('token',result.access_token); onDone(); }
    catch(err){setError(err.message)} finally{setBusy(false)}
  };
  return <main className="auth"><section className="auth-card"><div className="brand"><BookOpen/> <span>StudySource AI</span></div><h1>{register?'Create your workspace':'Welcome back'}</h1><p>Ask questions from your documents, with sources you can verify.</p><form onSubmit={submit}>{register&&<input name="full_name" placeholder="Full name" required/>}<input name="email" type="email" placeholder="Email address" required/><input name="password" type="password" placeholder="Password (8+ characters)" minLength="8" required/>{error&&<div className="error">{error}</div>}<button disabled={busy}>{busy?'Please wait…':register?'Create account':'Sign in'}</button></form><button className="link" onClick={()=>setRegister(!register)}>{register?'Already registered? Sign in':'New here? Create an account'}</button></section></main>;
}

function App(){
  const [ready,setReady]=useState(false),[docs,setDocs]=useState([]),[messages,setMessages]=useState([]),[question,setQuestion]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[conversation,setConversation]=useState(null);
  const load=async()=>{try{await api('/auth/me');setReady(true);setDocs(await api('/documents'))}catch{setReady(false)}};
  useEffect(()=>{load()},[]);
  if(!ready)return <Auth onDone={load}/>;
  const upload=async e=>{const file=e.target.files[0];if(!file)return;setNotice('Uploading and indexing…');const data=new FormData();data.append('file',file);try{await api('/documents',{method:'POST',body:data});setDocs(await api('/documents'));setNotice('Document is ready.')}catch(err){setNotice(err.message)}e.target.value=''};
  const remove=async id=>{if(!confirm('Delete this document and its vectors?'))return;await api(`/documents/${id}`,{method:'DELETE'});setDocs(await api('/documents'))};
  const send=async e=>{e.preventDefault();if(!question.trim()||busy)return;const q=question.trim();setMessages(m=>[...m,{role:'user',content:q}]);setQuestion('');setBusy(true);try{const r=await api('/chat',{method:'POST',body:JSON.stringify({question:q,conversation_id:conversation})});setConversation(r.conversation_id);setMessages(m=>[...m,{role:'assistant',content:r.answer,citations:r.citations}])}catch(err){setMessages(m=>[...m,{role:'assistant',content:`Error: ${err.message}`}])}finally{setBusy(false)}};
  const logout=()=>{localStorage.removeItem('token');setReady(false)};
  return <div className="shell"><aside><div className="brand"><BookOpen/><span>StudySource AI</span></div><label className="upload"><Upload size={18}/> Upload document<input type="file" accept=".pdf,.docx,.txt" onChange={upload}/></label>{notice&&<small>{notice}</small>}<h3>Knowledge base</h3><div className="docs">{docs.length===0&&<p>No documents yet.</p>}{docs.map(d=><div className="doc" key={d.id}><FileText size={17}/><span title={d.original_name}>{d.original_name}<small>{d.status} · {d.chunk_count} chunks</small></span><button onClick={()=>remove(d.id)} title="Delete"><Trash2 size={15}/></button></div>)}</div><button className="logout" onClick={logout}><LogOut size={17}/> Sign out</button></aside><main className="chat"><header><h2>Ask your documents</h2><p>Answers are grounded in the files in your knowledge base.</p></header><div className="messages">{messages.length===0?<div className="empty"><BookOpen size={42}/><h2>What would you like to learn?</h2><p>Upload a document, then ask a question in English or Hindi.</p></div>:messages.map((m,i)=><article key={i} className={m.role}><strong>{m.role==='user'?'You':'Assistant'}</strong><div>{m.content}</div>{m.citations?.length>0&&<details><summary>{m.citations.length} sources</summary>{m.citations.map((c,j)=><p key={j}><b>{c.filename}{c.page?` · page ${c.page}`:''}</b><br/>{c.excerpt}</p>)}</details>}</article>)}{busy&&<article className="assistant">Searching your documents…</article>}</div><form className="composer" onSubmit={send}><textarea value={question} onChange={e=>setQuestion(e.target.value)} placeholder="Ask a question…" rows="2"/><button disabled={busy}><Send size={19}/></button></form></main></div>
}

createRoot(document.getElementById('root')).render(<App/>);
