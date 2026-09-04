package com.example.notebook_clone.filter;

import com.example.notebook_clone.util.JwtUtil;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Collections;

/**
 * JWT 认证过滤器
 * 作用：每次请求时，从请求头中提取 JWT Token 并校验
 * 继承 OncePerRequestFilter 确保每个请求只执行一次
 */
@Component//自动创建这个类的对象，并放到 Spring 容器里管理
public class JwtAuthenticationFilter extends OncePerRequestFilter {
    //保证一个请求只经过这个过滤器一次，避免重复校验
    private final JwtUtil jwtUtil;

    public JwtAuthenticationFilter(JwtUtil jwtUtil) {
        this.jwtUtil = jwtUtil;
    }

    // 只跳过注册和登录；/api/auth/me 仍需经过 JWT 校验
    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI();
        boolean isPublicAuthEndpoint = path.equals("/api/auth/register")
                || path.equals("/api/auth/login");
        return "POST".equalsIgnoreCase(request.getMethod()) && isPublicAuthEndpoint;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,//前端发来的请求
                                    HttpServletResponse response,//要返回给前端的响应
                                    FilterChain filterChain) throws ServletException, IOException {
                                    //过滤器链，用来"放行"请求
        // 1. 获取请求头中的 Authorization
        String authHeader = request.getHeader("Authorization");

        // 2. 判断是否有 Authorization 头，且以 "Bearer " 开头
        if (!StringUtils.hasText(authHeader) || !authHeader.startsWith("Bearer ")) {
            // 没有 Token，直接放行（后续的 Security 配置会处理无权限访问）
            filterChain.doFilter(request, response);
            return;
        }

        // 3. 提取 Token（去掉 "Bearer " 前缀）
        String token = authHeader.substring(7);

        // 4. 验证 Token
        if (!jwtUtil.validateToken(token)) {
            // Token 无效，返回 401 未授权
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType("application/json;charset=UTF-8");
            response.getWriter().write("{\"code\":401,\"message\":\"Token 无效或已过期\",\"data\":null}");
            return;
        }

        // 5. Token 有效，提取用户信息
        String username = jwtUtil.getUsernameFromToken(token);

        // 6. 将用户信息存入 SecurityContext（关键！）
        // 这样后续的 Controller 中可以通过 SecurityContextHolder 获取当前用户
        UsernamePasswordAuthenticationToken authentication =
                new UsernamePasswordAuthenticationToken(
                        username,           // 主体（用户名）
                        null,               // 凭证（密码，已验证过，这里不传）
                        Collections.emptyList()  // 权限列表（暂时为空）
                );
        
        // 将用户信息设置到 Security 上下文中
        SecurityContextHolder.getContext().setAuthentication(authentication);

        // 7. 放行，继续执行后续的过滤器链
        filterChain.doFilter(request, response);
    }
}
