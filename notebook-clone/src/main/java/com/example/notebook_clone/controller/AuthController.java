package com.example.notebook_clone.controller;

import com.example.notebook_clone.common.Result;
import com.example.notebook_clone.entity.User;
import com.example.notebook_clone.service.AuthService;
import com.example.notebook_clone.util.JwtUtil;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
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
     * 获取当前登录用户信息（测试接口）
     * GET /api/auth/me
     * 需要在请求头中携带：Authorization: Bearer <token>
     */
    @GetMapping("/me")
    public Result<UserInfoResponse> getCurrentUser(
            @RequestHeader("Authorization") String authHeader) {
        
        // 1. 从 Header 中提取 Token（去掉 "Bearer " 前缀）
        String token = authHeader.replace("Bearer ", "");

        // 2. 验证 Token
        if (!jwtUtil.validateToken(token)) {
            return Result.fail("Token 无效或已过期");
        }

        // 3. 从 Token 中提取用户信息
        Long userId = jwtUtil.getUserIdFromToken(token);
        String username = jwtUtil.getUsernameFromToken(token);

        // 4. 返回用户信息
        UserInfoResponse response = new UserInfoResponse(userId, username);
        return Result.success(response);
    }

    // ========== DTO 定义 ==========

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