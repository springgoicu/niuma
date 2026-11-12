import type { Metadata } from 'next';
import { CreatorShell } from '@/components/creator/CreatorShell';
import { parseSpeciesParam } from '@/lib/creator-seed';

export const metadata: Metadata = {
  title: '捏人工作台 · 牛马 NIOMA',
  description: '调整物种、斑纹、口鼻、角或鬃毛、尾巴、头饰、眼镜、颈饰与发型，11 个色槽逐项调色，实时预览后直接上岗。',
};

interface CreatePageProps {
  /** Next 15 起 searchParams 是 Promise，必须 await */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * 捏人工作台。
 *
 * `?species=horse` 是入口页物种卡片的直达参数，与 `/play?species=` 同一把尺子：
 * 参数在这里解析，客户端组件不读 `window.location`。等 searchParams 会让本页
 * 按请求渲染——页面上只有一个客户端工作台空壳，没有数据 I/O，代价可接受。
 */
export default async function CreatePage({ searchParams }: CreatePageProps) {
  const params = await searchParams;
  return <CreatorShell initialSpecies={parseSpeciesParam(params.species)} />;
}
