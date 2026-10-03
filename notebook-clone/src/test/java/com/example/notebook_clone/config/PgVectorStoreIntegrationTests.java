package com.example.notebook_clone.config;

import com.example.notebook_clone.repository.DocumentRepository;
import com.example.notebook_clone.service.RetrievalService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.ai.document.Document;
import org.springframework.ai.embedding.EmbeddingModel;
import org.springframework.ai.vectorstore.pgvector.PgVectorStore;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.util.ReflectionTestUtils;

import java.io.Reader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** 真正连接 PostgreSQL 的 opt-in 测试；Embedding 使用确定性向量，结束清理本次测试行。 */
@EnabledIfEnvironmentVariable(named = "PGVECTOR_INTEGRATION", matches = "true")
class PgVectorStoreIntegrationTests {
    private JdbcTemplate jdbc;
    private PgVectorStore store;
    private EmbeddingModel model;
    private final long docA = -Math.abs(System.nanoTime());
    private final long docB = docA - 1;
    private final String idA = "pgvector-test:" + UUID.randomUUID();
    private final String idB = "pgvector-test:" + UUID.randomUUID();

    @BeforeEach
    void setUp() throws Exception {
        Properties properties = new Properties();
        try (Reader reader = Files.newBufferedReader(Path.of("src/main/resources/application.properties"))) {
            properties.load(reader);
        }
        var dataSource = new DriverManagerDataSource(properties.getProperty("spring.datasource.url"),
                resolve(properties.getProperty("spring.datasource.username")),
                resolve(properties.getProperty("spring.datasource.password")));
        jdbc = new JdbcTemplate(dataSource);
        model = mock(EmbeddingModel.class);
        float[] embedding = new float[2048];
        embedding[0] = 1f;
        when(model.embed(anyString())).thenReturn(embedding);
        when(model.embed(anyList(), any(), any())).thenAnswer(invocation ->
                ((List<?>) invocation.getArgument(0)).stream().map(ignored -> embedding).toList());
        store = newStore();
    }

    private static String resolve(String value) {
        if (value != null && value.startsWith("${") && value.endsWith("}")) {
            String[] parts = value.substring(2, value.length() - 1).split(":", 2);
            String environment = System.getenv(parts[0]);
            return environment != null ? environment : (parts.length == 2 ? parts[1] : "");
        }
        return value;
    }

    private PgVectorStore newStore() {
        var config = new VectorStoreConfig();
        ReflectionTestUtils.setField(config, "dimensions", 2048);
        ReflectionTestUtils.setField(config, "initializeSchema", true);
        var result = config.vectorStore(jdbc, model);
        result.afterPropertiesSet();
        return result;
    }

    @AfterEach
    void cleanUp() {
        if (jdbc != null) {
            jdbc.update("DELETE FROM public.vector_store WHERE id IN (?, ?)", idA, idB);
        }
    }

    private Document chunk(String id, long documentId, String text) {
        return new Document(id, text, Map.of("documentId", documentId, "documentTitle", "测试文档"));
    }

    @Test
    void persists2048DimensionalVectorsAndRetrievesAfterRecreatingStore() {
        store.add(List.of(chunk(idA, docA, "PostgreSQL 持久化测试")));
        assertEquals(2048, jdbc.queryForObject(
                "SELECT vector_dims(embedding) FROM public.vector_store WHERE id=?", Integer.class, idA));
        var recreated = newStore();
        var retrieval = new RetrievalService(recreated, mock(DocumentRepository.class));
        var results = retrieval.retrieveDocumentChunks("持久化", docA, 5);
        assertEquals(1, results.size());
        assertEquals(docA, results.getFirst().documentId());
        assertEquals("PostgreSQL 持久化测试", results.getFirst().text());
    }

    @Test
    void appliesDocumentAndNotebookMetadataFiltersInDatabase() {
        store.add(List.of(chunk(idA, docA, "A 文档"), chunk(idB, docB, "B 文档")));
        var repository = mock(DocumentRepository.class);
        when(repository.findIdsByNotebookId(99L)).thenReturn(List.of(docA));
        var retrieval = new RetrievalService(store, repository);
        assertEquals(List.of(docA), retrieval.retrieveDocumentChunks("查询", docA, 5)
                .stream().map(RetrievalService.RetrievedChunk::documentId).toList());
        assertEquals(List.of(docA), retrieval.retrieveNotebookChunks("查询", 99L, 5)
                .stream().map(RetrievalService.RetrievedChunk::documentId).toList());
    }

    @Test
    void upsertsTextIdsAndDeletesPersistently() {
        store.add(List.of(chunk(idA, docA, "原始正文")));
        store.add(List.of(chunk(idA, docA, "更新正文")));
        assertEquals("更新正文", jdbc.queryForObject(
                "SELECT content FROM public.vector_store WHERE id=?", String.class, idA));
        store.delete(List.of(idA));
        assertTrue(new RetrievalService(newStore(), mock(DocumentRepository.class))
                .retrieveDocumentChunks("查询", docA, 5).isEmpty());
    }
}
