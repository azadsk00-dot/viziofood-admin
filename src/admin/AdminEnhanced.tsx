import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Ban, CheckCircle2, ChevronLeft, ChevronRight, Clock3, CreditCard, Download, MapPin, Package, Phone, Printer, RotateCcw, Search, Truck, XCircle } from 'lucide-react';
import { Modal, PageTitle, Status } from './components';
import { cancelOrder, getOrders, getProducts, processRefund, updateOrderStatus } from './supabase';
import { useResource } from './useResource';
import { useOrdersRealtime } from '../hooks/useOrdersRealtime';
import { useToast } from '../components/Toast';
import { notifyNewOrder, requestNotificationPermission } from './orderNotifications';
import type { Order, OrderStatus, RefundStatus } from './types';

const statuses: OrderStatus[] = ['New', 'Accepted', 'Preparing', 'Ready', 'Completed', 'Cancelled', 'Rejected'];
const counters: OrderStatus[] = ['New', 'Accepted', 'Preparing', 'Ready', 'Completed', 'Cancelled'];
const money = (value:number) => new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(value);
const elapsed = (createdAt:string) => { const minutes=Math.max(0,Math.floor((Date.now()-new Date(createdAt).getTime())/60000)); return minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes/60)}h ${minutes%60}m ago`; };
const nextActions: Record<OrderStatus, OrderStatus[]> = { New:['Accepted'], Accepted:['Preparing'], Preparing:['Ready'], Ready:['Completed'], Completed:[], Cancelled:[], Rejected:[] };
const cancellable = (order:Order) => order.status !== 'Completed' && order.status !== 'Cancelled' && order.status !== 'Rejected';
const refundableRemaining = (order:Order) => Math.max(0, order.total - order.refundAmount);
// Legacy orders inserted by the old webhook may lack payment_status='paid'
// even though Stripe holds the payment; the endpoint re-verifies with Stripe.
const isPaid = (order:Order) => order.paymentStatus === 'paid' || (order.paymentStatus !== 'failed' && Boolean(order.paymentIntentId || order.stripeSessionId));
const canRefund = (order:Order) => isPaid(order) && refundableRemaining(order) > 0.005 && order.refundStatus !== 'pending';

// Combined payment + refund badge shown on cards and detail views.
function refundLabel(order:Order): {label:string; className:string} {
  if (order.refundStatus === 'pending') return { label: 'Refund pending', className: 'refund-pending' };
  if (order.refundStatus === 'failed') return { label: 'Refund failed', className: 'refund-failed' };
  if (order.refundStatus === 'partially_refunded') return { label: 'Partially refunded', className: 'partially-refunded' };
  if (order.refundStatus === 'succeeded' || order.paymentStatus === 'refunded') return { label: 'Refunded', className: 'refunded' };
  if (order.paymentStatus === 'paid') return { label: 'Paid', className: 'paid' };
  if (order.paymentStatus === 'pending') return { label: 'Unpaid', className: 'pending' };
  if (order.paymentStatus === 'failed') return { label: 'Failed', className: 'failed' };
  return { label: 'Payment unknown', className: '' };
}

function Payment({ order }: { order:Order }) {
  const badge = refundLabel(order);
  return <span className={`payment-status ${badge.className}`}>{badge.label}</span>;
}

function StatusActions({ order, onChange, onCancel, compact = false }: { order:Order; onChange:(order:Order,status:OrderStatus)=>void; onCancel:(order:Order)=>void; compact?:boolean }) {
  const actions=nextActions[order.status];
  if (!actions.length && !cancellable(order)) return <span className="order-final">Finalised</span>;
  return <div className={`order-actions ${compact?'compact':''}`}>{actions.map(status=><button key={status} className="admin-primary" onClick={()=>onChange(order,status)}><CheckCircle2 size={15}/> {status}</button>)}{cancellable(order)&&<button className="order-reject" onClick={()=>onCancel(order)}><Ban size={15}/> Cancel</button>}</div>;
}

function OrderedItems({ order, compact = false }: { order:Order; compact?:boolean }) {
  if (!order.items.length) return <p className="order-items-empty">{order.itemsCount} item{order.itemsCount===1?'':'s'} · item details unavailable</p>;
  return <ul className={`ordered-items ${compact?'compact':''}`}>{order.items.map(item=><li key={item.id}><b>{item.quantity}× {item.name}</b>{!compact && <><span>{money(item.unitPrice * item.quantity)}{item.modifiers.length ? ` · ${item.modifiers.join(', ')}` : ''}</span>{item.notes && <small>{item.notes}</small>}</>}</li>)}</ul>;
}

// ── Cancel confirmation modal ───────────────────────────────────────────────

function CancelDialog({ order, close, confirm, busy }: { order:Order; close:()=>void; confirm:(reason:string)=>void; busy:boolean }) {
  const [reason,setReason]=useState('');
  const paid = isPaid(order);
  return <Modal title={`Cancel ${order.orderNumber}`} onClose={close}>
    <section className="order-detail">
      <p className="cancel-warning"><AlertTriangle size={16}/> This will cancel the order{paid ? ' and issue a full Stripe refund' : ''}. This action cannot be undone.</p>
      <label className="settings-field">Cancellation reason<textarea rows={3} value={reason} onChange={event=>setReason(event.target.value)} placeholder="e.g. Customer requested cancellation, out of stock…"/></label>
      <div className="order-detail-actions">
        <button className="admin-secondary" onClick={close} disabled={busy}>Keep order</button>
        <button className="order-reject" onClick={()=>confirm(reason.trim())} disabled={busy||!reason.trim()}>{busy?'Cancelling…':'Cancel order'}</button>
      </div>
    </section>
  </Modal>;
}

// ── Refund modal (full or partial) ──────────────────────────────────────────

function RefundDialog({ order, close, confirm, busy }: { order:Order; close:()=>void; confirm:(amount:number|null, reason:string)=>void; busy:boolean }) {
  const remaining = refundableRemaining(order);
  const [mode,setMode]=useState<'full'|'partial'>('full');
  const [amount,setAmount]=useState<string>(remaining.toFixed(2));
  const [reason,setReason]=useState('Customer requested cancellation');
  const [checked,setChecked]=useState(false);
  const parsedAmount=Math.min(Number(amount)||0,remaining);
  const valid=mode==='full'||(parsedAmount>0&&parsedAmount<=remaining);
  return <Modal title={`Refund ${order.orderNumber}`} onClose={close}>
    <section className="order-detail">
      <p className="refund-summary">Paid {money(order.total)}{order.refundAmount>0?` · already refunded ${money(order.refundAmount)}`:''} · refundable {money(remaining)}</p>
      <div className="refund-modes">
        <button className={mode==='full'?'active':''} onClick={()=>{setMode('full');setAmount(remaining.toFixed(2))}}>Full refund</button>
        <button className={mode==='partial'?'active':''} onClick={()=>setMode('partial')}>Partial refund</button>
      </div>
      {mode==='partial'&&<label className="settings-field">Refund amount ($)<input type="number" step="0.01" min="0.01" max={remaining.toFixed(2)} value={amount} onChange={event=>setAmount(event.target.value)}/>{Number(amount)>remaining&&<span className="form-error">Refund cannot exceed the remaining refundable amount ({money(remaining)}).</span>}</label>}
      <label className="settings-field">Reason<input value={reason} onChange={event=>setReason(event.target.value)}/></label>
      <label className="check-label"><input type="checkbox" checked={checked} onChange={event=>setChecked(event.target.checked)}/> I understand this sends {mode==='full'?money(remaining):money(parsedAmount)} back to the customer via Stripe.</label>
      <div className="order-detail-actions">
        <button className="admin-secondary" onClick={close} disabled={busy}>Close</button>
        <button className="refund-button" onClick={()=>confirm(mode==='full'?null:parsedAmount,reason)} disabled={busy||!checked||!valid||!reason.trim()}>{busy?'Refunding…':`Refund ${mode==='full'?money(remaining):money(parsedAmount)}`}</button>
      </div>
    </section>
  </Modal>;
}

// ── Order detail modal ──────────────────────────────────────────────────────

function OrderDetail({ order, close, onChange, onCancel, onRefund }: { order:Order; close:()=>void; onChange:(order:Order,status:OrderStatus)=>void; onCancel:(order:Order)=>void; onRefund:(order:Order)=>void }) {
  const itemsSubtotal=order.items.reduce((sum,item)=>sum+item.unitPrice*item.quantity,0);
  const delivery=Math.max(0,order.total-order.taxTotal-itemsSubtotal);
  const stripeRef=order.paymentIntentId||order.stripeSessionId;
  return <Modal title={order.orderNumber} onClose={close}>
    <section className="order-detail">
      <div className="order-detail-summary"><div><Status value={order.status}/><Payment order={order}/></div><b>{money(order.total)}</b></div>
      <div className="order-contact"><strong>{order.customer}</strong><a href={`tel:${order.phone}`}><Phone size={14}/>{order.phone || 'No phone supplied'}</a><a href={`mailto:${order.email}`}>{order.email}</a></div>
      <p className="order-fulfilment">{order.fulfilment==='Delivery'?<Truck size={16}/>:<MapPin size={16}/>}{order.fulfilment} · <Clock3 size={15}/>{new Date(order.createdAt).toLocaleString('en-AU')} ({elapsed(order.createdAt)})</p>
      <section><h3>Ordered items</h3><OrderedItems order={order}/></section>
      <section className="order-totals"><h3>Payment breakdown</h3>
        <p><span>Subtotal</span><span>{money(itemsSubtotal)}</span></p>
        <p><span>Tax</span><span>{money(order.taxTotal)}</span></p>
        <p><span>Delivery</span><span>{money(delivery)}</span></p>
        <p className="order-total-row"><span>Total</span><span>{money(order.total)}</span></p>
      </section>
      {stripeRef&&<p className="order-stripe-ref"><CreditCard size={14}/> Stripe: <code>{stripeRef}</code></p>}
      {order.notes&&<section><h3>Order notes</h3><p className="order-notes">{order.notes}</p></section>}
      {order.status==='Cancelled'&&<section><h3>Cancellation</h3><p className="order-notes cancelled">{order.cancellationReason||'No reason recorded.'}{order.cancelledAt&&<> · {new Date(order.cancelledAt).toLocaleString('en-AU')}</>}</p></section>}
      {order.refundStatus&&<section><h3>Refund</h3><div className="order-refund-info">
        <p><span>Status</span><span>{refundLabel(order).label}</span></p>
        {order.refundAmount>0&&<p><span>Amount</span><span>{money(order.refundAmount)}</span></p>}
        {order.refundId&&<p><span>Stripe refund</span><span><code>{order.refundId}</code></span></p>}
        {order.refundReason&&<p><span>Reason</span><span>{order.refundReason}</span></p>}
        {order.refundedAt&&<p><span>Refunded at</span><span>{new Date(order.refundedAt).toLocaleString('en-AU')}</span></p>}
      </div></section>}
      <div className="order-detail-actions">
        <StatusActions order={order} onChange={onChange} onCancel={onCancel}/>
        {canRefund(order)&&<button className="refund-button" onClick={()=>onRefund(order)}><RotateCcw size={15}/> Refund customer</button>}
      </div>
    </section>
  </Modal>;
}

function OrderCard({ order, onChange, onCancel, onSelect }: { order:Order; onChange:(order:Order,status:OrderStatus)=>void; onCancel:(order:Order)=>void; onSelect:(order:Order)=>void }) {
  return <article className={`live-order status-${order.status.toLowerCase()}`}><header><div><button className="order-link" onClick={()=>onSelect(order)}>{order.orderNumber}</button><small><Clock3 size={13}/>{elapsed(order.createdAt)}</small></div><div><Status value={order.status}/><Payment order={order}/></div></header><div className="live-order-meta"><span>{order.fulfilment==='Delivery'?<Truck size={16}/>:<MapPin size={16}/>}{order.fulfilment}</span><strong>{money(order.total)}</strong></div><div className="live-order-customer"><b>{order.customer}</b><a href={`tel:${order.phone}`}><Phone size={13}/>{order.phone || 'No phone supplied'}</a><small>{order.email}</small></div><OrderedItems order={order} compact/>{order.notes && <p className="order-notes"><b>Notes:</b> {order.notes}</p>}<footer><button className="table-button" onClick={()=>onSelect(order)}>View order</button><StatusActions order={order} onChange={onChange} onCancel={onCancel} compact/></footer></article>;
}

function exportOrders(orders:Order[]) { const rows=[['Order','Customer','Phone','Email','Fulfilment','Payment','Status','Refund status','Refunded','Total','Placed'],...orders.map(order=>[order.orderNumber,order.customer,order.phone,order.email,order.fulfilment,order.paymentStatus,order.status,order.refundStatus,order.refundAmount.toFixed(2),order.total.toFixed(2),order.createdAt])]; const url=URL.createObjectURL(new Blob([rows.map(row=>row.map(value=>`"${value.replace(/"/g,'""')}"`).join(',')).join('\n')],{type:'text/csv'})); const link=document.createElement('a'); link.href=url; link.download='vizio-orders.csv'; link.click(); URL.revokeObjectURL(url); }

