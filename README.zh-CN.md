# Preprint Bridge：Zotero 10 预印本更新插件

这个插件会先查找正式发表版本，展示来源、题名、会议和链接，**只有你确认后才改写原 Zotero 条目**。原条目的 ID、PDF 附件、批注、笔记、标签和馆藏继续保留。

## 使用

1. 将 `preprint-bridge-xxx.xpi` 拖入 Zotero 的「工具 → 插件」窗口安装。当前版本是 0.1.4，安装后重启 Zotero。
2. 右键单击一篇 arXiv **预印本主条目**，选择「核对发表或录用信息（确认后更新）」。不要选择 PDF 附件。
3. 查看检索结果及来源，确认无误后更新。对于 arXiv 评论标注了 `ICML 20xx` 的论文，插件会先查 PMLR 官方论文集；其他论文会尝试 DBLP，再尝试 Crossref。若正式来源还没有记录，但 arXiv 评论明确给出了论文集、会议全称和届次，可选择记录**已录用、待正式出版**的信息；这种情况不会填入未经核实的正式 DOI，日后仍可用相同右键菜单重新查询。
4. 若你已经通过 Zotero Connector 导入了正式版本，也可以同时选中预印本主条目和会议/期刊论文主条目，选择「将正式版本信息复制到预印本」。正式版本条目暂时保留，方便你检查后自行处理重复项。

会议名称会附上缩写与年份，例如 `International Conference on Machine Learning (ICML 2025)`。「其他」字段只写 arXiv ID、简洁的 CCF 评级，以及需要区分录用和正式出版时的状态；旧版产生的冗长历史行会清理，个人备注保留。

DBLP 若返回 HTTP 200 的反机器人 HTML 页面，插件会显示「检索失败」及其原因，不会把它当作论文尚未发表。不会请求 Semantic Scholar，也不会自动删条目或替换带批注的 PDF。

## 构建和发布

```sh
npm test
python scripts/build.py
```

XPI 生成在 `dist/`，同时生成带 XPI SHA-256 的 `update.json`。`manifest.json` 的更新地址指向 `https://raw.githubusercontent.com/Kazuma-yj/perprint-bridge/main/update.json`，其安装包地址指向同仓库 `dist/` 下的对应版本。发布新版本时须一起提交更新清单和安装包；已经发布的安装包不要覆盖，以便校验其哈希。插件 ID 在用户已经安装后不要随意更改。

若要从另一份同格式的 CCF 目录重新生成评级数据，安装 `pdfplumber` 后运行 `python scripts/extract_ccf.py <CCF目录.pdf>`；原 PDF 不包含在源码压缩包中。

本项目不依赖 npm 包；源码使用 MIT 许可证。当前版本仅面向 Zotero 10.0.x 和现代格式的 arXiv ID。自动 PMLR 检索现支持 ICML。0.1.4 尚需在 Zotero 中实际验证。如仍出现错误，请从「工具 → 开发者 → 错误控制台」复制对应行。旧版 0.1.2 的安装包写有无效的 example.com 更新地址，0.1.3 和 0.1.4 的清单已改为 GitHub 地址。
