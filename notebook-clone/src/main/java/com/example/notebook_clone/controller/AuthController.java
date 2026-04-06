package com.example.notebook_clone.controller;

import com.example.notebook_clone.common.Result;
import com.example.notebook_clone.entity.User;
import com.example.notebook_clone.service.AuthService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
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
     * Day 12 版本：只返回用户信息（不含密码）
     * Day 13 版本：将返回 JWT Token
     */
    @PostMapping("/login")
    public Result<User> login(@Valid @RequestBody LoginRequest request) {
        User user = authService.login(request.username(), request.password());
        return Result.success(user);
    }

    /**
     * 内部类：注册请求 DTO
     */
    public record RegisterRequest(
            @NotBlank(message = "用户名不能为空") String username,
            @NotBlank(message = "密码不能为空") String password
    ) {}

    /**
     * 内部类：登录请求 DTO
     */
    public record LoginRequest(
            @NotBlank(message = "用户名不能为空") String username,
            @NotBlank(message = "密码不能为空") String password
    ) {}
}