import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ParkPicker } from '@/components/park/ParkPicker';
import { loadParks } from '@/lib/park.server';

export const metadata: Metadata = {
  title: '选择园区 · 牛马 NIOMA',
  description: '两座独立园区，各自的世界、各自的排队；工牌与外观通用，选过之后自动进入，园区里随时能换。',
};

/**
 * 必须动态渲染：园区列表是运行时配置，静态预渲染会把「只有一座园区」这个判断
 * 冻在构建那一刻，之后加了一台机器也永远跳不到选园页。
 */
export const dynamic = 'force-dynamic';

interface EnterPageProps {
  /** Next 15 起 searchParams 是 Promise，必须 await */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * 选园页。
 *
 * 只有一座园区时没有可选项，这一跳过掉：直接把人送进 /play，
 * 让单机部署表现得和没有这个页面一样。
 */
export default async function EnterPage({ searchParams }: EnterPageProps) {
  const parks = loadParks();
  if (parks.length <= 1) {
    redirect(`/play?park=${encodeURIComponent(parks[0]!.id)}`);
  }

  const params = await searchParams;
  const from = Array.isArray(params.from) ? params.from[0] : params.from;
  return <ParkPicker parks={parks} fromPlay={from === 'play'} />;
}
