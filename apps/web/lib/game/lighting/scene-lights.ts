import type { PropInstance } from '@niuma/shared-types';
import type { LightSpec } from './light-registry';

/**
 * 外景点光源：从 `WORLD_LAYOUT.props` 派生，不复制任何坐标。
 *
 * `prop.y` 是道具脚底（精灵锚点 0.5,1），光心按贴图内部高度往上抬：
 * 灯头在灯柱顶部，售货机与咖啡机在发光面板附近。`dy` 是贴图约定，
 * 改贴图高度时这里要同步；道具世界坐标仍然只有布局一份。
 */

interface PropLightProfile {
  /** 光心相对道具脚底的 y 偏移（负值 = 往上） */
  dy: number;
  radius: number;
  color: number;
  intensity: number;
  flicker: number;
}

const PROFILES: Partial<Record<PropInstance['kind'], PropLightProfile>> = {
  // 庭院与路口灯柱：暖黄，带一点烛光抖动；灯罩光心在 14×40 贴图的 (7,5)
  lamp: { dy: -35, radius: 84, color: 0xffc07a, intensity: 0.85, flicker: 0.16 },
  // 售货机：冷白霓虹，玻璃面是主发光区
  vending: { dy: -30, radius: 52, color: 0xd9ecff, intensity: 0.5, flicker: 0.02 },
  // 咖啡机：更小一圈的冷白，安静地亮着
  coffee: { dy: -16, radius: 40, color: 0xe6f2ff, intensity: 0.42, flicker: 0 },
};

export function propLights(props: readonly PropInstance[]): LightSpec[] {
  const lights: LightSpec[] = [];
  for (const prop of props) {
    const profile = PROFILES[prop.kind];
    if (!profile) continue;
    lights.push({
      x: prop.x,
      y: prop.y + profile.dy,
      radius: profile.radius,
      color: profile.color,
      intensity: profile.intensity,
      flicker: profile.flicker,
    });
  }
  return lights;
}
