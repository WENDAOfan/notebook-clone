package com.example.notebook_clone.controller;

import com.example.notebook_clone.common.Result;
import com.example.notebook_clone.entity.User;
import com.example.notebook_clone.service.AuthService;
import com.example.notebook_clone.util.JwtUtil;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;

import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService authService;
    private final JwtUtil jwtUtil;

    public AuthController(AuthService authService, JwtUtil jwtUtil) {
        this.authService = authService;
        this.jwtUtil = jwtUtil;
    }

    /**
     * 用户注册
     * POST /api/auth/register
     */
    @PostMapping("/register")
    public Result<User> register(@Valid @RequestBody RegisterRequest request) {
        User user = authService.register(request.username(), request.password());
        return Result.success(user);
    }

    /**
     * 用户登录
     * POST /api/auth/login
     * Day 13 版本：返回 JWT Token
     */
    @PostMapping("/login")
    public Result<LoginResponse> login(@Valid @RequestBody LoginRequest request) {
        // 1. 验证用户名密码
        User user = authService.login(request.username(), request.password());

        // 2. 生成 JWT Token
        String token = jwtUtil.generateToken(user.getId(), user.getUsername());

        // 3. 构造响应（不返回密码）
        LoginResponse response = new LoginResponse(
                user.getId(),
                user.getUsername(),
                user.getEmail(),
                token
        );

        return Result.success(response);
    }

    /**
     * 获取当前登录用户信息（简化版）
     * GET /api/auth/me
     * 
     * 由于 JWT 过滤器已经校验过 Token 并设置了 SecurityContext，
     * 这里直接从 SecurityContext 获取用户信息即可
     */
    @GetMapping("/me")
    public Result<UserInfoResponse> getCurrentUser() {
        // 从 SecurityContext 获取用户名（过滤器已经设置好了）
        String username = SecurityContextHolder.getContext()
                .getAuthentication().getName();
        
        // 实际项目中，这里应该根据 username 查询数据库获取完整用户信息
        // 简化示例，直接返回用户名
        UserInfoResponse response = new UserInfoResponse(null, username);
        return Result.success(response);
    }

    // ========== DTO Data Transfer Object（数据传输对象）定义 ==========

    public record RegisterRequest(
            @NotBlank(message = "用户名不能为空") String username,
            @NotBlank(message = "密码不能为空") String password
    ) {}

    public record LoginRequest(
            @NotBlank(message = "用户名不能为空") String username,
            @NotBlank(message = "密码不能为空") String password
    ) {}

    /**
     * 登录响应（包含 Token）
     */
    public record LoginResponse(
            Long id,
            String username,
            String email,
            String token  // JWT Token
    ) {}

    /**
     * 用户信息响应（不包含敏感信息）
     */
    public record UserInfoResponse(
            Long userId,
            String username
    ) {}
}