import type { ReactNode } from "react";
import { MenuSelect } from "./MenuSelect";
import { money } from "./mobileViewModel";
export interface MobileDisplay {
    hidden: boolean;
}
export function Amount({ value, hidden }: {
    value: string | number | null;
    hidden: boolean;
}) { return <span>{money(value, hidden)}</span>; }
export function Card({ title, children }: {
    title: string;
    children: ReactNode;
}) { return <section className="mobile-card"><h2>{title}</h2>{children}</section>; }
export function Line({ label, value, hidden }: {
    label: string;
    value: string | number | null;
    hidden: boolean;
}) { return <div className="mobile-line"><span>{label}</span><strong><Amount value={value} hidden={hidden}/></strong></div>; }
export function Percent({ value, hidden }: {
    value: string | number | null;
    hidden: boolean;
}) { return <span>{hidden ? "••••" : value === null ? "Unavailable" : `${Number(value).toFixed(1)}%`}</span>; }
export function Progress({ actual, planned, hidden }: {
    actual: string;
    planned: string;
    hidden: boolean;
}) {
    if (hidden)
        return <div className="mobile-progress" aria-label="Amounts hidden"/>;
    const pct = Number(planned) > 0 ? Math.max(0, Math.min(100, Number(actual) / Number(planned) * 100)) : 0;
    return <div className="mobile-progress" role="img" aria-label={`${pct.toFixed(0)}% used`}><i style={{ width: `${pct}%` }}/></div>;
}

/** Browser-only month choice: no operating-system calendar or month picker. */
export function MobileMonthField({label,value,onChange,anchorYear}:{label:string;value:string;onChange:(value:string)=>void;anchorYear:number}) {
    const year=value?Number(value.slice(0,4)):anchorYear;
    const month=value?value.slice(5,7):"";
    const years=[...new Set([...Array.from({length:201},(_,i)=>anchorYear-100+i),year])].filter(y=>y>=1&&y<=9999).sort((a,b)=>a-b);
    const months=Array.from({length:12},(_,i)=>({value:String(i+1).padStart(2,"0"),label:new Intl.DateTimeFormat("en-US",{month:"long",timeZone:"UTC"}).format(new Date(Date.UTC(2000,i,1)))}));
    return <fieldset className="mobile-month-field"><legend>{label}</legend><div className="mobile-month-choices">
      <MenuSelect ariaLabel={label} value={month} options={[{value:"",label:"No withdrawal month"},...months]} onChange={m=>onChange(m?`${String(year).padStart(4,"0")}-${m}`:"")}/>
      <MenuSelect ariaLabel={label.replace(/month$/i,"year")} value={String(year)} options={years.map(y=>({value:String(y),label:String(y)}))} onChange={y=>onChange(`${y.padStart(4,"0")}-${month||"01"}`)}/>
    </div></fieldset>;
}
