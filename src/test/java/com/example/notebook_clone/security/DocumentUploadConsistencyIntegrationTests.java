package com.example.notebook_clone.security;

import com.example.notebook_clone.common.GlobalExceptionHandler;
import com.example.notebook_clone.config.SecurityConfig;
import com.example.notebook_clone.controller.DocumentController;
import com.example.notebook_clone.entity.Document;
import com.example.notebook_clone.entity.Notebook;
import com.example.notebook_clone.entity.User;
import com.example.notebook_clone.filter.JwtAuthenticationFilter;
import com.example.notebook_clone.repository.DocumentRepository;
import com.example.notebook_clone.repository.NotebookRepository;
import com.example.notebook_clone.repository.UserRepository;
import com.example.notebook_clone.service.AiChatService;
import com.example.notebook_clone.service.AiSummaryService;
import com.example.notebook_clone.service.AsyncSummaryService;
import com.example.notebook_clone.service.ChatHistoryService;
import com.example.notebook_clone.service.DocumentChunkService;
import com.example.notebook_clone.service.DocumentExtractService;
import com.example.notebook_clone.util.JwtUtil;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Optional;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 上传接口的一致性测试：前置步骤失败时，不允许保存半成品或启动后台 AI 任务。
 * MockMvc 会构造真实 multipart 请求，并让请求经过真实 JWT 安全过滤链。
 */
@WebMvcTest(DocumentController.class)
@Import({SecurityConfig.class, JwtAuthenticationFilter.class, JwtUtil.class,
        GlobalExceptionHandler.class})
@TestPropertySource(properties = {
        "jwt.secret=test-only-secret-key-with-at-least-32-bytes",
        "jwt.expiration=3600000"
})
class DocumentUploadConsistencyIntegrationTests {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JwtUtil jwtUtil;

    @MockitoBean
    private DocumentRepository documentRepository;
    @MockitoBean
    private NotebookRepository notebookRepository;
    @MockitoBean
    private UserRepository userRepository;
    @MockitoBean
    private DocumentExtractService extractService;
    @MockitoBean
    private AiSummaryService aiSummaryService;
    @MockitoBean
    private AiChatService aiChatService;
    @MockitoBean
    private AsyncSummaryService asyncSummaryService;
    @MockitoBean
    private DocumentChunkService documentChunkService;
    @MockitoBean
    private ChatHistoryService chatHistoryService;

    private User alice;
    private Notebook notebook;
    private String aliceToken;

    @BeforeEach
    void setUp() {
        alice = new User();
        alice.setId(1L);
        alice.setUsername("alice");

        notebook = new Notebook();
        notebook.setId(7L);
        notebook.setName("Alice 的笔记本");
        notebook.setUser(alice);

        aliceToken = jwtUtil.generateToken(alice.getId(), alice.getUsername());
        when(userRepository.findByUsername("alice")).thenReturn(Optional.of(alice));
    }

    /** 无权访问目标笔记本时，应在解析文件之前停止，避免无意义地消耗 CPU。 */
    @Test
    void ownershipIsCheckedBeforeFileExtraction() throws Exception {
        when(notebookRepository.findByIdAndUserId(99L, alice.getId()))
                .thenReturn(Optional.empty());

        mockMvc.perform(uploadRequest(99L))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(400))
                .andExpect(jsonPath("$.message").value("文件上传失败: 笔记本不存在或无权操作"));

        verifyNoInteractions(extractService);
        verify(documentRepository, never()).save(any(Document.class));
        verifyNoInteractions(asyncSummaryService, documentChunkService);
    }

    /** 文件解析失败发生在数据库保存之前，因此不能留下文档记录或启动后台任务。 */
    @Test
    void extractionFailureLeavesNoDocumentOrBackgroundTask() throws Exception {
        allowOwnNotebook();
        when(extractService.extractText(any())).thenThrow(new RuntimeException("解析失败"));

        mockMvc.perform(uploadRequest(7L))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(400))
                .andExpect(jsonPath("$.message").value("文件上传失败: 解析失败"));

        verify(documentRepository, never()).save(any(Document.class));
        verifyNoInteractions(asyncSummaryService, documentChunkService);
    }

    /** 数据库保存失败后没有文档 ID，摘要和向量任务都不能被提交。 */
    @Test
    void databaseFailureDoesNotStartBackgroundTasks() throws Exception {
        allowOwnNotebook();
        when(extractService.extractText(any())).thenReturn("提取出的正文");
        when(documentRepository.save(any(Document.class)))
                .thenThrow(new RuntimeException("数据库不可用"));

        mockMvc.perform(uploadRequest(7L))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(400))
                .andExpect(jsonPath("$.message").value("文件上传失败: 数据库不可用"));

        verifyNoInteractions(asyncSummaryService, documentChunkService);
    }

    /** 成功时先保存文档，再用保存后获得的同一个 ID 启动两项后台任务。 */
    @Test
    void successfulUploadStartsBackgroundTasksOnlyAfterSave() throws Exception {
        allowOwnNotebook();
        when(extractService.extractText(any())).thenReturn("提取出的正文");
        when(documentRepository.save(any(Document.class))).thenAnswer(invocation -> {
            Document saved = invocation.getArgument(0);
            saved.setId(10L);
            return saved;
        });

        mockMvc.perform(uploadRequest(7L))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.id").value(10))
                .andExpect(jsonPath("$.data.content").value("补充说明\n\n---\n\n提取出的正文"));

        InOrder order = inOrder(documentRepository, asyncSummaryService, documentChunkService);
        order.verify(documentRepository).save(any(Document.class));
        order.verify(asyncSummaryService).generateSummaryAsync(10L);
        order.verify(documentChunkService).chunkAndStoreAsync(10L);
    }

    private void allowOwnNotebook() {
        when(notebookRepository.findByIdAndUserId(7L, alice.getId()))
                .thenReturn(Optional.of(notebook));
    }

    private org.springframework.test.web.servlet.RequestBuilder uploadRequest(Long notebookId) {
        MockMultipartFile file = new MockMultipartFile(
                "file", "notes.txt", "text/plain", "原始内容".getBytes());
        return multipart("/api/documents/upload")
                .file(file)
                .param("notebookId", notebookId.toString())
                .param("additionalContent", "补充说明")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + aliceToken);
    }
}
