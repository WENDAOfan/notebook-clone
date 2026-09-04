package com.example.notebook_clone.security;

import com.example.notebook_clone.common.GlobalExceptionHandler;
import com.example.notebook_clone.config.SecurityConfig;
import com.example.notebook_clone.controller.DocumentController;
import com.example.notebook_clone.controller.NotebookController;
import com.example.notebook_clone.entity.Document;
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
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Optional;

import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 数据归属测试：验证“已经登录”并不等于“可以操作任意数据”。
 *
 * 测试使用真实 JWT 安全链确认请求者是 Alice，再通过 Mock Repository 构造
 * “资源属于 Alice”或“资源不属于 Alice”的场景。不会连接真实数据库。
 */
// 同时加载笔记本和文档 Controller，覆盖两类资源的归属校验
@WebMvcTest({NotebookController.class, DocumentController.class})
// 安全组件使用真实实现；全局异常处理器负责把业务拒绝转换为 Result 响应
@Import({SecurityConfig.class, JwtAuthenticationFilter.class, JwtUtil.class,
        GlobalExceptionHandler.class})
// 只供测试生成 JWT，绝不读取正式配置中的密钥
@TestPropertySource(properties = {
        "jwt.secret=test-only-secret-key-with-at-least-32-bytes",
        "jwt.expiration=3600000"
})
class OwnershipAuthorizationIntegrationTests {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JwtUtil jwtUtil;

    // 以下 Repository 和 Service 全部使用 Mock：既隔离真实数据，也能验证方法有没有被调用
    @MockitoBean
    private UserRepository userRepository;

    @MockitoBean
    private NotebookRepository notebookRepository;

    @MockitoBean
    private DocumentRepository documentRepository;

    @MockitoBean
    private AiChatService aiChatService;

    @MockitoBean
    private AiSummaryService aiSummaryService;

    @MockitoBean
    private AsyncSummaryService asyncSummaryService;

    @MockitoBean
    private ChatHistoryService chatHistoryService;

    @MockitoBean
    private DocumentChunkService documentChunkService;

    @MockitoBean
    private DocumentExtractService documentExtractService;

    private User alice;
    private String aliceToken;

    /**
     * 每条测试执行前都重新准备 Alice 和她的 Token。
     * Mockito 会在测试之间重置 Mock，防止不同测试互相污染。
     */
    @BeforeEach
    void setUpAlice() {
        alice = new User();
        alice.setId(1L);
        alice.setUsername("alice");
        aliceToken = jwtUtil.generateToken(alice.getId(), alice.getUsername());

        when(userRepository.findByUsername("alice")).thenReturn(Optional.of(alice));
    }

    /** Alice 请求删除 ID=99 的笔记本，但 Repository 表明它不属于 Alice。 */
    @Test
    void userCannotDeleteAnotherUsersNotebook() throws Exception {
        // Arrange：归属查询返回 false，模拟“笔记本存在于系统中，但不属于当前用户”
        when(notebookRepository.existsByIdAndUserId(99L, alice.getId())).thenReturn(false);

        // Act + Assert：携带有效 Alice Token 发起删除，并检查业务层拒绝结果
        mockMvc.perform(delete("/api/notebooks/99")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + aliceToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(400))
                .andExpect(jsonPath("$.message").value("笔记本不存在或无权删除"));

        // 仅检查错误响应还不够：必须确认真正的删除和历史清理从未发生
        verify(notebookRepository, never()).deleteById(anyLong());
        verify(chatHistoryService, never()).clearNotebookHistory(anyLong(), anyLong());
    }

    /** 按“文档 ID + 当前用户 ID”查询不到记录时，不能返回其他用户的文档。 */
    @Test
    void userCannotReadAnotherUsersDocument() throws Exception {
        when(documentRepository.findByIdAndUserId(99L, alice.getId()))
                .thenReturn(Optional.empty());

        mockMvc.perform(get("/api/documents/99")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + aliceToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(400))
                .andExpect(jsonPath("$.message").value("文档不存在或无权访问"));
    }

    /** 未通过笔记本归属校验时，连下一级文档列表查询都不应执行。 */
    @Test
    void userCannotListDocumentsFromAnotherUsersNotebook() throws Exception {
        when(notebookRepository.findByIdAndUserId(99L, alice.getId()))
                .thenReturn(Optional.empty());

        mockMvc.perform(get("/api/documents/notebook/99")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + aliceToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(400))
                .andExpect(jsonPath("$.message").value("笔记本不存在或无权访问"));

        // 证明 Controller 在归属检查失败后立即停止，没有继续接触文档数据
        verify(documentRepository, never()).findByNotebook_Id(anyLong());
    }

    /** 正向场景：安全规则不能只会拒绝，也必须保证用户仍能读取自己的资源。 */
    @Test
    void userCanReadOwnDocument() throws Exception {
        // Arrange：Repository 按“文档 ID + Alice ID”返回属于 Alice 的文档
        Document document = new Document();
        document.setId(10L);
        document.setTitle("Alice 的文档");
        document.setContent("仅属于 Alice 的内容");
        document.setUser(alice);
        when(documentRepository.findByIdAndUserId(10L, alice.getId()))
                .thenReturn(Optional.of(document));

        // Act + Assert：相同的 Alice Token 此时应该获得正常数据
        mockMvc.perform(get("/api/documents/10")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + aliceToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.id").value(10))
                .andExpect(jsonPath("$.data.title").value("Alice 的文档"));
    }
}
