/**
 * 回访者直达园区：首页在 HTML 解析阶段就把「已经捏过人」的浏览器送去园区。
 *
 * 这段脚本随 SSR 输出内联进首页，必须在**解析阶段**同步执行——放到 useEffect 里
 * 会先画完首页再跳，回访者每次都要看一遍营销页闪屏。因此这里只产出字符串，
 * 不依赖 React、不 import 任何 `'use client'` 模块（首页是 Server Component）。
 *
 * 四条守卫按顺序短路，任一不满足就安静地留在首页：
 * 1. 只认「重新打开」：本次浏览会话已处理过首页就不再跳，站内点 Logo / 打卡下班
 *    回首页不会又被弹回园区。
 * 2. 只认真存档：`niuma:profile:v2` 必须能解析成对象，坏数据交给 /play 的
 *    `loadProfile()` 去清，首页不替它擦屁股。
 * 3. 只认站外来路：同源 referrer 说明是站内导航，一律放行首页。
 * 4. 读 `niuma:park:v1`：有合法 id 就直奔那一座，没有才落到选园页。
 *
 * 首页不能在脚本里问「一共有几座园区」：这段脚本随静态预渲染的 HTML 下发，
 * 读环境变量会把园区列表冻在构建那一刻。单园区的情况交给 /enter —— 那边是
 * 动态路由，看到只有一座就直接 307 到 /play，玩家只多一次跳转。
 *
 * 存储不可用（Safari 隐私模式、配额满）时按「不跳」处理：少一次便捷，
 * 也绝不让首页白屏或抛错。
 */

import { PARK_ID_PATTERN, PARK_PREF_KEY } from './park';

/** 本次浏览会话是否已经处理过首页：sessionStorage 关浏览器即清，天然对齐「重新打开」 */
export const HOME_VISITED_KEY = 'niuma:home-visited:v1';

/**
 * 与 `lib/profile.ts` 的 `PROFILE_KEY` 必须一致。
 * 那份文件带 `'use client'`，Server Component 不能从它取常量，只能各写一份；
 * `__tests__/auto-enter.test.ts` 会断言两处 key 不会漂移。
 */
const PROFILE_STORAGE_KEY = 'niuma:profile:v2';

/** 死路径写死，避免脚本里再拼一次路由表 */
const PLAY_PATH = '/play';
const ENTER_PATH = '/enter';

/**
 * 生成可直接塞进 `<script>` 的自包含 IIFE。
 *
 * 只用 `window` / `document` / `location` 三个全局与 `String.prototype`，
 * 不引用模块作用域，所以测试可以用
 * `new Function('window', 'document', 'location', script)` 真跑一遍。
 */
export function homeAutoEnterScript(): string {
  return `(function(){try{
if(document.readyState!=='loading')return;
var visitedKey=${JSON.stringify(HOME_VISITED_KEY)};
var profileKey=${JSON.stringify(PROFILE_STORAGE_KEY)};
var parkKey=${JSON.stringify(PARK_PREF_KEY)};
var parkPattern=${PARK_ID_PATTERN.toString()};
var seen;
try{seen=window.sessionStorage.getItem(visitedKey)==='1';if(!seen)window.sessionStorage.setItem(visitedKey,'1');}catch(e){return;}
if(seen)return;
var raw;
try{raw=window.localStorage.getItem(profileKey);}catch(e){return;}
if(!raw)return;
var draft;
try{draft=JSON.parse(raw);}catch(e){return;}
if(!draft||typeof draft!=='object'||Array.isArray(draft))return;
var referrer=document.referrer||'';
if(referrer&&referrer.indexOf(location.origin)===0)return;
var park='';
var stored;
try{stored=window.localStorage.getItem(parkKey);}catch(e){stored=null;}
if(stored){
var pref;
try{pref=JSON.parse(stored);}catch(e){pref=null;}
if(pref&&typeof pref==='object'&&!Array.isArray(pref)&&typeof pref.id==='string'&&parkPattern.test(pref.id))park=pref.id;
}
location.replace(park?${JSON.stringify(PLAY_PATH)}+'?park='+encodeURIComponent(park):${JSON.stringify(ENTER_PATH)});
}catch(e){}})();`;
}
