package com.example.notebook_clone.security;

import com.example.notebook_clone.common.GlobalExceptionHandler;
import com.example.notebook_clone.config.SecurityConfig;
import com.example.notebook_clone.controller.EvalRetrievalController;
import com.example.notebook_clone.entity.Document;
import com.example.notebook_clone.entity.User;
import com.example.notebook_clone.filter.JwtAuthenticationFilter;
import com.example.notebook_clone.repository.DocumentRepository;
import com.example.notebook_clone.repository.NotebookRepository;
import com.example.notebook_clone.repository.UserRepository;
import com.example.notebook_clone.service.RetrievalService;
import com.example.notebook_clone.util.JwtUtil;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Optional;

import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 评测检索接口安全测试：真实执行 JWT 过滤链，但 Repository 和向量检索使用 Mock。
 * 因此测试不会读取数据库、向量文件，也不会调用 Embedding 或聊天模型。
 */
@WebMvcTest(EvalRetrievalController.class)
@ActiveProfiles("test")
@Import({SecurityConfig.class, JwtAuthenticationFilter.class, JwtUtil.class,
        GlobalExceptionHandler.class})
@TestPropertySource(properties = {
        "jwt.secret=test-only-secret-key-with-at-least-32-bytes",
        "jwt.expiration=3600000"
})
class EvalRetrievalSecurityIntegrationTests {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JwtUtil jwtUtil;

    @MockitoBean
    private UserRepository userRepository;
    @MockitoBean
    private DocumentRepository documentRepository;
    @MockitoBean
    private NotebookRepository notebookRepository;
    @MockitoBean
    private RetrievalService retrievalService;

    private User alice;
    private String aliceToken;

    @BeforeEach
    void setUp() {
        alice = new User();
        alice.setId(1L);
        alice.setUsername("alice");
        aliceToken = jwtUtil.generateToken(alice.getId(), alice.getUsername());
        when(userRepository.findByUsername("alice")).thenReturn(Optional.of(alice));
    }

    /** 即使启用了 test Profile，匿名请求仍必须被安全链拦截。 */
    @Test
    void anonymousRequestIsUnauthorized() throws Exception {
        mockMvc.perform(retrievalRequest(null, "document", 10L, 5))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value(401));
    }

    /** 合法用户只能看到自己文档的必要分块字段。 */
    @Test
    void ownerCanRetrieveDocumentChunks() throws Exception {
        Document document = new Document();
        document.setId(10L);
        document.setUser(alice);
        when(documentRepository.findByIdAndUserId(10L, alice.getId()))
                .thenReturn(Optional.of(document));
        when(retrievalService.retrieveDocumentChunks("续航多久？", 10L, 5))
                .thenReturn(List.of(new RetrievalService.RetrievedChunk(
                        1, "电池续航为 12 小时。", 10L, "产品手册.md")));

        mockMvc.perform(retrievalRequest(aliceToken, "document", 10L, 5))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data[0].rank").value(1))
                .andExpect(jsonPath("$.data[0].documentTitle").value("产品手册.md"))
                .andExpect(jsonPath("$.data[0].text").value("电池续航为 12 小时。"))
                // 响应 DTO 没有 embedding 字段，防止评测接口泄露向量。
                .andExpect(jsonPath("$.data[0].embedding").doesNotExist());
    }

    /** 越权用户应在调用检索服务之前被拒绝。 */
    @Test
    void crossUserDocumentDoesNotReachVectorStore() throws Exception {
        when(documentRepository.findByIdAndUserId(99L, alice.getId()))
                .thenReturn(Optional.empty());

        mockMvc.perform(retrievalRequest(aliceToken, "document", 99L, 5))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(400))
                .andExpect(jsonPath("$.data").doesNotExist());

        verify(retrievalService, never()).retrieveDocumentChunks("续航多久？", 99L, 5);
    }

    /** topK 有硬上限，避免评测接口一次导出过多分块。 */
    @Test
    void topKIsCappedAtTwenty() throws Exception {
        Document document = new Document();
        document.setId(10L);
        document.setUser(alice);
        when(documentRepository.findByIdAndUserId(10L, alice.getId()))
                .thenReturn(Optional.of(document));

        mockMvc.perform(retrievalRequest(aliceToken, "document", 10L, 999))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200));

        verify(retrievalService).retrieveDocumentChunks("续航多久？", 10L, 20);
    }

    private org.springframework.test.web.servlet.RequestBuilder retrievalRequest(
            String token, String targetType, Long targetId, int topK) {
        var builder = post("/api/eval/retrieval")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"targetType":"%s","targetId":%d,"question":"续航多久？","topK":%d}
                        """.formatted(targetType, targetId, topK));
        if (token != null) {
            builder.header(HttpHeaders.AUTHORIZATION, "Bearer " + token);
        }
        return builder;
    }
}