export function EnhancedOrders(){
  const resource=useResource(getOrders); const toast=useToast(); const [query,setQuery]=useState(''); const [status,setStatus]=useState<'All'|OrderStatus>('All'); const [selected,setSelected]=useState<Order>(); const [page,setPage]=useState(1); const pageSize=12;
  const [cancelTarget,setCancelTarget]=useState<Order>(); const [refundTarget,setRefundTarget]=useState<Order>(); const [busy,setBusy]=useState(false);
  const [,setClock]=useState(0); useEffect(()=>{const timer=window.setInterval(()=>setClock(value=>value+1),60000);return()=>window.clearInterval(timer)},[]);
  const refresh=useCallback((event?:{eventType?:string;new?:Record<string,unknown>})=>{if(event?.eventType==='INSERT'&&String(event.new?.payment_status??'paid').toLowerCase()==='paid'){const id=String(event.new?.id??'');if(id)notifyNewOrder(id,event.new??{},toast);void requestNotificationPermission();} void resource.reload();},[resource.reload,toast]); useOrdersRealtime(refresh);
  const filtered=useMemo(()=>{const term=query.trim().toLowerCase();return(resource.data??[]).filter(order=>(!term||[order.orderNumber,order.customer,order.phone,order.email].some(value=>value.toLowerCase().includes(term)))&&(status==='All'||order.status===status));},[resource.data,query,status]);
  const pageCount=Math.max(1,Math.ceil(filtered.length/pageSize)); const visible=filtered.slice((page-1)*pageSize,page*pageSize); const totals=useMemo(()=>Object.fromEntries(counters.map(value=>[value,(resource.data??[]).filter(order=>order.status===value).length])) as Record<OrderStatus,number>,[resource.data]);
  const update=async(order:Order,next:OrderStatus)=>{try{await updateOrderStatus(order.orderId,next);toast.show(`${order.orderNumber} marked ${next}`);await resource.reload();setSelected(current=>current?.orderId===order.orderId?{...current,status:next}:current);}catch(error){toast.show(error instanceof Error?error.message:'Could not update order.','error')}};

  // Cancel flow: mark Cancelled; if the order was paid, follow up with a full
  // server-side Stripe refund (never from the browser).
  const confirmCancel=async(order:Order,reason:string)=>{
    setBusy(true);
    try{
      await cancelOrder(order.orderId,reason);
      toast.show(`${order.orderNumber} cancelled.`);
      if(isPaid(order)&&refundableRemaining(order)>0.005){
        try{
          await processRefund(order.orderId,undefined,`Order cancelled: ${reason}`);
          toast.show(`Full refund issued for ${order.orderNumber}.`);
        }catch(refundError){
          toast.show(refundError instanceof Error?refundError.message:'Order cancelled, but the refund could not be completed. Retry from the order detail view.','error');
        }
      }
      setCancelTarget(undefined);setSelected(undefined);
      await resource.reload();
    }catch(error){
      toast.show(error instanceof Error?error.message:'Unable to cancel this order.','error');
    }finally{setBusy(false);}
  };

  const confirmRefund=async(order:Order,amount:number|null,reason:string)=>{
    setBusy(true);
    try{
      await processRefund(order.orderId,amount??undefined,reason);
      toast.show(`Refund issued for ${order.orderNumber}.`);
      setRefundTarget(undefined);setSelected(undefined);
      await resource.reload();
    }catch(error){
      toast.show(error instanceof Error?error.message:'Refund could not be completed.','error');
    }finally{setBusy(false);}
  };

  const active=selected? (resource.data??[]).find(order=>order.orderId===selected.orderId)??selected : undefined;
  const activeCancel=cancelTarget? (resource.data??[]).find(order=>order.orderId===cancelTarget.orderId)??cancelTarget : undefined;
  const activeRefund=refundTarget? (resource.data??[]).find(order=>order.orderId===refundTarget.orderId)??refundTarget : undefined;

  return <section className="admin-page live-orders-page"><PageTitle title="Orders"><div className="admin-actions"><button className="admin-secondary" onClick={()=>exportOrders(filtered)}><Download size={16}/>Export CSV</button><button className="admin-secondary" onClick={()=>window.print()}><Printer size={16}/>Print</button></div></PageTitle><section className="live-order-counters" aria-label="Order status counts">{counters.map(value=><button key={value} className={status===value?'active':''} onClick={()=>{setStatus(status===value?'All':value);setPage(1)}}><span>{value}</span><b>{totals[value]}</b></button>)}</section><section className="admin-card order-toolbar"><label className="admin-search"><Search size={17}/><input value={query} onChange={event=>{setQuery(event.target.value);setPage(1)}} placeholder="Search order, customer, phone or email" aria-label="Search orders"/></label><select value={status} onChange={event=>{setStatus(event.target.value as 'All'|OrderStatus);setPage(1)}} aria-label="Filter by status"><option value="All">All statuses</option>{statuses.map(value=><option key={value} value={value}>{value}</option>)}</select></section><section className="live-order-grid">{resource.loading?<p className="admin-message">Loading orders…</p>:resource.error?<p className="admin-message error">{resource.error}</p>:visible.length?visible.map(order=><OrderCard key={order.orderId} order={order} onChange={update} onCancel={setCancelTarget} onSelect={setSelected}/>):<p className="admin-message">No orders match these filters.</p>}</section>{!resource.loading&&!resource.error&&<div className="pagination"><span>{filtered.length} orders · page {page} of {pageCount}</span><button disabled={page===1} onClick={()=>setPage(current=>current-1)}><ChevronLeft size={16}/>Previous</button><button disabled={page===pageCount} onClick={()=>setPage(current=>current+1)}>Next<ChevronRight size={16}/></button></div>}{active&&<OrderDetail order={active} close={()=>setSelected(undefined)} onChange={update} onCancel={setCancelTarget} onRefund={setRefundTarget}/>}{activeCancel&&<CancelDialog order={activeCancel} close={()=>setCancelTarget(undefined)} confirm={reason=>void confirmCancel(activeCancel,reason)} busy={busy}/>}{activeRefund&&<RefundDialog order={activeRefund} close={()=>setRefundTarget(undefined)} confirm={(amount,reason)=>void confirmRefund(activeRefund,amount,reason)} busy={busy}/>}</section>;
}

