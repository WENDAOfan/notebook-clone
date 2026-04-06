package com.example.notebook_clone.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
@EnableWebSecurity//以上告诉 Spring：这是一个配置类，启用 Web 安全功能
public class SecurityConfig {

    /**
     * 配置密码加密器
     * BCrypt 是 Spring Security 推荐的加密方式
     */
    @Bean//Spring 会把这个对象放入"容器"，其他组件可以通过 @Autowired 或构造器注入使用
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    /**
     * 配置安全过滤器链
     * Day 12 目标：放行注册和登录接口，禁用默认表单登录
     */
    @Bean//将这个配置注册为 Spring 容器管理的组件
    //SecurityFilterChain：安全过滤器链，Spring Security 通过一系列过滤器来处理请求安全
    // HttpSecurity：用于配置 HTTP 安全规则的构建器
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            // 禁用 CSRF（因为我们后续用 JWT，不需要 Session）
            .csrf(csrf -> csrf.disable())
            
            // 配置无状态会话（不创建 Session）
            .sessionManagement(session -> 
                session.sessionCreationPolicy(SessionCreationPolicy.STATELESS)
            )
            
            // 配置授权规则
            .authorizeHttpRequests(auth -> auth
                // 放行注册和登录接口（无需认证）
                .requestMatchers("/api/auth/**").permitAll()
                // 放行 Day 11 的测试接口（临时）
                .requestMatchers("/api/users/**").permitAll()
                .requestMatchers("/api/notebooks/**").permitAll()
                .requestMatchers("/api/documents/**").permitAll()
                // 其他请求需要认证
                .anyRequest().authenticated()
            );
        
        return http.build();
    }
}