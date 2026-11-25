// Keep on-chain integer basis points unchanged; accept decimal percent in the UI.
export function percentToBps(value){
 const s=String(value).trim();
 if(!/^\d{1,3}(?:\.\d{1,2})?$/.test(s))throw Error('Enter a percentage from 0 to 100 with up to two decimal places.');
 const [whole,fraction='']=s.split('.');const bps=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 if(bps>10000)throw Error('Percentage cannot exceed 100.');return bps;
}
export function batchStatus(b,hasReceipt=false){
 if(hasReceipt)return {label:'Clearance issued',tone:'success'};
 if(b.issuance==='running')return {label:'Generating clearance',tone:'pending'};
 if(b.issuance==='reconcile')return {label:'Review required',tone:'warning'};
 if(b.status==='signed')return {label:'Report signed',tone:'neutral'};
 if(b.status==='accepted')return {label:'Inspection accepted',tone:'neutral'};
 if(b.status==='assigned')return {label:'Awaiting acceptance',tone:'pending'};
 if(b.status==='declined')return {label:'Declined',tone:'warning'};
 return {label:'Awaiting inspector',tone:'pending'};
}
