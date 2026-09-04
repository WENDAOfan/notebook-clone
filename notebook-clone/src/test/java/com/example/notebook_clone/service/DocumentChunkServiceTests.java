package com.example.notebook_clone.service;

import com.example.notebook_clone.entity.Document;
import com.example.notebook_clone.repository.DocumentRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.ai.vectorstore.VectorStore;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * 文档分块服务单元测试，不启动 Spring，也不调用真实 Embedding API。
 * VectorStore 和 Repository 都是 Mock，所以可以精确观察成功与失败后的副作用。
 */
@SuppressWarnings("unchecked") // ArgumentCaptor<List<...>> 受 Java 泛型擦除限制，需要这一处显式说明。
class DocumentChunkServiceTests {

    private VectorStore vectorStore;
    private DocumentRepository documentRepository;
    private DocumentChunkService documentChunkService;

    @BeforeEach
    void setUp() {
        vectorStore = mock(VectorStore.class);
        documentRepository = mock(DocumentRepository.class);
        documentChunkService = new DocumentChunkService(vectorStore, documentRepository);
    }

    /** 数据库中找不到文档时直接结束，不接触向量库。 */
    @Test
    void missingDocumentDoesNotWriteVectors() {
        when(documentRepository.findById(10L)).thenReturn(Optional.empty());

        documentChunkService.chunkAndStoreAsync(10L);

        verifyNoInteractions(vectorStore);
        verify(documentRepository, never()).updateChunkCount(10L, -1);
    }

    /** 空正文没有检索价值，也不应该产生空向量。 */
    @Test
    void blankDocumentDoesNotWriteVectors() {
        when(documentRepository.findById(10L)).thenReturn(Optional.of(document("   ")));

        documentChunkService.chunkAndStoreAsync(10L);

        verifyNoInteractions(vectorStore);
        verify(documentRepository, never()).updateChunkCount(10L, -1);
    }

    /** 正常分块完成后，把实际块数写回数据库，供检索状态和删除清理使用。 */
    @Test
    void successfulIndexingStoresChunksAndUpdatesChunkCount() {
        when(documentRepository.findById(10L)).thenReturn(Optional.of(document("一段较短的正文")));

        documentChunkService.chunkAndStoreAsync(10L);

        ArgumentCaptor<List<org.springframework.ai.document.Document>> chunksCaptor =
                ArgumentCaptor.forClass(List.class);
        verify(vectorStore).add(chunksCaptor.capture());
        List<org.springframework.ai.document.Document> chunks = chunksCaptor.getValue();
        assertEquals("doc:10:chunk:0", chunks.getFirst().getId());
        verify(documentRepository).updateChunkCount(10L, chunks.size());
    }

    /**
     * Embedding/向量写入可能在部分写入后抛错：服务应按已生成的 ID 补偿删除，
     * 并用 -1 明确标记索引失败，而不是让 chunkCount 一直停留在 null。
     */
    @Test
    void vectorFailureCleansPartialChunksAndMarksIndexAsFailed() {
        when(documentRepository.findById(10L)).thenReturn(Optional.of(document("一段较短的正文")));
        doThrow(new RuntimeException("Embedding 服务不可用"))
                .when(vectorStore).add(anyList());

        documentChunkService.chunkAndStoreAsync(10L);

        ArgumentCaptor<List<String>> idsCaptor = ArgumentCaptor.forClass(List.class);
        verify(vectorStore).delete(idsCaptor.capture());
        assertEquals(List.of("doc:10:chunk:0"), idsCaptor.getValue());
        verify(documentRepository).updateChunkCount(10L, -1);
    }

    private Document document(String content) {
        Document document = new Document();
        document.setId(10L);
        document.setTitle("notes.txt");
        document.setContent(content);
        return document;
    }
}
