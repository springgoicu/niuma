import { SiteFooter, TopNav } from '@/components/site/Chrome';
import { Hero } from '@/components/site/Hero';
import { BenefitsMarquee, RulesSection, SpeciesSection, TechSection } from '@/components/site/Sections';
import { homeAutoEnterScript } from '@/lib/auto-enter';

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-ink-900">
      {/* 已经捏过人的回访者在这里就被送去园区：脚本随 SSR HTML 到达，
          在可见内容之前同步执行，所以首页不会闪一下再跳（ADR-0038） */}
      <script dangerouslySetInnerHTML={{ __html: homeAutoEnterScript() }} />
      <TopNav />
      <main className="pt-16">
        <Hero />
        <SpeciesSection />
        <BenefitsMarquee />
        <TechSection />
        <RulesSection />
      </main>
      <SiteFooter />
    </div>
  );
}
