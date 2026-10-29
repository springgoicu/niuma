import type { Metadata } from 'next';
import { CreatorShell } from '@/components/creator/CreatorShell';

export const metadata: Metadata = {
  title: '捏人工作台 · 牛马 NIOMA',
  description: '调整物种、五处配色、斑纹、口鼻、角或鬃毛与办公室配件，实时预览后直接上岗。',
};

export default function CreatePage() {
  return <CreatorShell />;
}
