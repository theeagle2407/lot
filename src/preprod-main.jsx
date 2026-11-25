import React from 'react';
import {createRoot} from 'react-dom/client';
import './preprod-base.css';
import PublicBuyer from './PreprodBuyer.jsx';
import PublicClearanceIndex from './PublicClearanceIndex.jsx';
const showIndex=window.location.pathname==='/'&&!window.location.search;
createRoot(document.getElementById('root')).render(showIndex?<PublicClearanceIndex/>:<PublicBuyer publicSite/>);
