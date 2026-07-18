import type { ReactNode } from 'react'; import { X } from 'lucide-react';
export const PageTitle=({title,children}:{title:string;children?:ReactNode})=><header className="admin-title"><div><p className="eyebrow">Vizio Food admin</p><h1>{title}</h1></div>{children}</header>;
export const Status=({value}:{value:string})=><span className={`status ${value.toLowerCase()}`}>{value}</span>;
export function Modal({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}){return <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-label={title}><button className="modal-close" onClick={onClose} aria-label="Close dialog"><X/></button><h2>{title}</h2>{children}</section></div>}
