import { PlayShell } from '@/components/game/PlayShell';
import { resolvePark } from '@/lib/park';
import { loadParks } from '@/lib/park.server';

/**
 * 必须动态渲染：园区白名单是运行时配置（`GAME_PARKS`），静态预渲染会把
 * 端点冻在构建那一刻。`searchParams` 本来就让它动态，这里只是把依赖写明。
 */
export const dynamic = 'force-dynamic';

interface PlayPageProps {
  /** Next 15 起 searchParams 是 Promise，必须 await */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * 园区外壳。
 *
 * 园区列表与 `?park=` 的白名单解析都留在服务端：客户端只拿到「可以连哪个端点」，
 * 拿不到「怎么拼端点」。存档或地址栏被改成 `?park=wss://evil` 时，
 * `resolvePark` 会把它打回第一个园区，不会真的连出去。
 */
export default async function PlayPage({ searchParams }: PlayPageProps) {
  const params = await searchParams;
  const parks = loadParks();
  const { park } = resolvePark(parks, first(params.park) ?? null);

  return (
    <PlayShell
      parks={parks}
      parkId={park.id}
      initialName={first(params.name)}
      initialSpecies={first(params.species)}
    />
  );
}
