# 0.1.5 测试记录

日期：2026-09-28。测试对象：与 `dist/preprint-bridge-0.1.5.xpi` 相同的代码。

## 真实论文检索

访问真实 arXiv、PMLR、DBLP 和 Crossref 服务；最终复跑复用了本轮部分 HTTP 响应缓存。
每个匹配还调用插件的 `apply()`，检查模拟 Zotero 条目实际得到的会议名称、年份和简洁 CCF 字段。
这不是 Windows Zotero 界面的自动化测试，也没有修改任何用户条目。

| 预印本 | 本轮结果 | CCF 2026 |
| --- | --- | --- |
| [Stealing Part of a Production Language Model](https://arxiv.org/abs/2403.06634) | ICML 2024，PMLR 235，5680–5705 页；arXiv 无会议说明也能找到 | A |
| [The Platonic Representation Hypothesis](https://arxiv.org/abs/2405.07987) | ICML 2024；识别正式版的 `Position:` 前缀 | A |
| [Auditing Prompt Caching in Language Model APIs](https://arxiv.org/abs/2502.07776) | ICML 2025，PMLR 267，20477–20496 页 | A |
| [LoRA](https://arxiv.org/abs/2106.09685) | ICLR 2022，DBLP 官方 SPARQL 返回正式记录 | A |
| [Attention Is All You Need](https://arxiv.org/abs/1706.03762) | NIPS / NeurIPS 2017，5998–6008 页；兼容旧 HTTP arXiv 链接和题名大小写 | A |
| [BERT](https://arxiv.org/abs/1810.04805) | NAACL 2019，4171–4186 页，DOI `10.18653/V1/N19-1423` | B |
| [Behavioral Consistency and Transparency Analysis on Large Language Model API Gateways](https://arxiv.org/abs/2604.21083) | 仅确认 IMC 2026 录用说明；保留 arXiv 链接，正式 DOI 留空 | B |
| [What Converges in the Platonic Representation Hypothesis? Structure over Geometry](https://arxiv.org/abs/2609.27252) | 本轮无可靠匹配且部分来源失败；状态为检索未完成，不写入出版信息 | 不写入 |

共 8 个样本：6 个正式发表匹配、1 个仅录用状态、1 个未确认状态。
“未确认”不是“尚未发表”的断言。全部状态和写入检查通过，不代表所有论文均能自动找到。
完整检索状态及模拟写入字段见 [`tests/live-results-0.1.5.json`](tests/live-results-0.1.5.json)。

复跑联网测试（Node 与 Python 3；可能受服务状态影响）：

```sh
node scripts/live-smoke.cjs
# 或只测指定 arXiv ID
node scripts/live-smoke.cjs 2403.06634 2106.09685
```

## 自动回归测试

`npm test`：26 项通过，包括：

- 无 arXiv 会议说明时，从官方 ICML 目录查找；排除 GRaM 等工作坊。
- DBLP 返回 HTTP 200 HTML 时继续检索；429 不触发同源自动重试。
- 第一作者不符、非正式记录、arXiv DOI/URL、实质性题名变化的拒绝。
- 真实 PMLR、LoRA、Attention、BERT 元数据回放。
- 下一年份检索、PMLR 验证页失败、目录缓存和标题引号解析。
- CCF、会议全称及缩写年份、简洁 Extra、原条目 ID / 附件保留。
- 启动、重复启停、初始化中禁用、检索中禁用后不再写入或弹窗。

打包检查：XPI 内文件逐一与源码比较；确认全部 bootstrap 回调；清单版本、下载地址及安装包 SHA-256 一致。

## 尚需实际客户端验证

运行环境没有 Windows Zotero 10.0.3，不能声称已验证该界面的安装、右键菜单、翻译和重启行为。
请退出安全模式，正常重启 Zotero 后安装/启用 0.1.5，再核对一次条目。

0.1.4 和 0.1.5 的 XPI 均包含 `shutdown`。Zotero 10.0.3 的加载器在找不到插件作用域/回调时也会输出同一句
`missing bootstrap method`。日志同时存在 `safeMode => true`，因此未将这条警告归因于函数缺失，也未声称警告已完全消除。
参考 [Zotero 10.0.3 插件加载器](https://github.com/zotero/zotero/blob/10.0.3/chrome/content/zotero/xpcom/plugins.js)。

DBLP 备用查询使用[官方 SPARQL 服务](https://blog.dblp.org/2024/09/09/introducing-our-public-sparql-query-service/)。
测试快照只保存必要的公开书目信息；PMLR 快照来源列于 `tests/fixtures/icml-2024.json`，DBLP 快照来自官方接口（CC0）。
