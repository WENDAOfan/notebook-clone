package com.example.notebook_clone.security;

import com.example.notebook_clone.common.GlobalExceptionHandler;
import com.example.notebook_clone.config.SecurityConfig;
import com.example.notebook_clone.controller.NotebookController;
import com.example.notebook_clone.entity.User;
import com.example.notebook_clone.filter.JwtAuthenticationFilter;
import com.example.notebook_clone.repository.DocumentRepository;
import com.example.notebook_clone.repository.NotebookRepository;
import com.example.notebook_clone.repository.UserRepository;
import com.example.notebook_clone.service.AiChatService;
import com.example.notebook_clone.service.ChatHistoryService;
import com.example.notebook_clone.service.DocumentChunkService;
import com.example.notebook_clone.util.JwtUtil;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Optional;

import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 笔记本删除一致性测试。
 *
 * 数据库删除笔记本时，关联文档可能通过数据库级联一起消失；但向量库不是数据库的一部分，
 * 不会自动级联。因此必须先删除每篇文档的向量分块，再删除数据库记录，避免留下“孤儿向量”。
 */
@WebMvcTest(NotebookController.class)
@Import({SecurityConfig.class, JwtAuthenticationFilter.class, JwtUtil.class,
        GlobalExceptionHandler.class})
@TestPropertySource(properties = {
        "jwt.secret=test-only-secret-key-with-at-least-32-bytes",
        "jwt.expiration=3600000"
})
class NotebookDeletionConsistencyIntegrationTests {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JwtUtil jwtUtil;

    // Controller 依赖都换成 Mock，本测试只观察删除流程及调用顺序，不连接真实数据库和向量库。
    @MockitoBean
    private UserRepository userRepository;

    @MockitoBean
    private NotebookRepository notebookRepository;

    @MockitoBean
    private DocumentRepository documentRepository;

    @MockitoBean
    private AiChatService aiChatService;

    @MockitoBean
    private ChatHistoryService chatHistoryService;

    @MockitoBean
    private DocumentChunkService documentChunkService;

    private User alice;
    private String aliceToken;

    /** 每条测试都使用一个真实生成的 Alice JWT，确保请求确实经过 Spring Security。 */
    @BeforeEach
    void setUpAlice() {
        alice = new User();
        alice.setId(1L);
        alice.setUsername("alice");
        aliceToken = jwtUtil.generateToken(alice.getId(), alice.getUsername());

        when(userRepository.findByUsername("alice")).thenReturn(Optional.of(alice));
    }

    /**
     * 删除包含两篇文档的笔记本时，两篇文档的向量都要先清理。
     * InOrder 不只验证“调用过”，还验证调用发生的先后顺序。
     */
    @Test
    void deletingNotebookCleansDocumentVectorsBeforeDatabaseDelete() throws Exception {
        when(notebookRepository.existsByIdAndUserId(7L, alice.getId())).thenReturn(true);
        when(documentRepository.findIdsByNotebookId(7L)).thenReturn(List.of(10L, 11L));

        mockMvc.perform(delete("/api/notebooks/7")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + aliceToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200));

        InOrder deletionOrder = inOrder(
                documentRepository,
                documentChunkService,
                chatHistoryService,
                notebookRepository
        );
        deletionOrder.verify(documentRepository).findIdsByNotebookId(7L);
        deletionOrder.verify(documentChunkService).deleteDocumentChunks(10L);
        deletionOrder.verify(documentChunkService).deleteDocumentChunks(11L);
        deletionOrder.verify(chatHistoryService).clearNotebookHistory(7L, alice.getId());
        deletionOrder.verify(notebookRepository).deleteById(7L);
    }

    /** 空笔记本没有向量可删，但仍应正常清理历史并删除数据库记录。 */
    @Test
    void deletingEmptyNotebookSkipsVectorCleanup() throws Exception {
        when(notebookRepository.existsByIdAndUserId(7L, alice.getId())).thenReturn(true);
        when(documentRepository.findIdsByNotebookId(7L)).thenReturn(List.of());

        mockMvc.perform(delete("/api/notebooks/7")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + aliceToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200));

        verifyNoInteractions(documentChunkService);
        InOrder deletionOrder = inOrder(documentRepository, chatHistoryService, notebookRepository);
        deletionOrder.verify(documentRepository).findIdsByNotebookId(7L);
        deletionOrder.verify(chatHistoryService).clearNotebookHistory(7L, alice.getId());
        deletionOrder.verify(notebookRepository).deleteById(7L);
    }
}
