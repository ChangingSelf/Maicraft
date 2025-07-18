import { EventEmitter } from "events";
import { WebSocketClient, WebSocketClientOptions } from "./WebSocketClient.js";
import { RouteConfig, TargetConfig } from "./MaimMessage.js";
import { MaicraftPayload } from "./PayloadTypes.js";
import { Logger } from "../utils/Logger.js";

// RouterEvents 接口：定义事件名到回调签名的映射（索引类型），
// 用于配合后续的 on/emit 泛型方法，实现事件名与参数的强类型绑定。
export interface RouterEvents {
  connected: (platform: string) => void;
  disconnected: (platform: string, code: number, reason: string) => void;
  message: (platform: string, payload: MaicraftPayload) => void;
  error: (platform: string, error: Error) => void;
  reconnecting: (platform: string, attempt: number) => void;
  reconnected: (platform: string) => void;
  reconnectFailed: (platform: string) => void;
  allConnected: () => void;
  allDisconnected: () => void;
}

// 通过「声明合并（declaration merging）」给下方 Router 类
// 补充强类型的 on/emit 方法重载签名，保持 EventEmitter API 体验同时提供类型安全。
export declare interface Router {
  on<U extends keyof RouterEvents>(event: U, listener: RouterEvents[U]): this;
  emit<U extends keyof RouterEvents>(
    event: U,
    ...args: Parameters<RouterEvents[U]>
  ): boolean;
}

// 连接状态接口
interface ConnectionState {
  connected: boolean;
  reconnecting: boolean;
  reconnectAttempts: number;
}

/**
 * 路由器类
 * 管理到多个 MaiBot 实例的 WebSocket 连接
 */
export class Router extends EventEmitter {
  private clients: Map<string, WebSocketClient> = new Map();
  private config: RouteConfig;
  private logger: Logger;
  private isRunning = false;
  private messageHandlers: Array<
    (payload: MaicraftPayload) => Promise<void> | void
  > = [];

  constructor(config: RouteConfig) {
    super();
    this.config = config;
    this.logger = new Logger("Router");
    
    // 添加错误事件监听器，防止未处理的错误导致程序崩溃
    this.on('error', (platform: string, error: Error) => {
      this.logger.error(`Router 错误 (${platform}):`, error);
      // 不重新抛出错误，让程序继续运行
    });
  }

  /**
   * 启动路由器，连接到所有配置的目标
   */
  async run(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn("Router 已经在运行中");
      return;
    }

    this.isRunning = true;
    this.logger.info("启动 Router...");

    // 创建所有客户端连接
    for (const [platform, targetConfig] of Object.entries(
      this.config.route_config
    )) {
      const client = this.createClient(platform, targetConfig);
      this.clients.set(platform, client);

      // 异步连接，不等待完成
      this.connectClientWithRetry(platform, client);
    }

