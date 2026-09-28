# 1.3.0 validation / 测试记录

Date: 2026-09-28. Version: **1.3.0**.

**76 Node automated tests passed.** New regressions cover independent field selection, exact save/undo, type-conversion dependencies, empty selections, manual edits, official ICML 2025 ISSN/location, absent versus supplied DOI, mismatched volumes, optional-source failures, and exact-DOI enrichment. The BERT case also verifies that a proceedings title deposited as an event name does not replace a usable conference label.

**29 actual-XPI checks passed in official Linux Zotero 10.0.3.** The reported ICML 2025 paper was recreated in a disposable database with `PM`, `Proc`, and a manually edited conference name. Clicking only the conference-name checkbox preserved the publisher/proceedings fields. ISSN and conference location were then filled separately; DOI, ISBN and publisher location remained empty. Undo restored the previous values. A single-field preprint update preserved its type, archive ID and URL. The suite also exercises real item-type conversion, visible layout, database saves, author/child-note identity, reopening and disable/enable. See [native report](tests/zotero-results-1.3.0.json).

**Eleven workflow cases across ten distinct papers passed on the final code**, using cached public responses (zero network requests in the final replay). One new exact-DOI Crossref response was fetched during the preceding investigation. This is recorded-response regression, not eleven fresh network lookups. See [workflow report](tests/live-results-1.3.0.json). The reported paper and volume were additionally retrieved from PMLR and reduced to citation-only [fixtures](tests/fixtures/icml-2025-metadata.json).

The actual XHTML Chromium suite adds a sixth interaction scenario: clear fields, select only conference name, toggle by keyboard without losing focus, save, and show only the selected field in the saved table. Chromium and native Zotero tests are release gates; CI stores screenshots and reports as artifacts. The former 1.2.0 blank-window regression is also rerun against its unchanged XPI.

Package verification compares every XPI entry with source and checks bootstrap callbacks, manifest versions, update URLs and SHA-256. Release tests cover immutable published assets, draft publication order, failed uploads and conflicting tags.

**Limit:** Windows and macOS have not been tested on-device. Linux headless Zotero validates actual Gecko windows and the item database, but not OS-specific display behavior. Native tests use recorded responses in an isolated temporary profile, never a user library.

## 1.3.0 新增验证

- 出版社、论文集标题、会议名称可分别勾选；未勾选字段不被保存。
- 不选任何字段时不能更新；批量勾选论文保留字段选择；重新预览后需再次确认。
- 条目类型必需的转换字段联动；保存前检查隐式变化，不能静默修改未选字段。
- 仅保存的差异显示在成功结果中；撤销恢复原值，后续手动编辑仍受保护。
- 官方页面中的 ISSN/语言、卷册中的会议地点被读取；地点不混填，DOI/ISBN 不虚构。
- 额外卷册读取失败保留已经验证的论文；不同卷册被拒绝；同卷册使用短期缓存。
- DBLP DOI 链接按相同 DOI 补全 Crossref 详情，拒绝 DOI/类型/题名/作者不符的数据。

## 1.2.1 白屏回归

已在官方 Linux Zotero 10.0.3 中安装原始 1.2.0 XPI，复现标题为空、队列为 0 的 `about:blank` 原生窗口。
1.2.1 注册 `chrome://preprint-bridge/content/review.xhtml` 后，真实 XPI 通过以下检查：

- 插件包已实际安装、启用，窗口使用系统权限加载正确的 chrome 地址。
- 标题、队列、字段差异可见；真实 Zotero 条目的 clone 支持预览。
- 点击勾选与更新后，真实测试数据库保存出版信息。
- 条目 key、作者与子笔记保留；撤销恢复原条目类型及备注。
- 关闭后可重新打开；禁用会关闭窗口并注销资源，重新启用恢复正常。

测试使用隔离的临时 profile 与数据目录，Crossref 响应使用已有快照。原生截图已人工查看。发布流程新增同样的原生测试，防止浏览器测试通过但 Zotero 窗口打不开。
另新增启动失败后注销资源与重新启动的自动化测试。

## 1.2.0 新增测试

