import { useId, useLayoutEffect, useRef, useState, type InputHTMLAttributes } from "react";
import "./MenuSelect.css";
import "./EditableCombobox.css";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "list"> & {
  value: string;
  options: string[];
  onChange: (value: string) => void;
};

/** Editable suggestions: choosing fills the field; a second Enter retains the caller's submit action. */
export function EditableCombobox({ value, options, onChange, onKeyDown, onBlur, disabled, ...attrs }: Props) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const matches = [...new Set(options)].filter(option => option.toLocaleLowerCase().includes(value.toLocaleLowerCase()));
  const shown = open && !disabled && matches.length > 0;
  const activeIndex = active < matches.length ? active : -1;
  useLayoutEffect(() => {
    if (!shown || !panel.current) return;
    const list = panel.current;
    list.showPopover?.();
    const place = () => {
      if (!input.current) return;
      const rect = input.current.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) { setOpen(false); return; }
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const up = below < 280 && above > below;
      const height = Math.min(300, Math.max(0, up ? above : below));
      const width = Math.min(Math.max(rect.width, 180), Math.max(0, window.innerWidth - 24));
      list.style.width = `${width}px`;
      list.style.maxHeight = `${height}px`;
      list.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
      list.style.top = `${up ? rect.top - Math.min(list.scrollHeight, height) - 6 : rect.bottom + 6}px`;
    };
    const scroll = (event: Event) => { if (!list.contains(event.target as Node)) place(); };
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) { setOpen(false); setActive(-1); } };
    place();
    document.addEventListener("scroll", scroll, true);
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", place);
    // Loaded fonts, theme changes and growing labels can resize an open list without a window
    // resize. Reposition it so an upward-opening panel cannot grow across its own input.
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(place);
    observer?.observe(list);
    if (input.current) observer?.observe(input.current);
    if (root.current?.parentElement) observer?.observe(root.current.parentElement);
    // A theme can move the anchor while leaving the input's own width/height unchanged.
    const themeObserver = new MutationObserver(place);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-palette", "data-theme", "style", "class"] });
    return () => { observer?.disconnect(); themeObserver.disconnect(); list.hidePopover?.(); document.removeEventListener("scroll", scroll, true); document.removeEventListener("pointerdown", outside, true); window.removeEventListener("resize", place); };
  }, [shown, value, matches.length]);
  useLayoutEffect(() => { panel.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" }); }, [activeIndex]);
  function choose(option: string) { onChange(option); setOpen(false); setActive(-1); input.current?.focus(); }
  return <span className="editable-combobox" ref={root}>
    <input {...attrs} ref={input} value={value} disabled={disabled} role="combobox" aria-autocomplete="list"
      aria-expanded={shown} aria-controls={shown ? id : undefined}
      aria-activedescendant={shown && activeIndex >= 0 ? `${id}-${activeIndex}` : undefined}
      onFocus={event => { setOpen(true); attrs.onFocus?.(event); }}
      onChange={event => { onChange(event.target.value); setActive(-1); setOpen(true); }}
      onBlur={event => { setOpen(false); setActive(-1); onBlur?.(event); }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if ((event.key === "ArrowDown" || event.key === "ArrowUp") && matches.length) {
          event.preventDefault(); setOpen(true);
          setActive(event.key === "ArrowDown" ? (activeIndex + 1) % matches.length : (activeIndex - 1 + matches.length) % matches.length);
          return;
        }
        if (shown && event.key === "Enter" && activeIndex >= 0) { event.preventDefault(); choose(matches[activeIndex]); return; }
        if (shown && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); setActive(-1); return; }
        if (event.key === "Tab") { setOpen(false); setActive(-1); }
        onKeyDown?.(event);
      }} />
    {shown && <div id={id} ref={panel} role="listbox" popover="manual" className="menu-select-panel editable-combobox-panel" aria-label="Suggestions">
      {matches.map((option, index) => <div id={`${id}-${index}`} key={option} role="option" aria-selected={index === activeIndex}
        className="editable-combobox-option" onPointerDown={event => event.preventDefault()} onMouseDown={event => event.preventDefault()}
        onClick={() => choose(option)}>{option}</div>)}
    </div>}
  </span>;
}
