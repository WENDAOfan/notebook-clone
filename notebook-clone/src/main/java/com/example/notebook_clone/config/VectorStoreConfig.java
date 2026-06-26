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

/**
 * Day 28：向量存储配置
 *
 * 使用 Spring AI 原生智谱 AI Embedding 模型：
 *   - Chat 模型继续用 DeepSeek（spring.ai.openai.*）
 *   - Embedding 模型用智谱 AI（spring.ai.zhipuai.*）
 *
 * SimpleVectorStore 是内存向量存储，重启后数据丢失，仅用于开发验证。
 */
@Configuration
public class VectorStoreConfig {

    @Value("${spring.ai.zhipuai.api-key}")
    private String apiKey;

    @Value("${spring.ai.zhipuai.embedding.options.model:embedding-3}")
    private String model;

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
     * 创建内存向量存储（开发阶段用，重启后数据丢失）
     * 生产环境可换 pgvector / Redis Vector Store
     */
    @Bean
    public VectorStore vectorStore(EmbeddingModel embeddingModel) {
        return SimpleVectorStore.builder(embeddingModel).build();
    }
}
