# Maicraft

Minecraft × MCP 机器人服务：通过 MCP 工具查询状态/事件并执行基础动作

## 功能特性

- 🤖 **Minecraft 机器人**：基于 Mineflayer 的 Minecraft 客户端
- 🔧 **MCP 工具集成**：通过 Model Context Protocol 提供工具接口
- 📊 **状态管理**：实时游戏状态监控和事件记录
- 🎮 **动作执行**：支持挖矿、建造、跟随等基础动作
- 📝 **日志系统**：双重日志输出（stderr + 文件），支持配置化
- ⚡ **动态发现**：动作自动发现与注册，无需手动配置
- 🛡️ **参数校验**：基于 Zod 的自动参数校验与类型安全

## 架构

```mermaid
graph LR
  A[main.ts 启动器] -->|读取| C[config.yaml]
  A --> L[Logger]
  A --> MC[MinecraftClient]
  A --> SM[StateManager]
  A --> AE[ActionExecutor]
  A --> MCP[MaicraftMcpServer]

  MC -->|使用| B[mineflayer Bot]
  B -->|事件| MC
  MC -->|gameEvent| A
  A -->|addEvent| SM

  MCP -->|query_state / query_events| SM
  MCP -->|动作工具| AE
  MCP -->|连接/状态| MC
  AE -->|使用 Bot 执行动作| B
  
  AE -->|自动发现| ACT[src/actions/*.ts]
  ACT -->|schema + execute| AE
  AE -->|自动生成| MCP_TOOLS[MCP Tools]
```

### 动作系统架构

```mermaid
graph TD
  A[Action File] -->|继承| B[BaseAction]
  A -->|定义| C[schema: z.ZodTypeAny]
  A -->|实现| D[execute: (bot, params) => Promise<ActionResult>]
  
  B -->|自动提供| E[validateParams]
  B -->|自动提供| F[getParamsSchema]
  B -->|自动提供| G[getMcpTools]
  
  G -->|生成| H[MCP Tool: action_name_snake_case]
  C -->|校验| I[参数类型安全]
  C -->|描述| J[自动生成参数文档]
```

### 时序：调用动作（mine_block）

```mermaid
sequenceDiagram
  participant Client as MCP Client
  participant Server as MaicraftMcpServer
  participant AE as ActionExecutor
  participant MC as MinecraftClient
  participant Bot as mineflayer Bot

  Client->>Server: tools/call mine_block
  Server->>MC: getBot()
  MC-->>Server: Bot
  alt Bot ready
    Server->>AE: execute('mineBlock', Bot, params)
    AE->>Bot: 动作执行（寻路/采集等）
    Bot-->>AE: result
    AE-->>Server: { success, data }
    Server-->>Client: structuredContent
  else Bot not ready
    Server-->>Client: { ok:false, error: service_unavailable }
  end
```

### 时序：事件汇聚与状态更新

```mermaid
sequenceDiagram
  participant Bot as mineflayer Bot
  participant MC as MinecraftClient
  participant Main as main.ts
  participant SM as StateManager

  Bot->>MC: 原始游戏事件
  MC->>MC: 过滤 enabledEvents
  MC-->>Main: gameEvent
  Main->>SM: addEvent(event)
  SM->>SM: 更新 GameState
```

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置

复制配置文件模板：

```bash
cp config-template.yaml config.yaml
```

编辑 `config.yaml`，配置 Minecraft 服务器连接信息：

```yaml
minecraft:
  host: 127.0.0.1
  port: 25565
  username: MaiBot
  auth: offline

# 日志配置
logging:
  level: INFO
  enableFileLog: true
  useStderr: true
```

### 3. 启动

```bash
# 开发模式
pnpm run dev

# 生产模式
pnpm run build
pnpm start
```

### 4. 查看日志

```bash
# 实时查看日志
pnpm run log

# 测试日志配置
pnpm run test:logging
```

## 配置说明

### 基础配置

在 `config.yaml` 中配置 Minecraft 服务器连接：

```yaml
minecraft:
  host: 127.0.0.1        # 服务器地址
  port: 25565            # 端口
  username: MaiBot       # 机器人用户名
  auth: offline          # 认证方式：offline | microsoft | mojang
  version: "1.19.0"      # 游戏版本（可选）

enabledEvents:
  - chat                 # 聊天事件
  - playerJoin           # 玩家加入
  - playerLeave          # 玩家离开
  - blockBreak           # 方块破坏
  - blockPlace           # 方块放置

maxMessageHistory: 100   # 事件历史缓存数量
```

### 日志系统配置

Maicraft 使用双重日志系统：
- **stderr 输出**：用于 MCP 通信，避免污染 stdout
- **文件日志**：保存到 `logs/` 目录，方便查看和调试

#### 日志配置选项

在 `config.yaml` 中的 `logging` 部分配置：

```yaml
logging:
  level: INFO             # DEBUG | INFO | WARN | ERROR
  enableFileLog: true     # 是否启用文件日志
  logFilePath: ""         # 日志文件路径，留空使用默认路径
  useStderr: true         # 是否使用 stderr 输出（MCP 模式建议保持 true）
  colors: true            # 是否启用颜色输出
  timestamp: true         # 是否显示时间戳
```

#### 日志文件位置

日志文件默认保存在项目根目录的 `logs/` 文件夹中，文件名格式为：
```
logs/maicraft-YYYY-MM-DDTHH-mm-ss.log
```

#### 查看日志的方法

**1. 实时查看日志（推荐）**
```bash
# 查看最新的日志文件
pnpm run log

# 或者指定特定日志文件
node scripts/watch-log.js logs/maicraft-2024-01-15T10-30-00.log
```

