package com.example.notebook_clone.security;

import com.example.notebook_clone.config.SecurityConfig;
import com.example.notebook_clone.controller.AuthController;
import com.example.notebook_clone.entity.User;
import com.example.notebook_clone.filter.JwtAuthenticationFilter;
import com.example.notebook_clone.service.AuthService;
import com.example.notebook_clone.util.JwtUtil;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 认证边界测试：验证哪些接口允许匿名访问，哪些接口必须携带有效 JWT。
 *
 * 这是一个 Web MVC“切片测试”：只启动 Controller 和安全链，不启动数据库、
 * 向量存储或 AI 服务，因此执行速度快，也不会消耗真实 API 额度。
 */
// 只加载 AuthController 所需的 Web 层组件，不启动完整 Spring Boot 应用
@WebMvcTest(AuthController.class)
// 导入需要真实参与测试的安全配置、JWT 过滤器和 JWT 工具
@Import({SecurityConfig.class, JwtAuthenticationFilter.class, JwtUtil.class})
// 测试专用 JWT 配置，与本地真实密钥完全无关
@TestPropertySource(properties = {
        "jwt.secret=test-only-secret-key-with-at-least-32-bytes",
        "jwt.expiration=3600000"
})
class AuthSecurityIntegrationTests {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JwtUtil jwtUtil;

    // AuthService 原本会访问数据库；这里用 Mock 替代，让测试只关注 HTTP 安全边界
    @MockitoBean
    private AuthService authService;

    /** 注册和登录是公开入口：没有 Token 也应该正常进入 Controller。 */
    @Test
    void loginWithoutTokenIsAllowed() throws Exception {
        // Arrange（准备）：规定 Mock 收到这组账号密码时返回测试用户
        User user = new User();
        user.setId(42L);
        user.setUsername("alice");
        when(authService.login("alice", "123456")).thenReturn(user);

        // Act（执行）：MockMvc 在内存中模拟一次 HTTP 登录请求，无需启动 8080 端口
        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"username":"alice","password":"123456"}
                                """))
                // Assert（断言）：状态、用户名和生成的 Token 都必须符合预期
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.username").value("alice"))
                .andExpect(jsonPath("$.data.token").isNotEmpty());
    }

    /** 当前用户接口是受保护资源：没有 Token 时必须被安全链拦截。 */
    @Test
    void currentUserWithoutTokenIsUnauthorized() throws Exception {
        mockMvc.perform(get("/api/auth/me"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value(401));
    }

    /** 有效 Token 应被过滤器解析，并把 Token 中的用户名放入 SecurityContext。 */
    @Test
    void currentUserWithValidTokenReturnsTokenIdentity() throws Exception {
        // 使用真实 JwtUtil 生成测试 Token，所以这里也覆盖了 JWT 的签名和解析流程
        String token = jwtUtil.generateToken(42L, "alice");

        mockMvc.perform(get("/api/auth/me")
                        // HTTP 认证的标准格式：Authorization: Bearer <token>
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.username").value("alice"));
    }

    /** 伪造或损坏的 Token 不能被当成已登录身份。 */
    @Test
    void currentUserWithInvalidTokenIsUnauthorized() throws Exception {
        mockMvc.perform(get("/api/auth/me")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer invalid-token"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value(401));
    }
}
