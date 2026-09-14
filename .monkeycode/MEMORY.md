# User Instruction Memory

stock-alert（股票价格提醒）项目独立仓库的记忆文件。

## Entries

[项目架构决策]
- Date: 2026-09-14
- Context: 用户明确要求的架构约束
- Category: Workflow & Collaboration / Operations & Deployment
- Instructions:
  - 独立 GitHub 仓库 dosvovo/stock-alert，与 rem（APK）仓库完全分离
  - 仅依赖三项服务：Cloudflare、GitHub、Resend；禁止引入 Supabase 等其他依赖
  - 邮件主通道：Cloudflare 域名邮箱（Email Routing + Worker send_email binding，收件人需在 Email Routing 验证）
  - 邮件备用通道：Resend（绑定用户域名发件，需域名 DKIM/SPF DNS 记录）
  - 微信推送：WxPusher（用户晚点提供 APP_TOKEN 和 UID）
  - 域名 DNS 托管在 Cloudflare，新域名尚未解析
  - 页面访问口令（ALERT_KEY）由用户自定义

[部署流程]
- Date: 2026-09-14
- Context: CI/CD 方案
- Category: Build Methods
- Instructions:
  - CI：.github/workflows/deploy.yml，npm install + tsc --noEmit 检查，CF secrets 配置后自动 wrangler deploy
  - D1 建表在 deploy 步骤自动执行：wrangler d1 execute stock-alert --remote --file=schema.sql
  - git remote 每次推送前注入 token、推送后清除
  - CI 必须 Node 22+（wrangler 4.x 拒绝 Node 20）
  - 已上线：VareDog/stock-alert 仓库，Worker=stock-alert，域名 https://snn.de5.net，D1 id=a984695f-e97f-4ea7-afa2-eac64b34a4f7
  - Worker secrets 通过 CF API PUT /accounts/{id}/workers/scripts/stock-alert/secrets 配置；GitHub Secrets 通过 pynacl sealed box 加密 PUT
  - sandbox 环境无法直连 workers.dev 和非白名单站点（443 SNI 过滤），DNS 验证用 cloudflare-dns.com DoH JSON API，UDP 53 出站被禁
  - 用户 CF token（cfut_）限制：无 zone.create、无 Custom Domains API（405 authentication scheme）、无 Email Routing enable；域名绑定用"橙云 A 记录 + Worker Route"方案代替 Custom Domains
  - zone id snn.de5.net=d4e010e5f906e0ab90f19822760dcac9，NS=daisy/fred.ns.cloudflare.com
  - Email Routing 配置状态：MX/SPF/转发规则(stock@snn.de5.net→308311050@qq.com)已 API 配好，destination 验证和启用状态需用户 Dashboard 确认
  - 用户两个 GitHub 账号：dosvovo（APK/rem 仓库）、VareDog（web/stock-alert/NOTEBOOK/dostime）

[已知教训]
- Date: 2026-09-14
- Context: 开发过程中踩坑
- Category: Troubleshooting & Debugging
- Instructions:
  - GitHub Actions job 级 if 表达式不能用 secrets 上下文（解析直接失败、run 无 jobs），需用 job env 中转
  - wrangler 4.x 要求 @cloudflare/workers-types 5.x，锁 4.x 会 peer dependency 冲突
  - D1 prepared statement：.first(colName?) 的参数是列名；带条件查询必须 .bind().first()
  - npm 包 tsc@2.0.4 是假包，TypeScript 编译器必须用 ./node_modules/.bin/tsc 或 typescript 包
