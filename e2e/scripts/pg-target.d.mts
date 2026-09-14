/** e2e Postgres 目标解析的类型声明（实现见 pg-target.mjs，单一来源）。 */

export declare const POSTGRES_IN_CONTAINER_PORT: number;
/** 缺省宿主机端口 = compose 的映射端口（**不是**容器内的 5432）。 */
export declare const DEFAULT_POSTGRES_PORT: number;

export declare function resolvePostgresPort(env?: NodeJS.ProcessEnv): number;
export declare function resolvePostgresDatabase(env?: NodeJS.ProcessEnv): string;
export declare function resolveStoreBackend(env?: NodeJS.ProcessEnv): "postgres" | "file";
export declare function resolveServerEnv(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