**2. 直接查看日志文件**
```bash
# 查看完整日志
cat logs/maicraft-2024-01-15T10-30-00.log

# 查看最后100行
tail -n 100 logs/maicraft-2024-01-15T10-30-00.log

# 实时跟踪日志（类似 tail -f）
tail -f logs/maicraft-2024-01-15T10-30-00.log
```

**3. 在 Windows 上查看**
```powershell
# 查看完整日志
Get-Content logs/maicraft-2024-01-15T10-30-00.log

# 查看最后100行
Get-Content logs/maicraft-2024-01-15T10-30-00.log -Tail 100

# 实时跟踪日志
Get-Content logs/maicraft-2024-01-15T10-30-00.log -Wait
```

#### 日志级别

- `DEBUG`：调试信息
- `INFO`：一般信息
- `WARN`：警告信息
- `ERROR`：错误信息

#### 日志格式

```
[2024-01-15 10:30:00] [INFO] [Maicraft] 客户端已启动，按 Ctrl+C 退出。
[2024-01-15 10:30:01] [INFO] [Maicraft] 日志文件位置: /path/to/logs/maicraft-2024-01-15T10-30-00.log
```

#### 日志管理

**日志文件清理**
```bash
# 删除7天前的日志文件
find logs/ -name "*.log" -mtime +7 -delete
```

**Windows 日志清理**
```powershell
# 删除7天前的日志文件
Get-ChildItem logs/*.log | Where-Object {$_.LastWriteTime -lt (Get-Date).AddDays(-7)} | Remove-Item
```

**故障排除**
- 日志文件不生成：检查写入权限和磁盘空间
- 日志文件过大：日志按启动时间分割，可定期清理

### MCP 工具配置

Maicraft 支持多种工具过滤模式，推荐使用黑名单模式：

```yaml
mcp:
  name: "Maicraft MCP"
  version: "0.1.0"
  tools:
    # 方式1：黑名单模式（推荐）- 屏蔽指定工具，其他全部可用
    disabled:
      - use_chest
      - smelt_item
    
    # 方式2：白名单模式 - 仅暴露指定工具
    # enabled:
    #   - mine_block
    #   - place_block
    #   - follow_player
    
    # 方式3：同时使用 - 白名单允许的集合减去黑名单
    # enabled:
    #   - mine_block
    #   - place_block
    #   - chat
    # disabled:
    #   - chat
    
    # 方式4：不配置 - 默认暴露所有工具
    # （删除或注释掉 tools 部分）
```

## 动作开发

### 动作系统特性

- **自动发现**：将动作文件放在 `src/actions/` 目录即可自动发现
- **参数校验**：基于 Zod 的自动参数校验
- **类型安全**：完整的 TypeScript 类型支持
- **MCP 集成**：自动生成对应的 MCP 工具

### 编写新动作

#### 方式1：继承基类（推荐）

```typescript
// src/actions/MyAction.ts
import { BaseAction } from '../minecraft/ActionInterface';
import { z } from 'zod';

interface MyActionParams {
  target: string;
  count?: number;
}

export class MyAction extends BaseAction<MyActionParams> {
  name = 'myAction';
  description = '执行我的自定义动作';
  
  // 定义参数校验 schema
  schema = z.object({
    target: z.string().describe('目标对象'),
    count: z.number().int().min(1).optional().describe('执行次数（可选）'),
  });

  async execute(bot: Bot, params: MyActionParams) {
    try {
      // 实现动作逻辑
      const count = params.count ?? 1;
      
      // ... 具体实现
      
      return this.createSuccessResult(`成功执行动作 ${count} 次`);
    } catch (error) {
      return this.createExceptionResult(error, '执行失败', 'EXECUTION_ERROR');
    }
  }
  
  // validateParams、getParamsSchema、getMcpTools 由基类自动提供
}
```

#### 方式2：函数式定义

```typescript
// src/actions/MyAction.ts
import { defineAction } from '../minecraft/ActionInterface';
import { z } from 'zod';

export const MyAction = defineAction({
  name: 'myAction',
  description: '执行我的自定义动作',
  schema: z.object({
    target: z.string().describe('目标对象'),
    count: z.number().int().min(1).optional().describe('执行次数（可选）'),
  }),
  async execute(bot, params) {
    // 实现动作逻辑
    const count = params.count ?? 1;
    
    // ... 具体实现
    
    return { success: true, message: `成功执行动作 ${count} 次` };
  },
});
```

### 动作自动注册

1. 将动作文件放在 `src/actions/` 目录
2. 文件会被自动发现并注册
3. 对应的 MCP 工具会自动生成（工具名为动作名的 snake_case 形式）
4. 例如：`MyAction` → `my_action` 工具

### 可用的动作工具

当前支持的动作工具：

- `chat` - 发送聊天消息
- `craft_item` - 合成物品
- `smelt_item` - 熔炼物品
- `use_chest` - 使用箱子
- `swim_to_land` - 游向陆地
- `kill_mob` - 击杀生物
- `mine_block` - 挖掘方块
- `place_block` - 放置方块
- `follow_player` - 跟随玩家

## MCP 工具

### 查询工具

- `ping` - 测试连接
- `query_state` - 查询游戏状态
- `query_events` - 查询事件历史

### 动作工具

动作工具会根据 `src/actions/` 目录中的动作文件自动生成，工具名格式为动作名的 snake_case 形式。

## 开发

```bash
# 构建
pnpm run build

# 测试
pnpm run test

# 代码检查
pnpm run lint

# 清理构建文件
pnpm run clean
```

## 许可证

MIT
