# 001 - RAG 递归语义分块算法改进说明 (2026-07-06)

本篇文档记录了对本地桌面端 RAG 系统的第一次关键性演进：**将暴力按 Token 数截断的文本切片逻辑升级为层次化递归语义切片逻辑**。

---

## 1. 改进背景与问题排查

在之前的 RAG 问答中，如果用户上传的 PDF（尤其是国内双栏学术排版）或复杂 Markdown 文档中含有较长段落时，经常会出现**检索精准度差、回答不准确甚至直接“拒答”**的情况。

其根本原因在于原有的 `splitTextIntoChunks` 算法直接按照 Token 数组进行硬编码截断。这种“一刀切”的做法带来两大缺陷：
1. **语义断裂**：句子被劈成两半，前一个分块拥有主语和上半句，后一个分块拥有宾语和下半句。大模型检索到任何一个分块都无法理解该句子的原本含义。
2. **术语残缺**：英文字符或多字节中文字符可能在切片边界被强行截断，破坏了高频关键词的 Embedding 向量表征，阻碍了后续的余弦相似度检索。

---

## 2. 语义递归切片设计 (Design & Implementation)

我们在 [rag-service.js](file:///d:/JetBrains/notebookproject/notebook-electron/rag-service.js) 中实现了全新的 `splitTextIntoChunks`。其核心处理逻辑采用**多层级回退（Fallback）切分**策略：

### A. 段落层级切片
第一步尝试通过换行符（如连续两个及以上的换行符 `\n\n+`）将文章分割为独立的物理段落。
* 如果某段落的 Token 长度未超出 `chunkSize`，说明该段落是一个完整的语义块，我们直接对其进行收纳，并尽可能合并相邻的段落。

### B. 句级递归细分 (超长段落处理)
如果某一个段落非常长，其 Token 长度超过了限制（如 512 tokens），算法会自动对其触发**句子层级**的细分：
* 使用正则表达式 **`/(?<=[。？！；\n])/`** 作为切分条件。
* **技术亮点：正向后瞻断言（Lookbehind Assert）**：这里的正则表达式使用正向后瞻断言，保证切分出的句尾标点符号（如 `。`、`？`、`！`、`；`）**完整保留在子句的结尾**，不被过滤掉。
* 拆分成句子数组后，循环遍历句子并将其逐步追加到临时块中。只有当追加当前句子会使块大小超出 `chunkSize` 时，才进行结算。

### C. 平滑的重叠度 (Overlap)
* 增加了块与块之间的重叠度，从 50 Token 提高到 **100 Token**（约占 Chunk Size 的 20%）。
* 在句子需要切分到下一个分块时，会从上一个分块中安全拷贝末尾 `100 Token` 的局部词句，拼接到新分块的头部，确保文章前后逻辑连贯。

---

## 3. 修改细节对比 (Code Diff)

```diff
-function splitTextIntoChunks(text, chunkSize = 512, chunkOverlap = 50) {
-  if (!text) return [];
-  const enc = getEncoding('cl100k_base');
-  const tokens = enc.encode(text);
-  const chunks = [];
-
-  let start = 0;
-  while (start < tokens.length) {
-    const end = Math.min(start + chunkSize, tokens.length);
-    const chunkTokens = tokens.slice(start, end);
-    chunks.push(enc.decode(chunkTokens));
-
-    if (end === tokens.length) {
-      break;
-    }
-    start += (chunkSize - chunkOverlap);
-  }
-  return chunks;
-}

+function splitTextIntoChunks(text, chunkSize = 512, chunkOverlap = 100) {
+  if (!text) return [];
+  const enc = getEncoding('cl100k_base');
+  
+  const paragraphs = text.split(/\n\n+/);
+  const chunks = [];
+  let currentChunk = [];
+  let currentLength = 0;
+
+  for (const para of paragraphs) {
+    const paraTokens = enc.encode(para);
+    
+    if (paraTokens.length > chunkSize) {
+      if (currentChunk.length > 0) {
+        chunks.push(enc.decode(currentChunk));
+        currentChunk = [];
+        currentLength = 0;
+      }
+      
+      const sentences = para.split(/(?<=[。？！；\n])/);
+      for (const sentence of sentences) {
+        const sentenceTokens = enc.encode(sentence);
+        if (currentLength + sentenceTokens.length > chunkSize) {
+          if (currentChunk.length > 0) {
+            chunks.push(enc.decode(currentChunk));
+          }
+          const overlapCount = Math.min(chunkOverlap, currentChunk.length);
+          currentChunk = currentChunk.slice(currentChunk.length - overlapCount).concat(sentenceTokens);
+          currentLength = currentChunk.length;
+        } else {
+          currentChunk.push(...sentenceTokens);
+          currentLength += sentenceTokens.length;
+        }
+      }
+    } else {
+      if (currentLength + paraTokens.length > chunkSize) {
+        if (currentChunk.length > 0) {
+          chunks.push(enc.decode(currentChunk));
+        }
+        const overlapCount = Math.min(chunkOverlap, currentChunk.length);
+        currentChunk = currentChunk.slice(currentChunk.length - overlapCount).concat(paraTokens);
+        currentLength = currentChunk.length;
+      } else {
+        currentChunk.push(...paraTokens);
+        currentLength += paraTokens.length;
+        currentChunk.push(...enc.encode("\n\n"));
+        currentLength += 2;
+      }
+    }
+  }
+
+  if (currentChunk.length > 0) {
+    chunks.push(enc.decode(currentChunk));
+  }
+
+  return chunks.filter(c => c.trim().length > 0);
+}
```

---

## 4. 学习与思考点 (Key Takeaways)

1. **RAG 中的语义完整性高于精准容量**：把文本刚好填满 512 个 token 并不是最佳做法。优先保证一个 Chunk 包含完整的主谓宾、逻辑段落，能让大模型更好地理解前因后果，回答质量远超残缺信息。
2. **正向后瞻正则表达式的妙用**：`/(?<=[。？！；\n])/` 让我们可以在不丢失标点符号的情况下分割字符串。普通的 `.split('。')` 会将句号过滤掉，这会让生成的上下文失去自然的阅读停顿。
3. **测试数据的重要性**：在上线前通过构造具有特定长度的边界文本来调试 `chunkSize` 和 `overlap` 参数，能够快速暴露边界溢出和死循环隐患。
