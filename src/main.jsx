import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
const root=createRoot(document.getElementById('root'));
const path=window.location.pathname.replace(/\/+$/, '')||'/';
const Page=React.lazy(()=>path==='/verify-preprod'?import('./PreprodBuyer.jsx'):import('./App.jsx'));
root.render(<React.StrictMode><React.Suspense fallback={<div role="status" style={{padding:24}}>Opening LOT…</div>}><Page workspace={path==='/verify-preprod'}/></React.Suspense></React.StrictMode>);
