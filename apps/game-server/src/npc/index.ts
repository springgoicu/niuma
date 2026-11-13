/**
 * 园区同事：服务端权威 NPC。
 *
 * 对外只暴露一个门面与配置类型，行为实现全部留在本目录内；
 * `server.ts` 不应该直接接触 `NpcAgent`、路点或名册。
 */
export { createNpcDirector, type NpcDirector, type NpcDirectorOptions } from './director';
export { DEFAULT_NPC_CONFIG, MAX_NPC_COUNT, loadNpcConfig, parseNpcConfig, type NpcConfig } from './config';
export { warmEscortGrid } from './escort-path';
