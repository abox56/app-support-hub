# 域名更换计划 (Domain Transition Plan)

## 1. 状态记录 (Status)
- **当前状态**: 开发中 (Development)
- **目标**: 在所有功能上线后，更换为自定义域名以隐藏 `railway.app` 后缀。

## 2. 推荐后缀 & 预算 (Top TLD Recommendations)
| 后缀 (TLD) | 预估首年 (First Year) | 预备续费 (Renewal) | 推荐理由 |
| :--- | :--- | :--- | :--- |
| `.xyz` | $1 - $2 | ~$12 | 现代感强，首年极低 |
| `.icu` | ~$2 | ~$10 | 长期持有成本最低 |
| `.com` | ~$10 | ~$12 | 最专业、最公认 |
| `.app` | ~$15 | ~$15 | 契合应用属性 |

## 3. 建议域名名字 (Suggested Names)
1. `cloudway-hub.xyz`
2. `cloudway-ops.xyz`
3. `appsup-hub.icu`
4. `cw-status.site`

## 4. 操作指南 (Step-by-Step Guide)
1. **购买**: 建议通过 [Cloudflare](https://www.cloudflare.com/products/registrar/) 或 [Porkbun](https://porkbun.com/) 购买。
2. **Railway 配置**:
   - 进入 Railway 控制台 -> Settings -> Domains。
   - 点击 `Add Custom Domain` 并输入新域名。
3. **DNS 设置**:
   - 将 Railway 提供的 `CNAME` 记录复制到域名的托管商后台。
4. **验证**: 等待 DNS 生效 (通常几分钟)，即可访问新域名。

---
*记录时间: 2026-03-09*
