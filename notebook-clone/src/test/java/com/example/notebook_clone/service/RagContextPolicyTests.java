package com.example.notebook_clone.service;

import com.example.notebook_clone.entity.Document;
import com.example.notebook_clone.repository.DocumentRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.model.Generation;
import reactor.core.publisher.Flux;
import java.util.List;
import java.util.Optional;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class RagContextPolicyTests {
    DocumentRepository repository;
    RetrievalService retrieval;
    ChatClient client;
    ChatHistoryService history;
    ContextCompressionService compression;
    AiChatService service;
    RagContextService contexts;

    @BeforeEach
    void setup() {
        repository = mock(DocumentRepository.class);
        retrieval = mock(RetrievalService.class);
        client = mock(ChatClient.class, RETURNS_DEEP_STUBS);
        history = mock(ChatHistoryService.class);
        compression = mock(ContextCompressionService.class);
        ChatClient.Builder builder = mock(ChatClient.Builder.class);
        when(builder.build()).thenReturn(client);
        contexts = new RagContextService(repository, retrieval);
        service = new AiChatService(builder, contexts, history, compression);
    }

    Document doc(Integer count, String content) {
        Document d = new Document();
        d.setId(1L);
        d.setContent(content);
        d.setChunkCount(count);
        return d;
    }

    String ask(boolean stream, boolean notebook, boolean useContext) {
        if (stream) {
            var events = notebook
                    ? service.askBasedOnDocumentsStream(List.<String[]>of(new String[]{"title", "raw"}), "question", 2L, 3L)
                    : service.askBasedOnDocumentStream("raw", "question", useContext, 1L, 3L);
            return events.filter(e -> e.event() == null).map(e -> e.data()).collectList().block()
                    .stream().reduce("", String::concat);
        }
        return notebook
                ? service.askBasedOnDocuments(List.<String[]>of(new String[]{"title", "raw"}), "question", 2L, 3L)
                : service.askBasedOnDocument("raw", "question", useContext, 1L, 3L);
    }

    void modelAnswer() {
        var response = new ChatResponse(List.of(new Generation(new AssistantMessage("answer"))));
        when(client.prompt().system(anyString()).messages(anyList()).user(anyString()).call().chatResponse())
                .thenReturn(response);
        when(client.prompt().system(anyString()).messages(anyList()).user(anyString()).stream().chatResponse())
                .thenReturn(Flux.just(response));
    }

    @ParameterizedTest @ValueSource(booleans = {false, true})
    void generalChatNeverTouchesIndexOrEmbedding(boolean stream) {
        modelAnswer();
        assertEquals("answer", ask(stream, false, false));
        verifyNoInteractions(repository, retrieval);
    }

    @ParameterizedTest @ValueSource(booleans = {false, true})
    void unavailableDocumentStopsBeforeModelAndHistoryCompression(boolean stream) {
        for (Integer count : new Integer[]{null, 0, -1}) {
            when(repository.findById(1L)).thenReturn(Optional.of(doc(count, "raw")));
            String answer = ask(stream, false, true);
            assertTrue(answer.contains(count != null && count < 0 ? "索引失败" : "尚未就绪"));
        }
        verifyNoInteractions(retrieval, client, history, compression);
    }

    @ParameterizedTest @ValueSource(booleans = {false, true})
    void emptyEvidenceDoesNotFallBackToRawText(boolean stream) {
        when(repository.findById(1L)).thenReturn(Optional.of(doc(2, "raw")));
        when(repository.findByNotebook_Id(2L)).thenReturn(List.of(doc(2, "raw")));
        assertEquals("根据文档内容，无法找到相关答案。", ask(stream, false, true));
        assertEquals("根据文档内容，无法找到相关答案。", ask(stream, true, true));
        verifyNoInteractions(client, history, compression);
    }

    @ParameterizedTest @ValueSource(booleans = {false, true})
    void partialNotebookWaitsRatherThanAnsweringFromSubset(boolean stream) {
        when(repository.findByNotebook_Id(2L)).thenReturn(List.of(doc(2, "ready"), doc(0, "pending")));
        assertTrue(ask(stream, true, true).contains("尚未就绪"));
        when(repository.findByNotebook_Id(2L)).thenReturn(List.of(doc(2, "ready"), doc(-1, "failed")));
        assertTrue(ask(stream, true, true).contains("索引失败"));
        verifyNoInteractions(retrieval, client, history, compression);
    }

    @ParameterizedTest @ValueSource(booleans = {false, true})
    void readyEvidenceReachesModel(boolean stream) {
        when(repository.findById(1L)).thenReturn(Optional.of(doc(2, "raw")));
        when(repository.findByNotebook_Id(2L)).thenReturn(List.of(doc(2, "raw")));
        var chunks = List.of(new RetrievalService.RetrievedChunk(1, "evidence", 1L, "title"));
        when(retrieval.retrieveDocumentChunks("question", 1L, 5)).thenReturn(chunks);
        when(retrieval.retrieveNotebookChunks("question", 2L, 8)).thenReturn(chunks);
        modelAnswer();
        assertEquals("answer", ask(stream, false, true));
        assertEquals("answer", ask(stream, true, true));
        verify(client.prompt().system(anyString()).messages(anyList()), times(2))
                .user(contains("[1] 来源：title\nevidence"));
    }

    @Test
    void emptyAndMissingResourcesHaveExplicitMessages() {
        assertTrue(contexts.document(1L, "q").message().contains("不存在"));
        when(repository.findById(1L)).thenReturn(Optional.of(doc(null, " ")));
        assertTrue(contexts.document(1L, "q").message().contains("内容为空"));
        assertTrue(contexts.notebook(2L, "q").message().contains("没有文档"));
        when(repository.findByNotebook_Id(2L)).thenReturn(List.of(doc(null, "")));
        assertTrue(contexts.notebook(2L, "q").message().contains("均为空"));
        verifyNoInteractions(retrieval);
    }
}
