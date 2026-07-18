import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';
export function ButtonLink({ to, children, className = '', ariaLabel }: { to: string; children: ReactNode; className?: string; ariaLabel?: string }) { return <Link aria-label={ariaLabel} className={`button ${className}`.trim()} to={to}>{children}</Link>; }
export function IconButton({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) { return <button className={`icon-button ${className}`.trim()} type="button" {...props} />; }
export function PageIntro({ eyebrow, title, children }: { eyebrow: string; title: ReactNode; children?: ReactNode }) { return <section className="page-head"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{children}</section>; }
