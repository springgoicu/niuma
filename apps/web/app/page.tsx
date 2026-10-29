import { SiteFooter, TopNav } from '@/components/site/Chrome';
import { Hero } from '@/components/site/Hero';
import { BenefitsMarquee, RulesSection, SpeciesSection, TechSection } from '@/components/site/Sections';

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-ink-900">
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
