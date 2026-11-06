'use client';

import { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';

interface MobileNavProps {
  items: Array<{ href: string; label: string }>;
}

export function MobileNav({ items }: MobileNavProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-label={open ? '关闭菜单' : '打开菜单'}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="grid h-11 w-11 place-items-center border-2 border-ink-600 text-mist-300 transition-colors hover:border-mint-400 hover:text-mint-400"
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {open && (
        <nav
          aria-label="移动端导航"
          className="absolute inset-x-0 top-full border-b-2 border-ink-700 bg-ink-900/97 px-5 py-2 backdrop-blur-md"
        >
          {items.map((item) => (
            <a
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className="flex min-h-12 items-center border-b border-ink-700/70 font-mono text-[12px] uppercase tracking-[0.2em] text-mist-300 last:border-b-0 active:text-mint-400"
            >
              {item.label}
            </a>
          ))}
        </nav>
      )}
    </div>
  );
}