    this.logger.info("Router 启动完成，正在连接目标...");
  }

  /**
   * 停止路由器，断开所有连接
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      this.logger.warn("Router 未在运行");
      return;
    }

    this.isRunning = false;
    this.logger.info("停止 Router...");

    // 断开所有客户端连接
    const disconnectPromises: Promise<void>[] = [];

    for (const [platform, client] of this.clients) {
      disconnectPromises.push(client.disconnect());
    }

    await Promise.allSettled(disconnectPromises);

    this.clients.clear();
    this.logger.info("Router 已停止");
    this.emit("allDisconnected");
  }

  /**
   * 发送消息到指定平台
   */
  async sendMessage(
    payload: MaicraftPayload,
    platform?: string
  ): Promise<void> {
    if (platform) {
      const client = this.clients.get(platform);
      if (!client) {
        throw new Error(`平台 ${platform} 不存在`);
      }

      await client.sendMessage(payload);
      this.logger.debug(
        `消息已发送到 ${platform}:`,
        payload.message_id || "no-id"
      );
    } else {
      // 广播到所有连接的客户端
      const sendPromises: Promise<void>[] = [];

      for (const [, client] of this.clients) {
        if (client.getConnectionState().connected) {
          sendPromises.push(client.sendMessage(payload));
        }
      }

      await Promise.allSettled(sendPromises);
      this.logger.debug(
        `消息已广播到所有连接的客户端:`,
        payload.message_id || "no-id"
      );
    }
  }

  /**
   * 发送原始数据到指定平台
   */
  async sendRaw(data: string, platform?: string): Promise<void> {
    if (platform) {
      const client = this.clients.get(platform);
      if (!client) {
        throw new Error(`平台 ${platform} 不存在`);
      }

      await client.sendRaw(data);
      this.logger.debug(`原始数据已发送到 ${platform}`);
    } else {
      // 广播到所有连接的客户端
      const sendPromises: Promise<void>[] = [];

      for (const [, client] of this.clients) {
        if (client.getConnectionState().connected) {
          sendPromises.push(client.sendRaw(data));
        }
      }

      await Promise.allSettled(sendPromises);
      this.logger.debug("原始数据已广播到所有连接的客户端");
    }
  }

  /**
   * 注册消息处理器
   */
  registerMessageHandler(
    handler: (payload: MaicraftPayload) => Promise<void> | void
  ): void {
    this.messageHandlers.push(handler);
    this.logger.debug("消息处理器已注册");
  }

  /**
   * 移除消息处理器
   */
  removeMessageHandler(
    handler: (payload: MaicraftPayload) => Promise<void> | void
  ): void {
    const index = this.messageHandlers.indexOf(handler);
    if (index > -1) {
      this.messageHandlers.splice(index, 1);
      this.logger.debug("消息处理器已移除");
    }
  }

  /**
   * 获取所有客户端的连接状态
   */
  getConnectionStates(): Record<string, ConnectionState> {
    const states: Record<string, ConnectionState> = {};

    for (const [platform, client] of this.clients) {
      states[platform] = client.getConnectionState();
    }

    return states;
  }

  /**
   * 获取已连接的客户端列表
   */
  getConnectedClients(): string[] {
    const connected: string[] = [];

    for (const [platform, client] of this.clients) {
      if (client.getConnectionState().connected) {
        connected.push(platform);
      }
    }

    return connected;
  }

  /**
   * 检查是否有任何客户端连接
   */
  hasAnyConnection(): boolean {
    return this.getConnectedClients().length > 0;
  }

  /**
   * 检查是否所有客户端都已连接
   */
  hasAllConnections(): boolean {
    return this.getConnectedClients().length === this.clients.size;
  }

  /**
   * 创建客户端实例
   */
  private createClient(
    platform: string,
    config: TargetConfig
  ): WebSocketClient {
    const clientOptions: WebSocketClientOptions = {
      url: config.url,
      token: config.token,
      reconnectInterval: config.reconnect_interval,
      maxReconnectAttempts: config.max_reconnect_attempts,
    };

    const client = new WebSocketClient(clientOptions);

    // 绑定事件
    client.on("connected", () => {
      this.logger.info(`${platform} 连接成功`);
      this.emit("connected", platform);
    });

    client.on("disconnected", (code, reason) => {
      this.logger.warn(`${platform} 连接断开: ${code} - ${reason}`);
      this.emit("disconnected", platform, code, reason);
    });

    client.on("message", async (payload) => {
      this.logger.debug(
        `收到来自 ${platform} 的消息:`,
        payload.message_id || "no-id"
      );
      this.emit("message", platform, payload);

      // 调用所有注册的消息处理器
      for (const handler of this.messageHandlers) {
        try {
          await handler(payload);
        } catch (error) {
          this.logger.error(`消息处理器执行失败:`, error);
        }
      }
    });

    client.on("error", (error) => {
      this.logger.error(`${platform} 发生错误:`, error);
      this.emit("error", platform, error);
      // 不抛出错误，让程序继续运行
    });

    client.on("reconnecting", (attempt) => {
      this.logger.info(`${platform} 正在重连 (第 ${attempt} 次)`);
      this.emit("reconnecting", platform, attempt);
    });

    client.on("reconnected", () => {
      this.logger.info(`${platform} 重连成功`);
      this.emit("reconnected", platform);
    });

    client.on("reconnectFailed", () => {
      this.logger.error(`${platform} 重连失败`);
      this.emit("reconnectFailed", platform);
    });

    return client;
  }

  /**
   * 连接客户端
   */
  private async connectClient(
    platform: string,
    client: WebSocketClient
  ): Promise<void> {
    try {
      await client.connect();
      this.logger.info(`成功连接到 ${platform}`);
    } catch (error) {
      this.logger.error(`连接 ${platform} 失败:`, error);
      throw error;
    }
  }

  /**
   * 带重试的连接客户端
   */
  private async connectClientWithRetry(
    platform: string,
    client: WebSocketClient
  ): Promise<void> {
    const maxRetries = 3;
    let retryCount = 0;

    while (retryCount < maxRetries && this.isRunning) {
      try {
        await client.connect();
        this.logger.info(`成功连接到 ${platform}`);
        return;
      } catch (error) {
        retryCount++;
        this.logger.warn(`连接 ${platform} 失败 (第 ${retryCount} 次):`, error);
        
        if (retryCount < maxRetries) {
          // 等待一段时间后重试
          const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 10000); // 指数退避，最大10秒
          this.logger.info(`${delay}ms 后重试连接 ${platform}...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          this.logger.error(`连接 ${platform} 失败，已达到最大重试次数`);
          // 不抛出错误，让程序继续运行
        }
      }
    }
  }
}