新增 11 项模型与 Zotero 适配器回归测试全部通过；5 组真实 XHTML 界面交互场景全部通过，页面报错为 0。

覆盖范围：

- 修改预览与实际写入一致，包括条目类型转换导致的字段移除；不保存预览副本。
- 批量只更新勾选项；保存失败恢复内存数据并继续后续条目。
- 撤销恢复更新前字段、类型和备注；原条目 ID 与附件不变。
- 后续手改默认不被覆盖；重新预览允许主动覆盖，包括手改题名。
- 撤销覆盖显示当前差异，确认或取消均按预期处理。
- 重新预览后又手改时再次保护；撤销保存失败保留撤销记录。
- 顺序队列、去重、停止与继续，取消后的迟到结果不写入；保存中停止会完成当前事务并保留撤销，后续条目不写入。
- 仅录用结果不被“勾选全部正式记录”选中；候选切换清除勾选。
- 关闭、禁用、再次打开核对窗口的生命周期。
- 按来源间隔请求；DBLP 两个接口共享 429 冷却；等待中可停止。

`tests/review-ui.browser.cjs` 使用真实打包的 XHTML/CSS/JavaScript，覆盖中英文、字段差异、成功状态、撤销、主动覆盖、停止/继续、窄窗口深色模式，以及元数据仅按文本显示。浏览器控制器使用测试数据，Zotero 数据库仍使用模拟对象。CI 将浏览器检查设为发布前置条件，并保存截图与结果。

## 真实论文检索

使用当天访问真实 arXiv、PMLR、DBLP 和 Crossref 服务获得的响应，对 1.2.0 最终代码进行缓存回放。本轮全部使用已有缓存，不将缓存回放称为新的实时检索。
每个匹配还调用插件的 `apply()`，检查模拟 Zotero 条目实际得到的会议名称、年份和简洁 CCF 字段。
这不是 Windows Zotero 界面的自动化测试，也没有修改任何用户条目。

