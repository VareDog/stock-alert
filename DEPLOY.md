# 股票价格提醒 - 部署指南

## 前提

域名 DNS 已托管在 Cloudflare。

## 部署步骤

### 1. 创建 D1 数据库

Cloudflare Dashboard → Workers & Pages → D1 → Create database：

- 名称：`stock-alert`
- 创建后进入详情页，复制 **Database ID**

把 Database ID 填入 `wrangler.jsonc` 的 `database_id` 字段。

### 2. 配置 Secrets

Dashboard → Workers & Pages → stock-alert（部署后出现）→ Settings → Variables and Secrets，添加：

| 变量 | 说明 | 示例 |
|------|------|------|
| ALERT_KEY | 页面访问口令（自己随便定） | my-secret-123 |
| WXPUSHER_TOKEN | WxPusher 应用 token | APP_xxxxx |
| WXPUSHER_UID | 你微信绑定的 UID | UID_xxxxx |
| RESEND_API_KEY | Resend 密钥（备忘录那个可复用） | re_xxxxx |
| RESEND_TO | 备用邮件收件地址 | you@qq.com |
| RESEND_FROM | 发件人（可选，默认 onboarding@resend.dev） | alert@你的域名 |

### 3. 部署

二选一：

**A. GitHub 自动部署（推荐）**：GitHub 仓库 → Settings → Secrets → 添加 `CLOUDFLARE_API_TOKEN`（在 Cloudflare 创建，权限选 Account: Workers Scripts Edit + D1 Edit）和 `CLOUDFLARE_ACCOUNT_ID`。之后每次推送 stock-alert 代码自动部署。

**B. 本地部署**：在 stock-alert 目录执行 `npx wrangler deploy`（首次会引导登录 Cloudflare）。

### 4. 绑定域名

Dashboard → Workers & Pages → stock-alert → Settings → Domains & Routes → Add → Custom domain，填你的子域名（如 `stock.你的域名`）。

### 5. 微信接收配置（WxPusher）

1. 打开 wxpusher.zjiecode.com，注册账号
2. 创建应用，拿到 APP_TOKEN
3. 微信扫码关注，拿到你的 UID
4. 两个值填到第 2 步的 Secrets 里

## 使用说明

1. 打开页面（如 https://stock.你的域名），输入口令
2. 点「添加一行」输入代码（如 sh600000），自动带出名称
3. 填意向买价/卖价、勾选提醒开关、选推送通道
4. 满足条件的行会整行标红（页面刷新实时可见）
5. 后台 Cron 自动检查，满足条件即推送，无需打开页面

## 提醒规则

- 买价：股价跌入 [买价×(1-幅度), 买价] 区间时触发
- 卖价：股价涨入 [卖价×(1-幅度), 卖价×(1+幅度)] 区间时触发
- 幅度默认 10%，每行可改
- 首次触发立即推送；持续满足时每 3-10 分钟随机复查，每小时最多 1 条、每天最多 5 条，超出只标红
- 检查时段：9:15-11:30、13:00-15:30（北京时间），11:31 和 15:31 各做一次收尾检查
