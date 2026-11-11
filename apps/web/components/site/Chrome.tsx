import Link from 'next/link';
import { ArrowUpRight, Github, Radio } from 'lucide-react';
import { LogoMark } from './LogoMark';
import { MobileNav } from './MobileNav';

const NAV = [
  { href: '#species', label: '物种档案' },
  { href: '#tech', label: '技术底牌' },
  { href: '#rules', label: '工位守则' },
];

export function TopNav() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b-2 border-ink-700 bg-ink-900/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-6 px-5 sm:px-8">
        <Link href="/" className="group flex items-center gap-3" aria-label="牛马 NIOMA 首页">
          <LogoMark />
          <span className="flex flex-col leading-none">
            <span className="font-display text-base font-semibold tracking-[0.42em] text-mist-100">NIOMA</span>
            <span className="mt-1 font-mono text-[9px] uppercase tracking-[0.24em] text-mist-500">
              牛马 · shift 03
            </span>
          </span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex" aria-label="主导航">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="font-mono text-[11px] uppercase tracking-[0.2em] text-mist-300 transition-colors duration-150 hover:text-mint-400"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          <span className="tag hidden lg:inline-flex">
            <Radio className="h-3 w-3 text-mint-400" />
            in-memory
          </span>
          <Link href="/create" className="btn-primary px-3 py-2 text-[11px] sm:px-5">
            打卡上班
          </Link>
          <MobileNav items={NAV} />
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t-2 border-ink-700 bg-ink-950">
      <div className="mx-auto grid max-w-[1440px] gap-10 px-6 py-14 md:grid-cols-[1.2fr_0.4fr_0.4fr]">
        <div>
          <p className="font-display text-3xl font-bold tracking-[0.3em] text-mist-100">NIOMA</p>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-mist-300">
            《牛马》是一座 2D 像素多人在线办公园区。没有账号、没有存档、没有 KPI 对齐会，
            只有一条永远在跑的 20Hz Tick。
          </p>
          <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.2em] text-mist-500">
            built with bun · pixi v8 · bitecs · next 15
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-mist-500">园区入口</span>
          <Link href="/create" className="text-sm text-mist-300 transition-colors hover:text-mint-400">
            创建你的牛马
          </Link>
          <Link href="/play" className="text-sm text-mist-300 transition-colors hover:text-mint-400">
            直接进入园区
          </Link>
          <a
            href="/health"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm text-mist-300 transition-colors hover:text-mint-400"
          >
            服务器健康检查
            <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        </div>
        <div className="flex flex-col gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-mist-500">免责声明</span>
          <p className="text-sm leading-relaxed text-mist-300">
            本园区不保存任何数据。关闭标签页后，你的牛马、工位与摸鱼时长都会消失。
          </p>
          <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-mist-500">
            <Github className="h-3.5 w-3.5" />
            local build · no telemetry
          </span>
        </div>
      </div>
      <div className="border-t border-ink-800 px-6 py-5">
        <p className="mx-auto max-w-[1440px] font-mono text-[10px] uppercase tracking-[0.2em] text-mist-500">
          牛马 NIOMA — 请勿在工位躺平超过 8 小时，系统会以为你已离职。
        </p>
      </div>
    </footer>
  );
}