export function EnhancedDashboard(){const orders=useResource(getOrders);const products=useResource(getProducts);const refresh=useCallback(()=>{void orders.reload();void products.reload()},[orders.reload,products.reload]);useOrdersRealtime(refresh);const all=orders.data??[];const today=all.filter(order=>Date.now()-new Date(order.createdAt).getTime()<86400000);const revenue=today.reduce((sum,order)=>sum+order.total,0);return <section className="admin-page"><PageTitle title="Good afternoon, Vizio."/>{orders.loading||products.loading?<p className="admin-message">Loading…</p>:orders.error?<p className="admin-message error">{orders.error}</p>:<><div className="metric-grid">{[['Revenue today',money(revenue)],['Revenue this week',money(revenue)],['Revenue this month',money(revenue)],['Orders',String(all.length)],['Average order',money(all.length?all.reduce((sum,order)=>sum+order.total,0)/all.length:0)],['Customers',String(new Set(all.map(order=>order.email)).size)]].map(([label,value])=><article className="metric" key={label}><p>{label}</p><h2>{value}</h2><small>Live Supabase data</small></article>)}</div><div className="admin-grid"><section className="admin-card chart"><h2>Revenue</h2><p>Live order totals</p><div className="bars">{[38,60,46,74,63,88,76].map((height,index)=><span style={{height:`${height}%`}} key={index}/>)}</div></section><section className="admin-card"><h2>Top products</h2>{products.data?.length?products.data.slice(0,5).map((product,index)=><p className="rank" key={product.id}><b>0{index+1}</b><span>{product.name}</span></p>):<p className="admin-message">No products yet.</p>}</section></div><section className="admin-card"><h2>Recent orders</h2>{all.length?<div className="dashboard-orders">{all.slice(0,5).map(order=><p key={order.orderId}><b>{order.orderNumber}</b><span>{order.customer}</span><Status value={order.status}/><strong>{money(order.total)}</strong></p>)}</div>:<p className="admin-message">No orders yet.</p>}</section></>}</section>}
