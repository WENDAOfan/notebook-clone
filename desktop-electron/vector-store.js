const fs = require('fs');
const path = require('path');

class SimpleVectorStore {
  constructor() {
    this.filePath = null;
    this.store = []; // 数组结构: [{ id, text, metadata, embedding }]
  }

  /**
   * 初始化并载入向量数据文件
   */
  init(filePath) {
    this.filePath = filePath;
    try {
      if (fs.existsSync(filePath)) {
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        if (fileContent.trim()) {
          this.store = JSON.parse(fileContent);
          console.log(`[向量存储] 成功载入向量数据，共计 ${this.store.length} 个分块`);
        } else {
          this.store = [];
          console.log(`[向量存储] 向量数据文件为空，已初始化空库`);
        }
      } else {
        this.store = [];
        // 确保父目录存在
        const parentDir = path.dirname(filePath);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }
        fs.writeFileSync(filePath, JSON.stringify([]), 'utf-8');
        console.log(`[向量存储] 向量数据文件不存在，已初始化空库并创建文件: ${filePath}`);
      }
    } catch (e) {
      console.error("[向量存储] 加载向量数据库失败，使用空内存库启动:", e);
      this.store = [];
    }
  }

  /**
   * 写入/更新向量分块
   * @param {Array} enrichedChunks 元素格式: { id, text, metadata, embedding }
   */
  async add(enrichedChunks) {
    for (const chunk of enrichedChunks) {
      if (!chunk.id || !chunk.embedding) continue;
      
      // 如果已存在相同的 ID 则替换，否则追加
      const idx = this.store.findIndex(item => item.id === chunk.id);
      if (idx !== -1) {
        this.store[idx] = chunk;
      } else {
        this.store.push(chunk);
      }
    }
    await this.save();
    console.log(`[向量存储] 已添加/更新 ${enrichedChunks.length} 个分块，总分块数: ${this.store.length}`);
  }

  /**
   * 按 ID 列表删除向量
   * @param {Array<string>} chunkIds 
   */
  async delete(chunkIds) {
    const originalLength = this.store.length;
    this.store = this.store.filter(item => !chunkIds.includes(item.id));
    await this.save();
    console.log(`[向量存储] 已删除 ${originalLength - this.store.length} 个分块，剩余分块数: ${this.store.length}`);
  }

  /**
   * 按前缀过滤删除（可选便利函数，例如删除某个文档的所有分块）
   */
  async deleteByDocumentId(documentId) {
    const originalLength = this.store.length;
    this.store = this.store.filter(item => item.metadata && item.metadata.documentId !== documentId);
    await this.save();
    console.log(`[向量存储] 清理文档 ID ${documentId}，已删除 ${originalLength - this.store.length} 个分块，剩余分块数: ${this.store.length}`);
  }

  /**
   * 将当前内存中的向量库序列化保存到本地 JSON 文件
   */
  save() {
    return new Promise((resolve, reject) => {
      if (!this.filePath) {
        return resolve();
      }
      fs.writeFile(this.filePath, JSON.stringify(this.store, null, 2), 'utf-8', (err) => {
        if (err) {
          console.error("[向量存储] 向量文件保存失败:", err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * 向量相似度检索 (RAG 核心)
   * @param {Array<number>} queryEmbedding 提问产生的 Embedding 向量 (1024 维)
   * @param {number} topK 返回的最相似条目数
   * @param {Function} filterFunc 过滤函数，接收 metadata 作为参数，返回 boolean
   * @returns {Array} 相似度排序后的分块列表
   */
  similaritySearch(queryEmbedding, topK = 5, filterFunc = null) {
    if (!queryEmbedding || this.store.length === 0) {
      return [];
    }

    // 1. 过滤文档元数据
    let candidates = this.store;
    if (filterFunc) {
      candidates = candidates.filter(item => filterFunc(item.metadata));
    }

    // 2. 计算各候选分块与提问的余弦相似度
    const scored = candidates.map(item => {
      const score = cosineSimilarity(queryEmbedding, item.embedding);
      return {
        id: item.id,
        text: item.text,
        metadata: item.metadata,
        score: score
      };
    });

    // 3. 按相似度得分从高到低排序，截取 Top-K
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  /**
   * 关键词检索：对存储中的所有分块做 TF 词频打分，返回与查询词最匹配的 topK 个分块。
   * 支持中英文混合文本，由调用方传入已分词的 terms 数组。
   *
   * @param {Array<string>} terms 查询关键词数组（由 tokenizeQuery 产生）
   * @param {number} topK 返回条目上限
   * @param {Function|null} filterFunc 元数据过滤函数
   * @returns {Array} 按关键词匹配得分排序的分块列表 [{ id, text, metadata, score }]
   */
  keywordSearch(terms, topK = 20, filterFunc = null) {
    if (!terms || terms.length === 0 || this.store.length === 0) {
      return [];
    }

    let candidates = this.store;
    if (filterFunc) {
      candidates = candidates.filter(item => filterFunc(item.metadata));
    }

    const scored = [];
    for (const item of candidates) {
      const textLower = item.text.toLowerCase();
      let matchScore = 0;

      for (const term of terms) {
        // 统计 term 在 chunk 中的出现次数（简单 TF）
        let count = 0;
        let pos = 0;
        const termLower = term.toLowerCase();
        while ((pos = textLower.indexOf(termLower, pos)) !== -1) {
          count++;
          pos += termLower.length;
        }

        if (count > 0) {
          // 归一化：长文本中命中一次不如短文本中命中一次有说服力
          const tf = count / (textLower.length / 100);
          matchScore += tf;
        }
      }

      if (matchScore > 0) {
        scored.push({
          id: item.id,
          text: item.text,
          metadata: item.metadata,
          score: matchScore
        });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }
}

/**
 * 辅助函数：计算余弦相似度
 */
function cosineSimilarity(vecA, vecB) {
  if (vecA.length !== vecB.length) {
    return 0; // 维度不匹配
  }
  let dotProduct = 0.0;
  let normA = 0.0;
  let normB = 0.0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// 生产代码继续直接使用默认单例；导出类和相似度函数仅用于隔离测试和复用。
module.exports = new SimpleVectorStore();
module.exports.SimpleVectorStore = SimpleVectorStore;
module.exports.cosineSimilarity = cosineSimilarity;