| 论文／流程 | 本轮结果 | CCF 2026 |
| --- | --- | --- |
| [Random Forests](https://doi.org/10.1023/A:1010933404324)，已有期刊条目 | DOI 直接核对为 Machine Learning 2001，45 卷，5–32 页；无需 arXiv 标识 | B，按完整刊名匹配 |
| [Deep learning](https://doi.org/10.1038/nature14539)，已有期刊条目 | DOI 直接核对为 Nature 2015，521 卷，436–444 页 | 无匹配，不填评级 |
| [BERT](https://doi.org/10.18653/v1/N19-1423)，已有会议条目 | DOI 直接核对正式论文集与页码，保留已有 NAACL 会议名称用于 CCF 匹配 | B |
| [Stealing Part of a Production Language Model](https://arxiv.org/abs/2403.06634) | ICML 2024，PMLR 235，5680–5705 页；arXiv 无会议说明也能找到 | A |
| [The Platonic Representation Hypothesis](https://arxiv.org/abs/2405.07987) | ICML 2024；识别正式版的 `Position:` 前缀 | A |
| [Auditing Prompt Caching in Language Model APIs](https://arxiv.org/abs/2502.07776) | ICML 2025，PMLR 267，20477–20496 页 | A |
| [LoRA](https://arxiv.org/abs/2106.09685) | ICLR 2022，DBLP 官方 SPARQL 返回正式记录 | A |
| [Attention Is All You Need](https://arxiv.org/abs/1706.03762) | NIPS / NeurIPS 2017，5998–6008 页；兼容旧 HTTP arXiv 链接和题名大小写 | A |
| [BERT](https://arxiv.org/abs/1810.04805) | NAACL 2019，4171–4186 页，DOI `10.18653/V1/N19-1423` | B |
| [Behavioral Consistency and Transparency Analysis on Large Language Model API Gateways](https://arxiv.org/abs/2604.21083) | 仅确认 IMC 2026 录用说明；保留 arXiv 链接，正式 DOI 留空 | B |
| [What Converges in the Platonic Representation Hypothesis? Structure over Geometry](https://arxiv.org/abs/2609.27252) | 本轮无可靠匹配且部分来源失败；状态为检索未完成，不写入出版信息 | 不写入 |

共 11 条流程用例，涉及 10 篇不同论文：9 个正式发表匹配、1 个仅录用状态、1 个未确认状态。
“未确认”不是“尚未发表”的断言。全部状态和写入检查通过，不代表所有论文均能自动找到。
完整检索状态及模拟写入字段见 [`tests/live-results-1.2.0.json`](tests/live-results-1.2.0.json)。
历史结果保留在 [`1.0.0`](tests/live-results-1.0.0.json) 与 [`0.1.5`](tests/live-results-0.1.5.json)。

复跑联网测试（Node 与 Python 3；可能受服务状态影响）：

```sh
node scripts/live-smoke.cjs
# 或只测指定 arXiv ID / DOI
node scripts/live-smoke.cjs 2403.06634 10.1038/nature14539
```

## 自动回归测试

`npm test`：76 项通过，包括：

- 无 arXiv 会议说明时，从官方 ICML 目录查找；排除 GRaM 等工作坊。
- DBLP 返回 HTTP 200 HTML 时继续检索；429 不触发同源自动重试。
- 第一作者不符、非正式记录、arXiv DOI/URL、实质性题名变化的拒绝。
- 真实 PMLR、LoRA、Attention、BERT 元数据回放。
- 下一年份检索、PMLR 验证页失败、目录缓存和标题引号解析。
- CCF、会议全称及缩写年份、简洁 Extra、原条目 ID / 附件保留。
- 启动、重复启停、初始化中禁用、检索中禁用后不再写入或弹窗。
- CCF 相邻表格行不再串入会议名称；ACNS、SACMAT、ASPLOS、CHI 等名称回归。
- 缺失作者、复合姓氏、不完整 Crossref 元数据、DBLP 无效链接的保守处理。
- 稀疏元数据保留已有 DOI、页码、卷次与详细日期；写入失败恢复原条目类型和字段。
- 只读条目提前拒绝；禁用时关闭等待提示；失败目录在一次检索中只请求一次。
- Release 重跑不覆盖已发布资源；上传失败不发布草稿；校验不符或标签冲突时停止。
- 所有论文类型使用固定菜单；手动补全统一放在“高级”；多选、只读、附件等情况的启用状态正确。
- 统一入口支持已有 DOI 的会议和期刊条目，标题／作者不符时拒绝，限流不重复请求。
- 正式 DOI 约束备用候选，已发表记录不降级为仅录用信息；同 DOI 刷新保留详细日期。
- 批量 CCF 仅改评级，保留备注与录用状态；支持目录中没有简称的期刊。
- 取消／禁用后不写入；CCF 保存失败恢复原值并继续；旧请求结束不解除新请求的忙碌状态。
- 正式版本条目可通过“其他”中保存的标识打开原 arXiv 页面。

打包检查：XPI 内文件逐一与源码比较；确认全部 bootstrap 回调；清单版本、下载地址及安装包 SHA-256 一致。

## 尚需实际客户端验证

运行环境没有 Windows Zotero 10.0.3，不能声称已验证该界面的安装、右键菜单、翻译和重启行为。
Windows/macOS 客户端验证应在正常模式下安装/启用 1.3.0，覆盖固定子菜单、灰色命令、停止与继续、单篇/多篇出版更新、手改后主动覆盖、窗口内撤销、批量 CCF、重复启停、重启与检查更新。

0.1.4 和 0.1.5 的 XPI 均包含 `shutdown`。Zotero 10.0.3 的加载器在找不到插件作用域/回调时也会输出同一句
`missing bootstrap method`。日志同时存在 `safeMode => true`，因此未将这条警告归因于函数缺失，也未声称警告已完全消除。
参考 [Zotero 10.0.3 插件加载器](https://github.com/zotero/zotero/blob/10.0.3/chrome/content/zotero/xpcom/plugins.js)。

DBLP 备用查询使用[官方 SPARQL 服务](https://blog.dblp.org/2024/09/09/introducing-our-public-sparql-query-service/)。
测试快照只保存必要的公开书目信息；PMLR 快照来源列于 `tests/fixtures/icml-2024.json`，DBLP 快照来自官方接口（CC0）。
