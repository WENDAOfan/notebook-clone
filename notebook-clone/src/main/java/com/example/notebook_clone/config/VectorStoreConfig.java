package com.example.notebook_clone.config;

import org.springframework.ai.document.MetadataMode;
import org.springframework.ai.embedding.EmbeddingModel;
import org.springframework.ai.vectorstore.pgvector.PgVectorStore;
import org.springframework.ai.zhipuai.ZhiPuAiEmbeddingModel;
import org.springframework.ai.zhipuai.ZhiPuAiEmbeddingOptions;
import org.springframework.ai.zhipuai.api.ZhiPuAiApi;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Day 28：向量存储配置
 *
 * 使用 Spring AI 原生智谱 AI Embedding 模型：
 *   - Chat 模型继续用 DeepSeek（spring.ai.openai.*）
 *   - Embedding 模型用智谱 AI（spring.ai.zhipuai.*）
 *
 * 向量、分块正文及元数据保存到 PostgreSQL 的 pgvector 表。
 */
@Configuration
public class VectorStoreConfig {

    @Value("${spring.ai.zhipuai.api-key}")
    private String apiKey;

    @Value("${spring.ai.zhipuai.embedding.options.model:embedding-3}")
    private String model;

    @Value("${vector.store.dimensions:2048}")
    private int dimensions;

    @Value("${vector.store.initialize-schema:true}")
    private boolean initializeSchema;

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
     * 与 JPA 共用数据源。保留 doc:<id>:chunk:<index> 文本 ID，兼容定向删除。
     * embedding-3 的现有向量为 2048 维，超过 vector 的 HNSW 2000 维限制，
     * 因此使用精确余弦检索；不通过裁剪维度改变已有向量。
     */
    @Bean
    public PgVectorStore vectorStore(JdbcTemplate jdbcTemplate, EmbeddingModel embeddingModel) {
        return PgVectorStore.builder(jdbcTemplate, embeddingModel)
                .vectorTableName("vector_store")
                .idType(PgVectorStore.PgIdType.TEXT)
                .dimensions(dimensions)
                .distanceType(PgVectorStore.PgDistanceType.COSINE_DISTANCE)
                .indexType(PgVectorStore.PgIndexType.NONE)
                .initializeSchema(initializeSchema)
                .build();
    }
}
