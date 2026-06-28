package com.example.notebook_clone.config;

import org.springframework.ai.document.MetadataMode;
import org.springframework.ai.embedding.EmbeddingModel;
import org.springframework.ai.vectorstore.SimpleVectorStore;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.ai.zhipuai.ZhiPuAiEmbeddingModel;
import org.springframework.ai.zhipuai.ZhiPuAiEmbeddingOptions;
import org.springframework.ai.zhipuai.api.ZhiPuAiApi;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import lombok.extern.slf4j.Slf4j;

import java.io.File;

/**
 * Day 28：向量存储配置
 *
 * 使用 Spring AI 原生智谱 AI Embedding 模型：
 *   - Chat 模型继续用 DeepSeek（spring.ai.openai.*）
 *   - Embedding 模型用智谱 AI（spring.ai.zhipuai.*）
 *
 * SimpleVectorStore 是内存向量存储，加文件持久化兜住重启丢失（过渡方案）。
 * 后续接入 pgvector 后可删除文件持久化逻辑。
 */
@Slf4j
@Configuration
public class VectorStoreConfig {

    @Value("${spring.ai.zhipuai.api-key}")
    private String apiKey;

    @Value("${spring.ai.zhipuai.embedding.options.model:embedding-3}")
    private String model;

    // 向量文件持久化路径（项目根目录下的 vector-store.json）
    @Value("${vector.store.file:vector-store.json}")
    private String vectorStoreFile;

    /**
     * 创建智谱 AI Embedding 模型
     */
    @Bean
    public EmbeddingModel embeddingModel() {
        ZhiPuAiApi zhiPuAiApi = new ZhiPuAiApi(apiKey);
        ZhiPuAiEmbeddingOptions options = ZhiPuAiEmbeddingOptions.builder()
                .model(model)
                .build();
        return new ZhiPuAiEmbeddingModel(zhiPuAiApi, MetadataMode.EMBED, options);
    }

    /**
     * 创建内存向量存储 + 文件持久化
     * 启动时从文件加载已有向量（如果文件存在），分块后保存到文件
     */
    @Bean
    public VectorStore vectorStore(EmbeddingModel embeddingModel) {
        SimpleVectorStore store = SimpleVectorStore.builder(embeddingModel).build();

        File file = new File(vectorStoreFile);
        if (file.exists()) {
            store.load(file);
            log.info("[向量存储] 从文件加载向量: {}", file.getAbsolutePath());
        } else {
            log.info("[向量存储] 向量文件不存在，从空库启动: {}", file.getAbsolutePath());
        }

        return store;
    }
}
