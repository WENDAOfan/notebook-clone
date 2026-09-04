package com.example.notebook_clone.config;

import com.example.notebook_clone.filter.JwtAuthenticationFilter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

@Configuration//告诉 Spring 这是一个配置类，Spring 启动时会自动读取里面的配置
@EnableWebSecurity//开启 WebSecurity 功能，如果不加这个注解，Spring Security 不会生效
public class SecurityConfig {

    private final JwtAuthenticationFilter jwtAuthenticationFilter;

    public SecurityConfig(JwtAuthenticationFilter jwtAuthenticationFilter) {
        this.jwtAuthenticationFilter = jwtAuthenticationFilter;
    }
    //面要把这个过滤器添加到安全过滤器链中，告诉 Spring Security："请你用我的 JWT 过滤器来验证 Token。
    @Bean//把这个方法返回的对象注册到 Spring 容器中，其他地方可以通过注入来使用
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    //安全过滤器链，这是 Spring Security 的核心。它定义了一组安全规则，Spring 会按照这些规则来处理每个请求
        http
            // 禁用 CSRF（前后端分离不需要）
            .csrf(csrf -> csrf.disable())
            
            // 配置无状态会话
            .sessionManagement(session -> 
                session.sessionCreationPolicy(SessionCreationPolicy.STATELESS)
            )

            // API 未认证时统一返回 401 JSON，而不是跳转登录页或返回 403
            .exceptionHandling(exceptions -> exceptions
                .authenticationEntryPoint((request, response, exception) -> {
                    response.setStatus(401);
                    response.setContentType("application/json;charset=UTF-8");
                    response.getWriter().write(
                            "{\"code\":401,\"message\":\"未登录或登录已过期\",\"data\":null}");
                })
            )
            
            // 配置授权规则
            .authorizeHttpRequests(auth -> auth
                // 放行静态资源（前端页面）
                .requestMatchers("/", "/index.html", "/css/**", "/js/**").permitAll()
                // 放行注册和登录接口（无需认证）
                .requestMatchers(HttpMethod.POST, "/api/auth/register", "/api/auth/login").permitAll()
                // 其他所有请求都需要认证
                .anyRequest().authenticated()
            )
            
            // ⭐ 添加 JWT 过滤器到 Security 过滤器链
            // 在 UsernamePasswordAuthenticationFilter 之前执行
            .addFilterBefore(jwtAuthenticationFilter, 
                    UsernamePasswordAuthenticationFilter.class);
        
        return http.build();
    }
}
