# Preprint Bridge：Zotero 10 预印本更新插件

这个插件会先查找正式发表版本，展示来源、题名、会议和链接，**只有你确认后才改写原 Zotero 条目**。原条目的 ID、PDF 附件、批注、笔记、标签和馆藏继续保留。

## 使用

1. 将 `preprint-bridge-0.1.3.xpi` 拖入 Zotero 的「工具 → 插件」窗口安装。旧版 0.1.0—0.1.2 不要再使用。
2. 右键单击一篇 arXiv **预印本主条目**，选择「查找正式发表版本（确认后更新）」。不要选择 PDF 附件。
3. 查看检索结果及来源，确认无误后更新。对于 arXiv 评论标注了 `ICML 20xx` 的论文，插件会先查 PMLR 官方论文集；其他论文会尝试 DBLP，再尝试 Crossref。
4. 若你已经通过 Zotero Connector 导入了正式版本，也可以同时选中预印本主条目和会议/期刊论文主条目，选择「将正式版本信息复制到预印本」。正式版本条目暂时保留，方便你检查后自行处理重复项。
5. 对已经用旧版更新的 PMLR 会议论文（包括这篇 ICML），选中原条目，右键选择「重新核对 PMLR 信息与 CCF 评级」，查看确认框后更新原条目。

对于 PMLR 论文，确认框会展示会议届次、正式论文集名称、PMLR 系列、卷次、页码、出版方、正式 PDF 链接及 CCF 评级；正式 PDF 只展示链接，不会替换原附件。评级取自提供的《中国计算机学会推荐国际学术会议和期刊目录（2026 年）》；ICML 位于“人工智能—国际学术会议—A 类”（PDF 第 57 页）。插件从该目录提取 605 条名称清晰的会议及期刊记录，匹配不可靠或缩写有歧义时不显示等级。评级会写入 Zotero 的「其他」字段 `CCF Rating (2026): ...`，而不会冒充 DOI 或期刊信息。

DBLP 若返回 HTTP 200 的反机器人 HTML 页面，插件会显示「检索失败」及其原因，不会把它当作论文尚未发表。不会请求 Semantic Scholar，也不会自动删条目或替换带批注的 PDF。

## 构建和发布

```sh
npm test
python scripts/build.py
```

XPI 生成在 `dist/`，同时生成带 XPI SHA-256 的 `update.json`。`manifest.json` 的更新地址指向 `https://raw.githubusercontent.com/Kazuma-yj/perprint-bridge/main/update.json`，其安装包地址指向同仓库 `dist/` 下的对应版本。发布新版本时须一起提交更新清单和安装包；已经发布的安装包不要覆盖，以便校验其哈希。插件 ID 在用户已经安装后不要随意更改。

若要从另一份同格式的 CCF 目录重新生成评级数据，安装 `pdfplumber` 后运行 `python scripts/extract_ccf.py <CCF目录.pdf>`；原 PDF 不包含在源码压缩包中。

本项目不依赖 npm 包；源码使用 MIT 许可证。当前版本仅面向 Zotero 10.0.x 和现代格式的 arXiv ID。自动 PMLR 检索现支持 ICML。你已用 0.1.2 在 Zotero 10.0.3 完成一次更新；新增的 0.1.3 功能尚需在 Zotero 中实际验证。如仍出现错误，请从「工具 → 开发者 → 错误控制台」复制对应行。
