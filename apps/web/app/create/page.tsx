import type { Metadata } from 'next';
import { CreatorShell } from '@/components/creator/CreatorShell';

export const metadata: Metadata = {
  title: '捏人工作台 · 牛马 NIOMA',
  description: '调整物种、斑纹、口鼻、角或鬃毛、尾巴、头饰、眼镜、颈饰与发型，11 个色槽逐项调色，实时预览后直接上岗。',
};

export default function CreatePage() {
  return <CreatorShell />;
}
